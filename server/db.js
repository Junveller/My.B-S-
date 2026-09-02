import pg from "pg";

const { Pool } = pg;

// Render's Postgres requires SSL on its external connection string; a
// local dev database (localhost) doesn't speak SSL at all. Render's
// internal connection string also accepts this permissive SSL config
// without issue, so one branch covers every deployment shape we use.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("localhost") ? false : { rejectUnauthorized: false },
});

export async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS accounts (
      id SERIAL PRIMARY KEY,
      username TEXT NOT NULL,
      pin_hash TEXT NOT NULL,
      pin_lookup TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (username, pin_lookup)
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_data (
      account_id INTEGER PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      messages JSONB NOT NULL DEFAULT '[]'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

export default pool;
