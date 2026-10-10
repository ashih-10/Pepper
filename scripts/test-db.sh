#!/usr/bin/env bash
# Runs the database security tests against your local Supabase stack.
# Start it first with: npx supabase start
set -euo pipefail
set -a
eval "$(npx supabase status -o env 2>/dev/null)"
set +a
npx vitest run tests/db "$@"
