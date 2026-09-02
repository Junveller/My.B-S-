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
/* JSON schema for the assistant's structured reply. Passed as          */
/* output_config.format so the Messages API itself guarantees the       */
/* first content block is valid JSON matching this shape — no assistant */
/* prefill (unsupported / 400 on claude-sonnet-5 and newer) and no      */
/* "please only output JSON" prompt-begging required.                   */
/* ------------------------------------------------------------------ */
// Flat (no anyOf-in-array-items — undocumented/untested combination for
// this API) shape: every action field any type might use, all optional
// except "type". applyActions() on the client already branches on
// a.type and only reads the fields relevant to that branch, so unused
// fields being absent (or model-supplied null) is harmless.
const REPLY_SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string" },
    actions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["add_schedule", "update_status", "complete_schedule", "log_habit", "add_habit"],
          },
          title: { type: "string" },
          categoryId: { type: "string" },
          startDate: { type: "string" },
          endDate: { type: "string" },
          titleMatch: { type: "string" },
          status: { type: "string", enum: ["준비중", "곧 시작", "임박", "종료"] },
          habitNameMatch: { type: "string" },
          percent: { type: "integer" },
          note: { type: "string" },
          name: { type: "string" },
          goal: { type: "string" },
        },
        required: ["type"],
        additionalProperties: false,
      },
    },
  },
  required: ["reply", "actions"],
  additionalProperties: false,
};

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
        messages,
        output_config: { format: { type: "json_schema", schema: REPLY_SCHEMA } },
      }),
    });

    const json = await anthropicRes.json();
    if (!anthropicRes.ok) {
      console.error("Anthropic API error", anthropicRes.status, json);
      return res.status(anthropicRes.status).json({
        error: json?.error?.message || "Anthropic API request failed",
      });
    }
    if (json.stop_reason === "refusal") {
      console.error("mybiseo /api/chat: model refused", json.stop_details);
      return res.status(200).json({
        content: [{ type: "text", text: JSON.stringify({ reply: "이 요청은 도와드리기 어려워요.", actions: [] }) }],
      });
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
