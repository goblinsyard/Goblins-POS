#!/usr/bin/env bash
# Goblins Yard - database backup (Linux/macOS). Cron example (daily 4am):
#   0 4 * * * /path/to/Goblins-POS/scripts/backup.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$ROOT/backups"
mkdir -p "$DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
FILE="$DIR/goblins-$STAMP.sql.gz"
docker exec goblins-pos-db-1 pg_dump -U goblins -d goblins_pos --clean --if-exists | gzip > "$FILE"
# keep last 30
ls -1t "$DIR"/goblins-*.sql.gz | tail -n +31 | xargs -r rm
echo "Backup written: $FILE"
