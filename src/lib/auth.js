/* ------------------------------------------------------------------ */
/* Client-side auth: username + 4-digit PIN, session kept as a JWT in   */
/* localStorage. The PIN itself never touches localStorage — only the   */
/* signed token from the server does.                                  */
/* ------------------------------------------------------------------ */

const TOKEN_KEY = "mybiseo-token";
const USERNAME_KEY = "mybiseo-username";

export function getToken() {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function getUsername() {
  try {
    return window.localStorage.getItem(USERNAME_KEY);
  } catch {
    return null;
  }
}

function setSession(token, username) {
  window.localStorage.setItem(TOKEN_KEY, token);
  window.localStorage.setItem(USERNAME_KEY, username);
}

export function clearSession() {
  try {
    window.localStorage.removeItem(TOKEN_KEY);
    window.localStorage.removeItem(USERNAME_KEY);
  } catch {
    // ignore
  }
}

async function authRequest(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error || "요청에 실패했어요.");
  }
  return json;
}

export async function register(username, pin) {
  const { token, username: confirmed } = await authRequest("/api/auth/register", { username, pin });
  setSession(token, confirmed);
  return confirmed;
}

export async function login(username, pin) {
  const { token, username: confirmed } = await authRequest("/api/auth/login", { username, pin });
  setSession(token, confirmed);
  return confirmed;
}
