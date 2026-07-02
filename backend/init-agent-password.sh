#!/bin/bash
# Runs after schema.sql (docker-entrypoint-initdb.d executes scripts in lexical
# order — this is mounted as 02_set_agent_password.sh). Sets the real password
# for the read-only rfq_agent role from AGENT_DB_PASSWORD so it's never
# hardcoded in schema.sql or checked into git.
set -euo pipefail

: "${AGENT_DB_PASSWORD:?AGENT_DB_PASSWORD must be set for the read-only agent role}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  ALTER ROLE rfq_agent WITH LOGIN PASSWORD '$AGENT_DB_PASSWORD';
EOSQL
