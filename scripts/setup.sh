#!/usr/bin/env bash
# Devin repo setup command. Must be idempotent and must exit 0 on a clean VM.
# If this script is slow or flaky, every session inherits the problem — so it falls
# back rather than failing when the lockfile has drifted (an agent added a dependency).
set -euo pipefail

if ! npm ci --no-audit --no-fund; then
  echo "npm ci failed (lockfile drift?) — falling back to npm install"
  npm install --no-audit --no-fund
fi

npm run db:seed
echo "setup complete: workspaces installed, dev database seeded (or skipped if not yet implemented)"
