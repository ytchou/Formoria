#!/usr/bin/env bash

set -euo pipefail

status="${1:-}"

case "$status" in
  0)
    exit 0
    ;;
  4)
    echo "No matching Playwright specs found"
    exit 0
    ;;
  ''|*[!0-9]*)
    echo "Invalid Playwright exit status" >&2
    exit 2
    ;;
  *)
    exit "$status"
    ;;
esac
