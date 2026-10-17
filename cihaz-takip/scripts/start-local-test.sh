#!/usr/bin/env bash
# Üretim derlemesini yerel deneme veritabanıyla ve parolasız deneme girişiyle başlatır (YALNIZCA yerel deneme).
set -euo pipefail
cd "$(dirname "$0")/.."
export AUTH_MODE=dev ALLOW_DEV_AUTH=1 ALLOW_LOCAL_DB=1
export LOCAL_DB_DIR="${LOCAL_DB_DIR:-.data/local-test}"
exec npx next start -p "${PORT:-3200}"
