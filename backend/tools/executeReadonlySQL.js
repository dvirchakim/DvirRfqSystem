import { roPool } from '../db.js';

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

// Patterns that must never appear in the agent SQL
const FORBIDDEN = /\b(DROP|DELETE|UPDATE|INSERT|CREATE|ALTER|TRUNCATE|GRANT|REVOKE|EXEC(?:UTE)?|pg_|information_schema|current_user|session_user)\b/i;

export async function executeReadonlySQL(sql) {
  const trimmed = sql.trim();

  if (!/^SELECT\b/i.test(trimmed)) {
    throw new Error('Only SELECT statements are permitted.');
  }

  if (FORBIDDEN.test(trimmed)) {
    throw new Error('Forbidden SQL keyword detected. Only simple SELECT queries on the rfqs table are allowed.');
  }

  try {
    const result = await roPool.query(trimmed);
    return {
      fields:   result.fields.map(f => f.name),
      rows:     result.rows,
      rowCount: result.rowCount,
    };
  } catch (err) {
    throw new Error(`Query execution failed: ${err.message}`);
  }
}
