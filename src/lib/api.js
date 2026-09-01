/* ------------------------------------------------------------------ */
/* Backend API client                                                  */
/*                                                                       */
/* The Anthropic API key must never live in the browser. The client     */
/* only ever calls our own /api/chat endpoint; the server attaches      */
/* ANTHROPIC_API_KEY and forwards the request to Anthropic.             */
/* ------------------------------------------------------------------ */

export async function sendChat(system, messages) {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ system, messages }),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.error || `chat request failed (${res.status})`);
  }
  return res.json(); // Anthropic Messages API response shape: { content: [...] }
}
