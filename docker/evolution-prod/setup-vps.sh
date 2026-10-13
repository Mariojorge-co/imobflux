#!/usr/bin/env bash
# Prepara uma VPS Debian 12 (ou Ubuntu) com IP fixo: atualizações, usuário de serviço, Docker,
# firewall (ufw: 22, 80, 443), fail2ban e atualizações de segurança automáticas.
# Rode UMA vez, como root, com a pasta evolution-prod já enviada (ex.: /root/evolution-prod).
# É seguro rodar de novo (idempotente).
#
# Variáveis opcionais (para testes): SETUP_SKIP_DOCKER=1  SETUP_SKIP_FIREWALL=1
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Rode como root." >&2
  exit 1
fi

APP_USER="${APP_USER:-imobflux}"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export DEBIAN_FRONTEND=noninteractive

echo "==> 1/6 Atualizando pacotes"
apt-get update -y
apt-get upgrade -y
apt-get install -y sudo curl ca-certificates gnupg ufw fail2ban unattended-upgrades python3-systemd openssh-server

echo "==> 2/6 Usuário de serviço '$APP_USER' (login só por chave SSH)"
if ! id "$APP_USER" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" "$APP_USER"
fi
usermod -aG sudo "$APP_USER"
echo "$APP_USER ALL=(ALL) NOPASSWD:ALL" > "/etc/sudoers.d/90-$APP_USER"
chmod 440 "/etc/sudoers.d/90-$APP_USER"
install -d -m 700 -o "$APP_USER" -g "$APP_USER" "/home/$APP_USER/.ssh"
if [ -s /root/.ssh/authorized_keys ]; then
  cat /root/.ssh/authorized_keys >> "/home/$APP_USER/.ssh/authorized_keys"
  sort -u "/home/$APP_USER/.ssh/authorized_keys" -o "/home/$APP_USER/.ssh/authorized_keys"
  chown "$APP_USER:$APP_USER" "/home/$APP_USER/.ssh/authorized_keys"
  chmod 600 "/home/$APP_USER/.ssh/authorized_keys"
else
  echo "AVISO: /root/.ssh/authorized_keys está vazio. Instale sua chave pública antes de desativar a senha." >&2
fi

echo "==> 3/6 Docker"
if [ "${SETUP_SKIP_DOCKER:-0}" != "1" ]; then
  if ! command -v docker >/dev/null; then
    curl -fsSL https://get.docker.com | sh
  fi
  systemctl enable --now docker
  usermod -aG docker "$APP_USER"
fi

echo "==> 4/6 Firewall (ufw): libera 22, 80 e 443; bloqueia o resto"
if [ "${SETUP_SKIP_FIREWALL:-0}" != "1" ]; then
  ufw default deny incoming
  ufw default allow outgoing
  ufw allow 22/tcp
  ufw allow 80/tcp
  ufw allow 443/tcp
  ufw --force enable
fi

echo "==> 5/6 fail2ban (bloqueia quem erra o SSH repetidamente)"
install -d /etc/fail2ban/jail.d
cat > /etc/fail2ban/jail.d/sshd.local <<'JAIL'
[sshd]
enabled = true
backend = systemd
maxretry = 5
findtime = 10m
bantime = 1h
JAIL
systemctl enable fail2ban
systemctl restart fail2ban || echo "AVISO: fail2ban não reiniciou (ambiente de teste?)" >&2

echo "==> 6/6 Atualizações de segurança automáticas"
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'AUTO'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
AUTO

DEST="/home/$APP_USER/evolution-prod"
if [ "$SRC_DIR" != "$DEST" ]; then
  rm -rf "$DEST"
  cp -r "$SRC_DIR" "$DEST"
fi
# Garante quebra de linha LF (arquivos vindos do Windows podem trazer CRLF).
find "$DEST" -maxdepth 1 -type f \( -name '*.sh' -o -name 'Caddyfile' -o -name 'docker-compose.yml' -o -name '.env.example' \) -exec sed -i 's/\r$//' {} +
chmod +x "$DEST"/*.sh
chown -R "$APP_USER:$APP_USER" "$DEST"

echo
echo "Pronto. Próximos passos:"
echo "  1) Em OUTRA janela do PowerShell, teste:  ssh $APP_USER@<IP>   (deve entrar sem pedir senha)"
echo "  2) Só depois, como root:  bash $DEST/harden-ssh.sh"
echo "  3) Como $APP_USER:  cd ~/evolution-prod && cp .env.example .env && nano .env && docker compose up -d"
