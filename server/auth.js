import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import pool from "./db.js";

const JWT_SECRET = process.env.JWT_SECRET;
const PIN_LOOKUP_SECRET = process.env.PIN_LOOKUP_SECRET;

export function authSecretsConfigured() {
  return Boolean(JWT_SECRET && PIN_LOOKUP_SECRET);
}

export function isValidUsername(username) {
  return typeof username === "string" && username.trim().length >= 1 && username.trim().length <= 20;
}

export function isValidPin(pin) {
  return typeof pin === "string" && /^\d{4}$/.test(pin);
}

// Deterministic (unsalted) HMAC of the PIN, used only so the database can
// enforce "username + PIN combo" uniqueness with a UNIQUE constraint —
// bcrypt's own hash is salted, so two accounts with the same PIN would
// never produce equal bcrypt hashes to compare against directly. The
// actual authentication decision still goes through bcrypt.compare()
// against pin_hash below; this lookup only narrows the candidate row.
function pinLookupHash(pin) {
  return crypto.createHmac("sha256", PIN_LOOKUP_SECRET).update(pin).digest("hex");
}

// Account identity is the (username, pin) combo as a whole — usernames
// are intentionally NOT unique on their own, so every query here is
// scoped by both fields together, never by username alone.
export async function registerAccount(username, pin) {
  const cleanUsername = username.trim();
  const pinHash = await bcrypt.hash(pin, 10);
  const lookup = pinLookupHash(pin);
  try {
    const result = await pool.query(
      `INSERT INTO accounts (username, pin_hash, pin_lookup) VALUES ($1, $2, $3) RETURNING id, username`,
      [cleanUsername, pinHash, lookup]
    );
    return result.rows[0];
  } catch (e) {
    if (e.code === "23505") {
      const err = new Error("DUPLICATE_COMBO");
      err.code = "DUPLICATE_COMBO";
      throw err;
    }
    throw e;
  }
}

export async function loginAccount(username, pin) {
  const cleanUsername = username.trim();
  const lookup = pinLookupHash(pin);
  const result = await pool.query(
    `SELECT id, username, pin_hash FROM accounts WHERE username = $1 AND pin_lookup = $2`,
    [cleanUsername, lookup]
  );
  const account = result.rows[0];
  if (!account) return null;
  const ok = await bcrypt.compare(pin, account.pin_hash);
  if (!ok) return null;
  return { id: account.id, username: account.username };
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
