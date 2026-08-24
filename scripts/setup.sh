#!/usr/bin/env bash
# Devin repo setup command. Must be idempotent and must exit 0 on a clean VM.
# If this script is slow or flaky, every session inherits the problem.
set -euo pipefail

npm ci --no-audit --no-fund
npm run db:seed
echo "setup complete: workspaces installed, dev database seeded"
