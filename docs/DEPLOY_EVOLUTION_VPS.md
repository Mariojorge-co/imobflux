# Evolution API em produção — VPS Linux (Contabo) + Vercel + teste com celular

Substitui `DEPLOY_EVOLUTION_GCP.md` (Google Cloud descartado). Serve para qualquer VPS Debian 12 / Ubuntu
com IP fixo e acesso root por SSH. Arquivos prontos em `docker/evolution-prod/`.

Cenário deste guia: Contabo Cloud VPS 4 (4 vCPU, 8 GB, 100 GB), Debian 12, IP `207.180.252.4`,
domínio `207-180-252-4.sslip.io`. **Todos os comandos marcados "PC" rodam no PowerShell do Windows;
os marcados "VPS" rodam dentro da VPS (depois do `ssh`).** Nunca cole senhas ou chaves em chat, e-mail
ou no repositório.

## Visão geral e como enviar os arquivos

**Caminho mais simples e seguro: `scp` do PC.** A pasta é pequena (5 arquivos), o `scp` já vem no Windows
e nada de credencial precisa ficar na VPS. O `git clone` só compensa se o repositório for público; sendo
privado, você teria de guardar um token do GitHub dentro da VPS (mais um segredo para proteger). Quando
precisar atualizar os arquivos no futuro, basta repetir o `scp`.

Ordem (a senha do root só é usada no começo; no fim o login passa a ser só por chave, com um usuário
`imobflux`):

1. Conferir a VPS e criar uma chave SSH no PC.
2. Enviar a pasta e a chave pública.
3. Rodar `setup-vps.sh` (atualizações, usuário, Docker, firewall, fail2ban, atualizações automáticas).
4. Testar o login por chave e **só então** desativar a senha (`harden-ssh.sh`).
5. Subir a stack (Evolution + Postgres + Caddy com HTTPS), testar, configurar o Vercel e o celular.

> Se o painel da Contabo tiver o firewall do provedor ligado, libere as portas 22, 80 e 443 nele também.

## 1. Conferir a VPS e criar a chave (PC)

```powershell
ssh root@207.180.252.4 "cat /etc/os-release | head -2; free -h | head -2; df -h / | tail -1"
```
Na primeira vez o SSH mostra a impressão digital do servidor e pergunta `yes/no`: responda `yes`
(é a primeira conexão com uma máquina nova que você mesmo acabou de contratar). Esperado: Debian 12
(bookworm), ~8 GB de RAM, ~100 GB de disco.

Crie uma chave dedicada (digite uma frase-senha quando pedir; ela protege a chave se alguém copiar o arquivo):

```powershell
ssh-keygen -t ed25519 -C "imobflux-vps" -f "$env:USERPROFILE\.ssh\imobflux_vps"
```
Isso gera `imobflux_vps` (**privada, nunca compartilhe**) e `imobflux_vps.pub` (pública).

## 2. Enviar a pasta e a chave pública (PC)

```powershell
scp -r "C:\Users\User\Desktop\PROJETOS\CRM Corretor\docker\evolution-prod" root@207.180.252.4:/root/
scp "$env:USERPROFILE\.ssh\imobflux_vps.pub" root@207.180.252.4:/root/imobflux_vps.pub
```
(Pede a senha do root a cada comando.)

## 3. Instalar a chave no root e rodar o setup (VPS)

```powershell
ssh root@207.180.252.4
```
Já dentro da VPS:

```bash
mkdir -p ~/.ssh && chmod 700 ~/.ssh
tr -d '\r' < ~/imobflux_vps.pub >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
rm ~/imobflux_vps.pub
exit
```
De volta ao PowerShell, confirme que a chave funciona (deve entrar pedindo só a frase-senha da chave,
**não** a senha do root):

```powershell
ssh -i "$env:USERPROFILE\.ssh\imobflux_vps" root@207.180.252.4
```
Dentro da VPS, rode o setup (leva alguns minutos):

```bash
bash /root/evolution-prod/setup-vps.sh
```
O script: atualiza o sistema; cria o usuário `imobflux` (sem senha, só chave) e copia a sua chave para ele;
instala o Docker; configura o firewall **ufw** (libera 22, 80 e 443, bloqueia o resto); instala o
**fail2ban** (bloqueia por 1 h quem errar o SSH 5 vezes); liga as **atualizações de segurança
automáticas**; e copia a pasta para `/home/imobflux/evolution-prod` (já convertendo quebras de linha do
Windows). Pode rodar de novo sem problema. Swap grande não é necessário com 8 GB de RAM.

## 4. Testar o novo login e desativar a senha

**Em OUTRA janela do PowerShell** (mantenha a do root aberta como rede de segurança):

```powershell
ssh -i "$env:USERPROFILE\.ssh\imobflux_vps" imobflux@207.180.252.4 "whoami; docker ps"
```
Esperado: `imobflux` e uma lista vazia de contêineres (sem erro de permissão). Só se isso funcionou, na
janela do root:

```bash
bash /home/imobflux/evolution-prod/harden-ssh.sh
```
O script recusa-se a agir se o usuário `imobflux` não tiver chave instalada (evita trancar você fora).
Ele desativa login por senha e o login direto do root, valida a configuração (`sshd -t`) e mostra a
configuração efetiva (`passwordauthentication no`, `permitrootlogin no`). Confirme no PowerShell:

```powershell
ssh -i "$env:USERPROFILE\.ssh\imobflux_vps" imobflux@207.180.252.4 "echo entrou"        # deve entrar
ssh -o PubkeyAuthentication=no root@207.180.252.4                                        # deve dizer: Permission denied
```
Daqui em diante use sempre o usuário `imobflux` (tem `sudo` sem senha). Para facilitar, crie um atalho no PC:

```powershell
Add-Content "$env:USERPROFILE\.ssh\config" "`nHost imobflux-vps`n  HostName 207.180.252.4`n  User imobflux`n  IdentityFile ~/.ssh/imobflux_vps"
ssh imobflux-vps
```

> **Se ficar trancado fora:** o painel da Contabo tem um console VNC (acesso direto à máquina) onde dá para
> logar com a senha do root e remover `/etc/ssh/sshd_config.d/00-hardening.conf`.

## 5. Subir a stack (VPS, como `imobflux`)

```bash
cd ~/evolution-prod
KEY=$(openssl rand -hex 32); PASS=$(openssl rand -hex 24)
printf 'DOMAIN=207-180-252-4.sslip.io\nAUTHENTICATION_API_KEY=%s\nPOSTGRES_PASSWORD=%s\n' "$KEY" "$PASS" > .env
chmod 600 .env
echo "EVOLUTION_API_KEY (copie para o Vercel e guarde num gerenciador de senhas): $KEY"
echo "EVOLUTION_WEBHOOK_SECRET (outro segredo, para o Vercel): $(openssl rand -hex 32)"
docker compose up -d
docker compose ps        # evolution-api, evolution-postgres e caddy: "running"
```
O compose está dimensionado para esta VPS (Evolution até 2 GB, Postgres até 1 GB, logs com rotação de
10 MB x 3). Em repouso a stack usa ~300 MB. Aguarde cerca de 1 minuto para o certificado HTTPS.

## 6. Testes (PC; use `curl.exe`, pois `curl` no PowerShell é outro comando)

```powershell
curl.exe -s https://207-180-252-4.sslip.io/                                                    # Welcome to the Evolution API
curl.exe -s -o NUL -w "%{http_code}`n" https://207-180-252-4.sslip.io/instance/fetchInstances                        # 401
curl.exe -s -o NUL -w "%{http_code}`n" -H "apikey: SUA_CHAVE" https://207-180-252-4.sslip.io/instance/fetchInstances  # 200
curl.exe -s -o NUL -w "%{http_code}`n" https://207-180-252-4.sslip.io/manager                                        # 404 (painel bloqueado)
```
Se o certificado falhar, na VPS: `docker compose logs caddy`. Causas comuns: portas 80/443 bloqueadas no
painel da Contabo, ou o limite compartilhado do Let's Encrypt para `sslip.io` (tente de novo mais tarde
ou use um domínio seu: aponte um registro `A` para o IP e coloque o domínio no `DOMAIN` do `.env`).

## 7. Configurar o Vercel

Vercel > projeto > Settings > Environment Variables (ambiente **Production**):

| Nome | Valor |
|---|---|
| `EVOLUTION_API_URL` | `https://207-180-252-4.sslip.io` (sem barra no final) |
| `EVOLUTION_API_KEY` | a chave impressa no passo 5 |
| `EVOLUTION_WEBHOOK_SECRET` | o segredo impresso no passo 5 |

Não defina `WHATSAPP_WEBHOOK_BASE_URL`. **Depois de salvar, faça um Redeploy** (Deployments > ⋯ > Redeploy):
variáveis novas só valem em deploys novos.

## 8. Teste com o celular (roteiro)

Use um **número dedicado** (a Evolution usa o protocolo não oficial do WhatsApp Web; há risco de bloqueio).
Faça logado como **OWNER** no app de produção e anote o resultado de cada passo.

1. **Configurações > WhatsApp > Conectar WhatsApp.** Deve aparecer o QR code (não o aviso de "não
   configurado"). Se aparecer erro, a mensagem diz qual (chave, segredo, endereço).
2. No celular: WhatsApp > Aparelhos conectados > Conectar aparelho > leia o QR em até ~30 s (a tela renova
   sozinha).
3. A tela deve virar **"WhatsApp conectado"** com o número e **"Importando o histórico recente…"**. Em até
   ~10 min vira "Histórico importado: N mensagens" ou o **aviso de falha** (anote qual).
4. De **outro celular**, mande "Oi, quero financiar um apartamento" para o número conectado. Em poucos
   segundos deve surgir a conversa em Conversas, com selo de SLA **verde** ("Cliente aguardando").
5. Responda pelo ImobFlux. O texto deve chegar no outro celular e o selo mudar para "aguardando cliente".
6. Mande do outro celular uma **foto**, um **PDF** e um **áudio**: devem aparecer na conversa e abrir dentro
   do CRM.
7. Abra uma conversa que veio do **histórico**: deve ter o separador "Histórico importado" e **não** ter
   selo de SLA.
8. Marque um contato como protegido e entre com um **ATTENDANT** (outro navegador): a conversa dele não pode
   aparecer. Um grupo do WhatsApp deve aparecer só para o OWNER.
9. Configurações > WhatsApp > **Desconectar** e conecte de novo: confira que o aviso de histórico e a
   conexão se comportam como no passo 3.

O que me enviar: resultado de cada passo (ok/falhou), prints das falhas e quantas conversas/mensagens
vieram do histórico (mede o que o celular realmente envia).

## 9. Backup diário (VPS, como `imobflux`)

```bash
cd ~/evolution-prod && ./backup.sh                        # teste manual: "backup ok"
(crontab -l 2>/dev/null; echo "15 4 * * * /home/imobflux/evolution-prod/backup.sh >> /home/imobflux/evolution-prod/backups/backup.log 2>&1") | crontab -
crontab -l
```
Guarda 7 dias em `~/evolution-prod/backups/` (só o dono lê). O backup contém a sessão do WhatsApp:
trate como segredo. Perder isso não perde mensagens do CRM, só exige ler o QR de novo. Para guardar uma cópia
no PC de vez em quando:

```powershell
scp imobflux-vps:~/evolution-prod/backups/evolution-*.sql.gz "$env:USERPROFILE\Documents\"
```

## 10. Operação e verificação de segurança (VPS)

```bash
sudo ufw status verbose                    # ativo; só 22, 80 e 443 liberadas
sudo fail2ban-client status sshd           # jail ativa (mostra IPs banidos, se houver)
sudo unattended-upgrade --dry-run -d | tail -3   # atualizações automáticas funcionando
[ -f /var/run/reboot-required ] && echo "precisa reiniciar (sudo reboot)"
cd ~/evolution-prod
docker compose logs -f --tail=100 evolution-api   # logs
docker compose restart                            # reiniciar
```
- **Docker e o ufw:** portas publicadas pelo Docker ignoram o ufw. Hoje só o Caddy publica (80/443, como
  desejado). Não adicione `ports:` aos outros serviços.
- **Atualizar a versão da Evolution:** troque a tag da imagem no `docker-compose.yml` (teste antes) e
  `docker compose up -d`. Para atualizar os arquivos, repita o `scp` do passo 2 para `/home/imobflux/`.
- **Trocar a chave da Evolution:** edite o `.env`, `docker compose up -d`, atualize no Vercel e faça Redeploy.
- Se a sessão do WhatsApp cair (celular desligado por muito tempo, logout), a tela do WhatsApp mostra
  "desconectado" e basta ler o QR de novo.
