#!/usr/bin/env bash
set -euo pipefail

if [[ ! -d node_modules ]]; then
  echo "Installing dependencies with npm ci..."
  npm ci
fi

echo "Building TypeScript sources..."
npm run build

echo "Executing: $*"
exec "$@"
