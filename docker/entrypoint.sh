#!/bin/sh
# Secret Manager からマウントされた .env があれば読み込む
if [ -f /app/.env ]; then
  set -a
  . /app/.env
  set +a
fi
exec node server.js
