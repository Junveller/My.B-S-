import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { FieldValue } from "firebase-admin/firestore";
import db, { firestoreReady } from "./db.js";

const JWT_SECRET = process.env.JWT_SECRET;
const PIN_LOOKUP_SECRET = process.env.PIN_LOOKUP_SECRET;

export function authSecretsConfigured() {
  return Boolean(JWT_SECRET && PIN_LOOKUP_SECRET && firestoreReady());
}

export function isValidUsername(username) {
  return typeof username === "string" && username.trim().length >= 1 && username.trim().length <= 20;
}

export function isValidPin(pin) {
  return typeof pin === "string" && /^\d{4}$/.test(pin);
}

const ACCOUNT_KEY_SEPARATOR = " ";

// Deterministic key for the (username, PIN) combo. It doubles as both
// the Firestore document id for the account AND the account's stable
// identifier used everywhere else (JWT payload, the app_data document
// id) — one HMAC = one account, so there's no separate auto-id lookup
// to maintain. It's a keyed HMAC: knowing this key does not reveal the
// PIN, and it can't be (re)computed without PIN_LOOKUP_SECRET, so it's
// safe to treat as an opaque account id.
//
// Using it as the Firestore doc id is also what makes "(username, PIN)
// combo must be unique" enforceable atomically: accounts.doc(key).create()
// fails with ALREADY_EXISTS if that exact combo is already registered,
// with no read-then-write race window — Firestore has no multi-field
// UNIQUE constraint, so a deterministic doc id is the idiomatic way to
// get the same guarantee.
function accountKey(username, pin) {
  return crypto
    .createHmac("sha256", PIN_LOOKUP_SECRET)
    .update(username.trim() + ACCOUNT_KEY_SEPARATOR + pin)
    .digest("hex");
}

export async function registerAccount(username, pin) {
  const cleanUsername = username.trim();
  const key = accountKey(cleanUsername, pin);
  const pinHash = await bcrypt.hash(pin, 10);
  try {
    await db.collection("accounts").doc(key).create({
      username: cleanUsername,
      pinHash,
      createdAt: FieldValue.serverTimestamp(),
    });
    return { id: key, username: cleanUsername };
  } catch (e) {
    if (e.code === 6 /* ALREADY_EXISTS */) {
      const err = new Error("DUPLICATE_COMBO");
      err.code = "DUPLICATE_COMBO";
      throw err;
    }
    throw e;
  }
}

export async function loginAccount(username, pin) {
  const cleanUsername = username.trim();
  const key = accountKey(cleanUsername, pin);
  const snap = await db.collection("accounts").doc(key).get();
  if (!snap.exists) return null;
  const account = snap.data();
  // Reaching this point already required knowing the exact (username, PIN)
  // combo (it's how `key` was derived) — bcrypt.compare is still the
  // authoritative check, so the PIN is genuinely hashed-and-verified like
  // a password, not just gated by the lookup key matching.
  const ok = await bcrypt.compare(pin, account.pinHash);
  if (!ok) return null;
  return { id: key, username: account.username };
}

export function issueToken(account) {
  return jwt.sign({ accountId: account.id, username: account.username }, JWT_SECRET, {
    expiresIn: "30d",
  });
}

export function authMiddleware(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "로그인이 필요해요." });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.accountId = payload.accountId;
    req.username = payload.username;
    next();
  } catch (e) {
    return res.status(401).json({ error: "로그인이 만료됐어요. 다시 로그인해주세요." });
  }
}
