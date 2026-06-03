import pg from 'pg';
const { Pool } = pg;

// Read-write pool — used by the app to write RFQ data and preferences
export const rwPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

// Read-only pool — used by the agent SQL tool (maps to rfq_agent DB user)
export const roPool = new Pool({
  connectionString: process.env.DATABASE_RO_URL || process.env.DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

export async function testConnection() {
  const client = await rwPool.connect();
  try {
    await client.query('SELECT 1');
  } finally {
    client.release();
  }
}
