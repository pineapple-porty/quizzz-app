#!/usr/bin/env bash
set -euo pipefail

npm ci --no-audit --no-fund
DATABASE_TARGET=qa npm run db:setup
npm run build
npm test
