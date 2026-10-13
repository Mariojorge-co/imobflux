#!/usr/bin/env bash
# Backup diário do Postgres da Evolution (instâncias e sessão do WhatsApp). Mantém 7 dias.
# Perder isso não perde mensagens do CRM, mas exige ler o QR code de novo.
# Agende: (crontab -e)  15 4 * * * /home/SEU_USUARIO/evolution-prod/backup.sh
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p backups
docker compose exec -T evolution-postgres pg_dump -U evolution evolution | gzip > "backups/evolution-$(date +%Y%m%d).sql.gz"
find backups -name 'evolution-*.sql.gz' -mtime +7 -delete
