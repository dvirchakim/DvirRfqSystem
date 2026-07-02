import pg from 'pg';
const { Pool } = pg;

// Read-write pool — used by the app to write RFQ data and preferences
export const rwPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

// Read-only pool for the AI agent's SQL tool. Must point at a role with SELECT-only
// grants (see schema.sql's rfq_agent role, password set via init-agent-password.sh).
//
// Deliberately fail closed: if DATABASE_RO_URL is missing, or the connection to it
// fails, roPool stays null and roPoolError is set. executeReadonlySQL.js checks
// roPoolError and refuses to run rather than silently falling back to the
// read-write pool — a broken RO credential must never grant write access.
const _roUrl = process.env.DATABASE_RO_URL;

export let roPool = null;
export let roPoolError = 'DATABASE_RO_URL is not set — the agent SQL tool is disabled.';

if (_roUrl) {
  const pool = new Pool({
    connectionString: _roUrl,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  roPool = pool;
  roPoolError = null;

  pool.connect()
    .then(c => c.release())
    .catch(err => {
      console.error('[db] roPool connection failed — agent SQL tool will refuse to run:', err.message);
      roPoolError = `Read-only database connection failed: ${err.message}`;
      roPool = null;
    });
}

export async function testConnection() {
  const client = await rwPool.connect();
  try {
    await client.query('SELECT 1');
  } finally {
    client.release();
  }
}
