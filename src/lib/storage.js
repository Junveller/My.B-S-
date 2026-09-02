/* ------------------------------------------------------------------ */
/* Storage layer                                                       */
/*                                                                       */
/* Backed by the server's per-account Postgres row (see server/db.js —  */
/* table app_data) instead of localStorage, so data follows the logged- */
/* in account rather than the browser. Every read/write in the app      */
/* still goes through loadData/saveData/loadMessages/saveMessages       */
/* below, so screens didn't need to change when this swapped over.      */
/* ------------------------------------------------------------------ */

import { getToken, clearSession } from "./auth.js";

async function authedFetch(path, options = {}) {
  const token = getToken();
  const res = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  if (res.status === 401) {
    clearSession();
    const err = new Error("세션이 만료됐어요. 다시 로그인해주세요.");
    err.code = "SESSION_EXPIRED";
    throw err;
  }
  return res;
}

export async function loadData() {
  // returns: null (nothing saved yet) | "LOAD_FAILED" | the saved data object
  try {
    const res = await authedFetch("/api/data");
    if (!res.ok) return "LOAD_FAILED";
    const json = await res.json();
    return json.data ?? null;
  } catch (e) {
    if (e.code === "SESSION_EXPIRED") throw e;
    console.error("mybiseo storage load error", e);
    return "LOAD_FAILED";
  }
}

export async function saveData(data) {
  try {
    const res = await authedFetch("/api/data", { method: "PUT", body: JSON.stringify({ data }) });
    if (!res.ok) console.error("mybiseo save failed");
    return res.ok;
  } catch (e) {
    if (e.code === "SESSION_EXPIRED") throw e;
    console.error("mybiseo storage save error", e);
    return false;
  }
}

export async function loadMessages() {
  try {
    const res = await authedFetch("/api/data");
    if (!res.ok) return null;
    const json = await res.json();
    return json.messages ?? null;
  } catch (e) {
    if (e.code === "SESSION_EXPIRED") throw e;
    console.error("mybiseo storage load error", e);
    return null;
  }
}

export async function saveMessages(msgs) {
  try {
    const res = await authedFetch("/api/messages", {
      method: "PUT",
      body: JSON.stringify({ messages: msgs }),
    });
    return res.ok;
  } catch (e) {
    if (e.code === "SESSION_EXPIRED") throw e;
    console.error("mybiseo storage save error", e);
    return false;
  }
}
