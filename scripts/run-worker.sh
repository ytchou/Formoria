#!/usr/bin/env bash
# @formoria-script
# purpose: Run a worker entry point that uses top-level await by temporarily injecting type:module.
# class: operator
# invoke: pnpm health:agent -- --dry-run
# target: none
# safety: writes
# owner: engineering
#
# Run a worker entry point that uses top-level await.
#
# The Dockerfile injects "type": "module" into package.json at build time
# (Dockerfile.curation-worker:8). This script does the same for local runs,
# restoring the original on exit (including signals).
#
# Usage: scripts/run-worker.sh tsx src/health-agent/server.ts [-- --dry-run]

set -euo pipefail

PKG="package.json"
BACKUP=""

inject_type_module() {
  BACKUP=$(cat "$PKG")
  node -e "const p=require('./$PKG');p.type='module';require('fs').writeFileSync('$PKG',JSON.stringify(p,null,2)+'\n')"
}

restore_package_json() {
  if [ -n "$BACKUP" ]; then
    echo "$BACKUP" > "$PKG"
    BACKUP=""
  fi
}

trap restore_package_json EXIT INT TERM

inject_type_module
"$@"
