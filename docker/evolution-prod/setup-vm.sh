#!/usr/bin/env bash
# Prepara a VM Debian/Ubuntu (e2-micro, 1 GB): swap, Docker e atualizações de segurança automáticas.
# Rode uma vez, como seu usuário (usa sudo).
set -euo pipefail

if ! swapon --show | grep -q /swapfile; then
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
  echo 'vm.swappiness=20' | sudo tee /etc/sysctl.d/99-swappiness.conf >/dev/null
  sudo sysctl -p /etc/sysctl.d/99-swappiness.conf >/dev/null
fi

if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER"
fi

sudo apt-get update -y
sudo apt-get install -y unattended-upgrades

echo "Pronto. Saia e entre de novo na VM (para o grupo docker valer) antes de subir a stack."
