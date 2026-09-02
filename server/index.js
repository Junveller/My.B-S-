import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 5174;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

const app = express();
app.use(express.json({ limit: "1mb" }));

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
/* generateContent API. The API key stays on the server; the client     */
/* only ever sends the system prompt + message history it already      */
/* builds, and gets back the same { content: [{type:"text", text}] }    */
/* envelope it always has — only the backend swapped, not the contract. */
/* ------------------------------------------------------------------ */
app.post("/api/chat", async (req, res) => {
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
            maxOutputTokens: 1024,
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

    const candidate = json.candidates?.[0];
    const text = candidate?.content?.parts?.map((p) => p.text || "").join("");
    if (!text) {
      console.error(
        "mybiseo /api/chat: no text in Gemini response",
        json.promptFeedback,
        candidate?.finishReason
      );
      return res.status(200).json({
        content: [{ type: "text", text: JSON.stringify({ reply: "이 요청은 도와드리기 어려워요.", actions: [] }) }],
      });
    }

    // Re-wrap into the same { content: [{type, text}] } shape the client
    // already parses, so nothing on the frontend needs to change.
    res.json({ content: [{ type: "text", text }] });
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

app.listen(PORT, () => {
  console.log(`My.BㅣSㅓ server listening on http://localhost:${PORT}`);
});
