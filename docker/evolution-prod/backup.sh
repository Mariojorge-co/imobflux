#!/usr/bin/env bash
# Backup diário do Postgres da Evolution (instâncias e sessão do WhatsApp). Mantém 7 dias.
# Perder isso não perde mensagens do CRM, mas exige ler o QR code de novo.
# Agende como o usuário imobflux (crontab -e):
#   15 4 * * * /home/imobflux/evolution-prod/backup.sh >> /home/imobflux/evolution-prod/backups/backup.log 2>&1
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p backups
chmod 700 backups
OUT="backups/evolution-$(date +%Y%m%d).sql.gz"
docker compose exec -T evolution-postgres pg_dump -U evolution evolution | gzip > "$OUT.tmp"
mv "$OUT.tmp" "$OUT"
chmod 600 "$OUT"
find backups -name 'evolution-*.sql.gz' -mtime +7 -delete
echo "$(date -Is) backup ok: $OUT ($(du -h "$OUT" | cut -f1))"
