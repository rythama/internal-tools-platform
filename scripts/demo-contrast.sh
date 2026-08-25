#!/usr/bin/env bash
# Stages the identity-binding contrast for a demo: the same query against the
# external ("rented UI") API surface, once carrying a signed assertion of a
# human's identity and once as the svc_retool service account. Afterwards,
# /audit shows adjacent rows naming a person and a machine for identical reads.
#
# Requires: dev server running on :3000, and ITP_ASSERTION_SECRET set to the
# SAME value in this shell as in the server's shell.
set -euo pipefail

if [ -z "${ITP_ASSERTION_SECRET:-}" ]; then
  echo "Set ITP_ASSERTION_SECRET to the same value the dev server was started with." >&2
  exit 1
fi

TOKEN=$(npx tsx -e '
import { mintAssertion } from "./packages/core/src/assert/index";
process.stdout.write(mintAssertion({ sub: "u-reviewer", email: "rina.reviewer@example.com", roles: ["kyc_reviewer"] }));
')

echo "— as the human (signed assertion) —"
curl -s -H "Authorization: Bearer ${TOKEN}" http://localhost:3000/api/ext/kyc_cases | head -c 200; echo; echo

echo "— as svc_retool (service account) —"
curl -s "http://localhost:3000/api/ext/kyc_cases?as=service" | head -c 200; echo; echo

echo "Done. Open /audit as auditor: adjacent record.read rows — one names the person, one names svc_retool."
