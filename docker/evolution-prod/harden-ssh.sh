#!/usr/bin/env bash
# Desativa login por senha e login direto do root no SSH. Só rode DEPOIS de confirmar, em outra
# janela, que `ssh imobflux@<IP>` entra sem senha. Rode como root.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Rode como root." >&2
  exit 1
fi

APP_USER="${APP_USER:-imobflux}"
KEYS="/home/$APP_USER/.ssh/authorized_keys"

# Trava de segurança: sem chave instalada para o usuário, desativar a senha trancaria você fora.
if [ ! -s "$KEYS" ]; then
  echo "ERRO: $KEYS não existe ou está vazio. Nada foi alterado." >&2
  exit 1
fi

# O nome começa com 00 de propósito: no sshd vale a PRIMEIRA ocorrência de cada opção, e o
# provedor pode ter deixado um arquivo (ex.: 50-cloud-init.conf) com PasswordAuthentication yes.
cat > /etc/ssh/sshd_config.d/00-hardening.conf <<'CONF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
PubkeyAuthentication yes
MaxAuthTries 4
CONF

sshd -t
systemctl reload ssh 2>/dev/null || systemctl reload sshd

echo "Configuração efetiva do sshd:"
sshd -T | grep -E '^(passwordauthentication|kbdinteractiveauthentication|permitrootlogin|pubkeyauthentication) '
echo
echo "Mantenha esta sessão aberta e confirme em outra janela: ssh $APP_USER@<IP> entra; ssh root@<IP> é recusado."
