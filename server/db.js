import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// FIREBASE_SERVICE_ACCOUNT_JSON holds the raw contents of the service
// account key file downloaded from Firebase Console -> Project Settings
// -> Service Accounts -> Generate new private key. Paste the whole JSON
// as one env var value; JSON.parse handles the escaped "\n"s in
// private_key correctly since that's how the file already encodes them.
function loadServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.error("FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON", e);
    return null;
  }
}

const serviceAccount = loadServiceAccount();
let db = null;

if (serviceAccount) {
  const app = initializeApp({ credential: cert(serviceAccount) });
  db = getFirestore(app);
} else {
  console.error("FIREBASE_SERVICE_ACCOUNT_JSON is not set — auth/data routes will fail until it is.");
}

export function firestoreReady() {
  return Boolean(db);
}

// Firestore is schemaless — nothing to bootstrap (collections and their
// documents are created on first write). Kept as a no-op async function
// so index.js's startup flow doesn't need special-casing for the swap
// from Postgres.
export async function initDb() {
  if (!db) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not set or invalid");
}

export default db;
