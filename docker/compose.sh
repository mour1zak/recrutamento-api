#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
exec docker compose --env-file docker/.env -f docker/compose.dev.yml -f docker/compose.obs.yml "$@"
