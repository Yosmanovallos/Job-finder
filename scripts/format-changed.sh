#!/usr/bin/env bash
set -euo pipefail

files=$(git diff --name-only --diff-filter=ACMR -- '*.ts' '*.tsx' '*.json' '*.md' '*.yaml' '*.yml' 2>/dev/null || true)

if [ -z "$files" ]; then
  exit 0
fi

echo "$files" | xargs -r pnpm exec prettier --write
