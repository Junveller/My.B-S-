/* ------------------------------------------------------------------ */
/* Storage layer                                                       */
/*                                                                       */
/* Currently backed by browser localStorage. Every read/write in the    */
/* app goes through loadData/saveData/loadMessages/saveMessages below,  */
/* so migrating to a backend (e.g. Node/Express + SQLite) later only    */
/* means rewriting the bodies of readKey/writeKey to call an API        */
/* (GET/PUT /api/storage/:key) instead of localStorage — nothing in     */
/* App.jsx or the screens needs to change.                              */
/* ------------------------------------------------------------------ */

const KEYS = {
  data: "mybiseo-data",
  chat: "mybiseo-chat",
};

async function readKey(key) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    console.error(`mybiseo storage read error (${key})`, e);
    return "LOAD_FAILED";
  }
}

async function writeKey(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    console.error(`mybiseo storage write error (${key})`, e);
    return false;
  }
}

export async function loadData() {
  // returns: null (nothing saved yet) | "LOAD_FAILED" | the saved data object
  return readKey(KEYS.data);
}

export async function saveData(data) {
  const ok = await writeKey(KEYS.data, data);
  if (!ok) console.error("mybiseo save failed");
  return ok;
}

export async function loadMessages() {
  const res = await readKey(KEYS.chat);
  return res === "LOAD_FAILED" ? null : res;
}

export async function saveMessages(msgs) {
  return writeKey(KEYS.chat, msgs);
}
