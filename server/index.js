import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 5174;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";

const app = express();
app.use(express.json({ limit: "1mb" }));

/* ------------------------------------------------------------------ */
/* /api/chat — proxies the assistant conversation to the Anthropic      */
/* Messages API. The API key stays on the server; the client only       */
/* ever sends the system prompt + message history it already builds.   */
/* ------------------------------------------------------------------ */
app.post("/api/chat", async (req, res) => {
  if (!ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY is not set");
    return res.status(500).json({ error: "서버에 ANTHROPIC_API_KEY가 설정되어 있지 않아요." });
  }

  const { system, messages } = req.body || {};
  if (!Array.isArray(messages)) {
    return res.status(400).json({ error: "messages must be an array" });
  }

  try {
    // Prefill the assistant turn with "{" so the model must continue
    // straight into JSON instead of possibly prefacing it with chat
    // ("Sure, here's the JSON:") that breaks the client's parser and
    // silently drops the actions array.
    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 1024,
        system,
        messages: [...messages, { role: "assistant", content: "{" }],
      }),
    });

    const json = await anthropicRes.json();
    if (!anthropicRes.ok) {
      console.error("Anthropic API error", anthropicRes.status, json);
      return res.status(anthropicRes.status).json({
        error: json?.error?.message || "Anthropic API request failed",
      });
    }

    // The model's reply continues from the "{" prefill above, so the
    // prefix is missing from what it returns — add it back before
    // handing the response to the client.
    const firstText = json.content?.find((c) => c.type === "text");
    if (firstText) {
      firstText.text = "{" + firstText.text;
    } else {
      console.error("mybiseo /api/chat: no text block in Anthropic response", json);
    }
    res.json(json);
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
