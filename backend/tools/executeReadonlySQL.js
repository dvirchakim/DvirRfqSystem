import { roPool, roPoolError } from '../db.js';

export const SCHEMA_CONTEXT = `
READ-ONLY DATABASE SCHEMA (PostgreSQL):

Table: rfqs
  id                   TEXT        -- unique RFQ identifier
  customer_name        TEXT        -- name of the requesting client
  part_number          TEXT        -- component / part being quoted
  quantity             INTEGER     -- requested quantity
  delivery_date        TEXT        -- requested delivery date (freeform)
  accepts_alternatives TEXT        -- 'Yes' | 'No' | null
  target_price         NUMERIC     -- budget ceiling (USD) or null
  status               TEXT        -- new | processing | parsed | ready | distributed | awaiting | completed
  priority             TEXT        -- high | medium | low
  is_obsolete          BOOLEAN     -- true if part is marked obsolete
  special_requirements TEXT        -- free-text requirements
  summary              TEXT        -- AI-generated summary
  sender               TEXT        -- sender display name
  from_email           TEXT        -- sender email address
  human_loop           BOOLEAN     -- flagged for manual review
  created_at           TIMESTAMP
  updated_at           TIMESTAMP

Only SELECT queries on the 'rfqs' table are permitted.
Do NOT query system tables, pg_ tables, or information_schema.
`;

// Defense-in-depth string checks. For writes these are NOT the sole boundary —
// the Postgres READ ONLY transaction below plus rfq_agent's SELECT-only grants
// would reject any write even if it slipped past here. But system-catalog reads
// (pg_*, information_schema) ARE reads, so the transaction won't stop them and
// rfq_agent can read pg_catalog by default — for those, this blocklist is the
// boundary, so it must actually match them.
const FORBIDDEN_KEYWORDS = /\b(DROP|DELETE|UPDATE|INSERT|MERGE|CREATE|ALTER|TRUNCATE|GRANT|REVOKE|EXEC(?:UTE)?|CALL|COPY|LOCK|VACUUM|REINDEX|LISTEN|NOTIFY|current_user|session_user)\b/i;
// Identifier prefixes for system catalogs. NOTE: a trailing \b after "pg_" never
// matches (underscore is a word char, so there's no boundary before the table
// name in "pg_roles"). Match the whole identifier instead.
const FORBIDDEN_IDENTIFIERS = /\b(pg_[a-z0-9_]+|information_schema)\b/i;

const STATEMENT_TIMEOUT_MS = 5000;

export async function executeReadonlySQL(sql) {
  if (roPoolError) {
    throw new Error(`Agent SQL tool is disabled: ${roPoolError}`);
  }

  // Drop at most one trailing semicolon, then reject anything with a semicolon
  // left over — this blocks statement-stacking (e.g. "SELECT 1; DELETE ...")
  // regardless of what the first statement looks like.
  const trimmed = (sql || '').trim().replace(/;\s*$/, '');

  if (!trimmed) {
    throw new Error('Empty SQL statement.');
  }
  if (!/^SELECT\b/i.test(trimmed)) {
    throw new Error('Only SELECT statements are permitted.');
  }
  if (trimmed.includes(';')) {
    throw new Error('Multiple statements are not permitted.');
  }
  if (FORBIDDEN_KEYWORDS.test(trimmed) || FORBIDDEN_IDENTIFIERS.test(trimmed)) {
    throw new Error('Forbidden SQL keyword detected. Only simple SELECT queries on the rfqs table are allowed.');
  }

  const client = await roPool.connect();
  try {
    // The real enforcement: Postgres itself refuses any write inside a READ ONLY
    // transaction, independent of the string checks above. statement_timeout
    // bounds worst-case runtime (e.g. an accidental cross join or pg_sleep-style DoS).
    await client.query('BEGIN TRANSACTION READ ONLY');
    await client.query(`SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}`);
    const result = await client.query(trimmed);
    return {
      fields:   result.fields.map(f => f.name),
      rows:     result.rows,
      rowCount: result.rowCount,
    };
  } catch (err) {
    throw new Error(`Query execution failed: ${err.message}`);
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
}
