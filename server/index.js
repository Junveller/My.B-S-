import "dotenv/config";
import express from "express";
import rateLimit from "express-rate-limit";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FieldValue } from "firebase-admin/firestore";
import db, { initDb } from "./db.js";
import {
  authSecretsConfigured,
  isValidUsername,
  isValidPin,
  registerAccount,
  loginAccount,
  issueToken,
  authMiddleware,
} from "./auth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 5174;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

const app = express();
// Render puts exactly one reverse proxy in front of the app, which sets
// X-Forwarded-For. Trusting proxies indiscriminately (`true`) is what
// makes express-rate-limit refuse to run (ERR_ERL_UNEXPECTED_X_FORWARDED_FOR)
// — it won't trust a client-spoofable header when *every* proxy is
// trusted. Leaving trust proxy unset has the same header/config mismatch
// (Express ignores X-Forwarded-For while Render's proxy still sends it,
// so req.ip becomes the proxy's own IP for every request and every user
// shares one rate-limit bucket) and throws the identical error. Trusting
// exactly one hop is what Render's own topology calls for either way.
app.set("trust proxy", 1);
app.use(express.json({ limit: "1mb" }));

/* ------------------------------------------------------------------ */
/* Auth — username + 4-digit PIN. Usernames are NOT unique on their     */
/* own (duplicate nicknames are allowed); the (username, PIN) combo is  */
/* the real account identifier and is what's enforced unique in the DB. */
/* ------------------------------------------------------------------ */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "너무 많은 시도가 있었어요. 잠시 후 다시 시도해주세요." },
});

app.post("/api/auth/register", authLimiter, async (req, res) => {
  if (!authSecretsConfigured()) {
    console.error("JWT_SECRET or PIN_LOOKUP_SECRET is not set");
    return res.status(500).json({ error: "서버 설정이 아직 완료되지 않았어요." });
  }
  const { username, pin } = req.body || {};
  if (!isValidUsername(username)) {
    return res.status(400).json({ error: "사용자 이름을 입력해주세요." });
  }
  if (!isValidPin(pin)) {
    return res.status(400).json({ error: "4자리 숫자를 입력해주세요." });
  }
  try {
    const account = await registerAccount(username, pin);
    const token = issueToken(account);
    res.json({ token, username: account.username });
  } catch (e) {
    if (e.code === "DUPLICATE_COMBO") {
      return res.status(409).json({ error: "이미 사용 중인 조합이에요, 다른 숫자를 선택해주세요." });
    }
    console.error("register error", e);
    res.status(500).json({ error: "회원가입 중 문제가 생겼어요." });
  }
});

app.post("/api/auth/login", authLimiter, async (req, res) => {
  if (!authSecretsConfigured()) {
    console.error("JWT_SECRET or PIN_LOOKUP_SECRET is not set");
    return res.status(500).json({ error: "서버 설정이 아직 완료되지 않았어요." });
  }
  const { username, pin } = req.body || {};
  if (!isValidUsername(username) || !isValidPin(pin)) {
    return res.status(400).json({ error: "사용자 이름과 4자리 숫자를 입력해주세요." });
  }
  try {
    const account = await loginAccount(username, pin);
    if (!account) {
      return res.status(401).json({ error: "사용자 이름 또는 숫자가 올바르지 않아요." });
    }
    const token = issueToken(account);
    res.json({ token, username: account.username });
  } catch (e) {
    console.error("login error", e);
    res.status(500).json({ error: "로그인 중 문제가 생겼어요." });
  }
});

/* ------------------------------------------------------------------ */
/* Per-account app data — one Firestore doc per account (collection     */
/* "appData", doc id = the account's key from auth.js) holding the same */
/* shape the client used to keep in localStorage (categories/           */
/* scheduleItems/habits/habitLogs as `data`, chat history as            */
/* `messages`). set(..., {merge:true}) updates only the given field,    */
/* mirroring the old INSERT ... ON CONFLICT DO UPDATE SET <col>.        */
/* ------------------------------------------------------------------ */
app.get("/api/data", authMiddleware, async (req, res) => {
  try {
    const snap = await db.collection("appData").doc(req.accountId).get();
    const row = snap.exists ? snap.data() : null;
    res.json({ data: row?.data ?? null, messages: row?.messages ?? null });
  } catch (e) {
    console.error("load appData error", e);
    res.status(500).json({ error: "데이터를 불러오지 못했어요." });
  }
});

app.put("/api/data", authMiddleware, async (req, res) => {
  const { data } = req.body || {};
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return res.status(400).json({ error: "data가 필요해요." });
  }
  try {
    await db
      .collection("appData")
      .doc(req.accountId)
      .set({ data, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    res.json({ ok: true });
  } catch (e) {
    console.error("save appData error", e);
    res.status(500).json({ error: "데이터를 저장하지 못했어요." });
  }
});

app.put("/api/messages", authMiddleware, async (req, res) => {
  const { messages } = req.body || {};
  if (!Array.isArray(messages)) {
    return res.status(400).json({ error: "messages가 필요해요." });
  }
  try {
    await db
      .collection("appData")
      .doc(req.accountId)
      .set({ messages, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    res.json({ ok: true });
  } catch (e) {
    console.error("save appData messages error", e);
    res.status(500).json({ error: "대화 내용을 저장하지 못했어요." });
  }
});

/* ------------------------------------------------------------------ */
/* JSON schema for the assistant's structured reply. Passed as          */
/* generationConfig.responseSchema (Gemini's OpenAPI-subset dialect —   */
/* UPPERCASE type names, no additionalProperties) so the API itself     */
/* guarantees the response text is valid JSON matching this shape.      */
/* Flat shape: every action field any type might use, all optional      */
/* except "type". applyActions() on the client already branches on      */
/* a.type and only reads the fields relevant to that branch.            */
/* ------------------------------------------------------------------ */
const REPLY_SCHEMA = {
  type: "OBJECT",
  properties: {
    reply: { type: "STRING" },
    actions: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          type: {
            type: "STRING",
            enum: ["add_schedule", "update_status", "complete_schedule", "log_habit", "add_habit"],
          },
          title: { type: "STRING" },
          categoryId: { type: "STRING" },
          startDate: { type: "STRING" },
          endDate: { type: "STRING" },
          titleMatch: { type: "STRING" },
          status: { type: "STRING", enum: ["준비중", "곧 시작", "임박", "종료"] },
          habitNameMatch: { type: "STRING" },
          percent: { type: "INTEGER" },
          note: { type: "STRING" },
          name: { type: "STRING" },
          goal: { type: "STRING" },
          date: { type: "STRING" },
        },
        required: ["type"],
      },
    },
    askDateChoice: { type: "BOOLEAN" },
  },
  required: ["reply", "actions", "askDateChoice"],
};

/* ------------------------------------------------------------------ */
/* /api/chat — proxies the assistant conversation to the Gemini         */
/* generateContent API. Requires login (authMiddleware) so the free-    */
/* tier Gemini key can't be hit anonymously. The API key stays on the   */
/* server; the client only ever sends the system prompt + message       */
/* history it already builds, and gets back the same                    */
/* { content: [{type:"text", text}] } envelope it always has.           */
/* ------------------------------------------------------------------ */
app.post("/api/chat", authMiddleware, async (req, res) => {
  if (!GEMINI_API_KEY) {
    console.error("GEMINI_API_KEY is not set");
    return res.status(500).json({ error: "서버에 GEMINI_API_KEY가 설정되어 있지 않아요." });
  }

  const { system, messages } = req.body || {};
  if (!Array.isArray(messages)) {
    return res.status(400).json({ error: "messages must be an array" });
  }

  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": GEMINI_API_KEY,
        },
        body: JSON.stringify({
          contents: messages.map((m) => ({
            role: m.role === "assistant" ? "model" : "user",
            parts: [{ text: m.content }],
          })),
          systemInstruction: { parts: [{ text: system }] },
          generationConfig: {
            maxOutputTokens: 2048,
            responseMimeType: "application/json",
            responseSchema: REPLY_SCHEMA,
          },
        }),
      }
    );

    const json = await geminiRes.json();
    if (!geminiRes.ok) {
      console.error("Gemini API error", geminiRes.status, json);
      return res.status(geminiRes.status).json({
        error: json?.error?.message || "Gemini API request failed",
      });
    }

    const FALLBACK_TEXT = JSON.stringify({
      reply: "죄송해요, 응답을 처리하는 중에 문제가 있었어요. 다시 한 번 말씀해주실래요?",
      actions: [],
      askDateChoice: false,
    });

    const candidate = json.candidates?.[0];
    const text = candidate?.content?.parts?.map((p) => p.text || "").join("");
    if (!text) {
      console.error(
        "mybiseo /api/chat: no text in Gemini response",
        json.promptFeedback,
        candidate?.finishReason
      );
      return res.status(200).json({ content: [{ type: "text", text: FALLBACK_TEXT }] });
    }

    // Validate the model actually returned complete, parseable JSON
    // before it ever reaches the client — a truncated response (e.g.
    // finishReason "MAX_TOKENS") produces broken JSON that must never
    // be shown to the user as-is. The raw text is logged here (server
    // log only) for debugging; the client only ever sees FALLBACK_TEXT
    // in that case.
    let safeText = text;
    try {
      JSON.parse(text);
    } catch (parseErr) {
      console.error("mybiseo /api/chat: Gemini returned invalid/truncated JSON", {
        finishReason: candidate?.finishReason,
        parseError: String(parseErr),
        rawText: text,
      });
      safeText = FALLBACK_TEXT;
    }

    // Re-wrap into the same { content: [{type, text}] } shape the client
    // already parses, so nothing on the frontend needs to change.
    res.json({ content: [{ type: "text", text: safeText }] });
  } catch (e) {
    console.error("chat proxy error", e);
    res.status(502).json({ error: "비서 서버 연결에 실패했어요." });
  }
});

/* ------------------------------------------------------------------ */
/* Health check — used by hosting platforms (Render, Railway) to        */
/* confirm the service is up.                                          */
/* ------------------------------------------------------------------ */
app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/* Serve the production build (npm run build) when it exists.           */
/* ------------------------------------------------------------------ */
const distDir = path.join(__dirname, "..", "dist");
app.use(express.static(distDir));
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api")) return next();
  res.sendFile(path.join(distDir, "index.html"), (err) => {
    if (err) next();
  });
});

/* ------------------------------------------------------------------ */
/* Catch-all error handler. Without this, an error thrown inside any     */
/* middleware that runs *before* a route's own try/catch — anything from */
/* a future express-rate-limit change to an unexpected Firestore/JWT     */
/* failure — falls through to Express's default error page: often HTML, */
/* not JSON, which the client's res.json() silently fails to parse and   */
/* reports as a vague "요청에 실패했어요." nowhere near the real cause.   */
/* This guarantees every route always returns a real, parseable          */
/* { error } message, and logs the actual error server-side for          */
/* diagnosis. Must be registered last — Express identifies error         */
/* handlers by their 4-argument shape.                                   */
/* ------------------------------------------------------------------ */
app.use((err, req, res, next) => {
  console.error(`Unhandled error on ${req.method} ${req.path}`, err);
  if (res.headersSent) return next(err);
  res.status(err.status || err.statusCode || 500).json({
    error: "서버에 문제가 생겼어요. 잠시 후 다시 시도해주세요.",
  });
});

initDb()
  .then(() => console.log("Firestore ready"))
  .catch((e) =>
    console.error(
      "Firestore init failed — auth/data routes will fail until FIREBASE_SERVICE_ACCOUNT_JSON is set correctly",
      e
    )
  );

app.listen(PORT, () => {
  console.log(`My.BㅣSㅓ server listening on http://localhost:${PORT}`);
});
