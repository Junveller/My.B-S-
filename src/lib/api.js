/* ------------------------------------------------------------------ */
/* Backend API client                                                  */
/*                                                                       */
/* The Gemini API key must never live in the browser. The client        */
/* only ever calls our own /api/chat endpoint; the server attaches      */
/* GEMINI_API_KEY and forwards the request to Google's Gemini API.      */
/* /api/chat requires login (see server/index.js's authMiddleware), so  */
/* every request here must carry the session token the same way        */
/* storage.js's authedFetch() does.                                    */
/* ------------------------------------------------------------------ */

import { getToken } from "./auth.js";

export async function sendChat(system, messages) {
  const token = getToken();
  if (!token) {
    // This is the exact condition that makes /api/chat 401 with
    // "로그인이 필요해요." before ever reaching Gemini — surfacing it
    // here makes that diagnosable from the browser console instead of
    // only showing up as "연결에 문제가 있었어요 (로그인이 필요해요.)"
    // in the chat bubble.
    console.warn("mybiseo sendChat: no login token found in localStorage — /api/chat will be rejected with 401");
  }
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ system, messages }),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.error || `chat request failed (${res.status})`);
  }
  return res.json(); // { content: [{ type: "text", text }] } — same shape regardless of backend LLM
}
