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
# When package.json already has "type": "module" (always, in the image), the
# worker is exec'd so it receives SIGTERM directly. Without exec, bash defers
# its trap until the foreground child exits, the worker never sees the signal,
# and every container stop ends in a forced kill that Railway reports as a crash.
#
# exec here is necessary but not sufficient: pnpm starts this script through
# its script shell, and the default /bin/sh (dash in node:22-slim) does not
# exec, so it would swallow the signal one layer up. Dockerfile.curation-worker
# sets npm_config_script_shell=/bin/bash to remove that layer.
#
# Usage: scripts/run-worker.sh tsx src/health-agent/server.ts [-- --dry-run]

set -euo pipefail

PKG="package.json"

if node -e "process.exit(require('./$PKG').type === 'module' ? 0 : 1)"; then
  exec "$@"
fi
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
