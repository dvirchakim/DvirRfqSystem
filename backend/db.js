import pg from 'pg';
const { Pool } = pg;

// Read-write pool — used by the app to write RFQ data and preferences
export const rwPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

// Read-only pool — uses rfq_agent when DATABASE_RO_URL is explicitly set,
// otherwise falls back to the main rfq_user connection.
// Application-level enforcement (SELECT-only) in executeReadonlySQL.js is the primary guard.
const _roUrl = process.env.DATABASE_RO_URL;
let _roPool = new Pool({
  connectionString: _roUrl || process.env.DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

// Probe the RO pool; fall back to rwPool if the credentials don't work
if (_roUrl) {
  _roPool.connect()
    .then(c => c.release())
    .catch(() => {
      console.warn('[db] roPool auth failed — falling back to rwPool for read-only queries');
      _roPool = rwPool;
    });
}

export { _roPool as roPool };

export async function testConnection() {
  const client = await rwPool.connect();
  try {
    await client.query('SELECT 1');
  } finally {
    client.release();
  }
}
