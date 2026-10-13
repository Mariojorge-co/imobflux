> **DESCARTADO:** o Google Cloud exigiu pré-pagamento e foi abandonado. Use [DEPLOY_EVOLUTION_VPS.md](DEPLOY_EVOLUTION_VPS.md). Este arquivo fica só como histórico; o `docker-compose.yml` atual está dimensionado para 8 GB de RAM (não para a e2-micro) e o `setup-vm.sh` foi substituído por `setup-vps.sh`.

# Evolution API em produção — Google Cloud (e2-micro) + Vercel + teste com celular

Objetivo: deixar a Evolution API acessível por HTTPS na internet para o ImobFlux (Vercel) conectar um
número de WhatsApp real. Arquivos prontos em `docker/evolution-prod/`.

> **Condições do free tier mudam.** Antes de começar, confirme em cloud.google.com/free: 1 instância
> e2-micro por mês, **somente** nas regiões `us-west1`, `us-central1` ou `us-east1`, 30 GB de disco
> padrão, e franquia de saída de rede limitada. Mesmo no gratuito a conta exige cartão e faturamento
> ativo. Crie um **alerta de orçamento** (Faturamento > Orçamentos e alertas) de R$ 10 para não ter
> surpresa.

## 0. O que você vai precisar
- Conta Google com faturamento ativado.
- O endereço do app no Vercel (ex.: `https://imobflux.vercel.app`).
- Um celular com WhatsApp. **Use um número dedicado**, não o pessoal (a Evolution usa o protocolo não
  oficial do WhatsApp Web; há risco de bloqueio do número).

## 1. Criar a VM (Cloud Shell, no navegador)
Abra console.cloud.google.com, selecione/crie um projeto, ative a API *Compute Engine* e clique no ícone
`>_` (Cloud Shell). Cole, trocando `SEU_PROJETO`:

```bash
gcloud config set project SEU_PROJETO
gcloud compute addresses create evolution-ip --region=us-central1
gcloud compute instances create evolution \
  --zone=us-central1-a --machine-type=e2-micro \
  --image-family=debian-12 --image-project=debian-cloud \
  --boot-disk-size=30GB --boot-disk-type=pd-standard \
  --address=evolution-ip --tags=evolution-web
gcloud compute firewall-rules create evolution-web --allow=tcp:80,tcp:443 --target-tags=evolution-web
gcloud compute addresses describe evolution-ip --region=us-central1 --format='value(address)'
```

O último comando mostra o **IP** (ex.: `34.12.56.78`). Seu domínio será o IP com traços + `.sslip.io`:
`34-12-56-78.sslip.io` (grátis; resolve para o IP e permite HTTPS automático).

## 2. Enviar os arquivos
No Cloud Shell, menu `⋮` > **Upload** > envie a pasta `docker/evolution-prod` (no seu PC). Depois:

```bash
gcloud compute scp --recurse evolution-prod evolution:~ --zone=us-central1-a
gcloud compute ssh evolution --zone=us-central1-a
```

## 3. Preparar a VM e subir
Já dentro da VM:

```bash
cd ~/evolution-prod && bash setup-vm.sh
exit        # entre de novo para o grupo docker valer
```
```bash
gcloud compute ssh evolution --zone=us-central1-a
cd ~/evolution-prod
cp .env.example .env
echo "chave:  $(openssl rand -hex 32)"     # anote: vai para EVOLUTION_API_KEY
echo "senha:  $(openssl rand -hex 24)"
nano .env     # DOMAIN=34-12-56-78.sslip.io  | AUTHENTICATION_API_KEY=<chave> | POSTGRES_PASSWORD=<senha>
docker compose up -d
docker compose ps          # 3 serviços "running"
```

Teste (troque o domínio e a chave):
```bash
curl -s https://34-12-56-78.sslip.io/                         # "Welcome to the Evolution API"
curl -s -o /dev/null -w "%{http_code}\n" https://34-12-56-78.sslip.io/instance/fetchInstances        # 401
curl -s -o /dev/null -w "%{http_code}\n" -H "apikey: SUA_CHAVE" https://34-12-56-78.sslip.io/instance/fetchInstances   # 200
```
O certificado leva ~1 min na primeira vez. Se der erro de certificado, confira `docker compose logs caddy`
(portas 80/443 abertas e o domínio certo no `.env`).

Backup diário (opcional, recomendado): `crontab -e` e adicione
`15 4 * * * /home/SEU_USUARIO/evolution-prod/backup.sh`.

## 4. Configurar o Vercel
Vercel > projeto > Settings > Environment Variables (ambiente **Production**):

| Nome | Valor |
|---|---|
| `EVOLUTION_API_URL` | `https://34-12-56-78.sslip.io` (sem barra no final) |
| `EVOLUTION_API_KEY` | a chave do passo 3 |
| `EVOLUTION_WEBHOOK_SECRET` | outro segredo: `openssl rand -hex 32` (pode gerar no Cloud Shell) |

Não defina `WHATSAPP_WEBHOOK_BASE_URL` (o app usa o próprio endereço público). **Depois de salvar,
faça um Redeploy** (Deployments > ⋯ > Redeploy): variáveis novas só valem em deploys novos.
Guarde as chaves num gerenciador de senhas; nunca em chat, e-mail ou no repositório.

## 5. Teste com o celular (roteiro)
Faça logado como **OWNER** no app de produção. Anote o que acontecer em cada passo.

1. **Configurações > WhatsApp > Conectar WhatsApp.** Deve aparecer o QR code (não o aviso de "não
   configurado"). Se aparecer erro, a mensagem diz qual (chave, segredo, endereço).
2. No celular: WhatsApp > Aparelhos conectados > Conectar aparelho > leia o QR em até ~30 s (a tela
   renova sozinha).
3. A tela deve virar **"WhatsApp conectado"** com o número e **"Importando o histórico recente…"**.
   Em até ~10 min vira "Histórico importado: N mensagens" ou o **aviso de falha** (anote qual).
4. De **outro celular**, mande "Oi, quero financiar um apartamento" para o número conectado. Em poucos
   segundos deve surgir a conversa em Conversas, com selo de SLA **verde** ("Cliente aguardando").
5. Responda pelo ImobFlux. O texto deve chegar no outro celular e o selo mudar para o estado de
   "aguardando cliente".
6. Mande do outro celular uma **foto**, um **PDF** e um **áudio**: devem aparecer na conversa e abrir
   dentro do CRM.
7. Em Conversas, abra uma conversa que veio do **histórico**: deve ter o separador "Histórico
   importado" e **não** ter selo de SLA.
8. Marque um contato como protegido e entre com um **ATTENDANT** (outro navegador): a conversa dele não
   pode aparecer. Um grupo do WhatsApp deve aparecer só para o OWNER.
9. Configurações > WhatsApp > **Desconectar** e conecte de novo: confira que o aviso de histórico e a
   conexão se comportam como no passo 3.

O que me enviar: o resultado de cada passo (ok/falhou), prints das falhas, e quantas conversas/mensagens
vieram do histórico (isso mede o que o celular realmente envia).

## 6. Operação
- Ver logs: `cd ~/evolution-prod && docker compose logs -f --tail=100 evolution-api`
- Reiniciar: `docker compose restart`
- Atualizar a versão: troque a tag da imagem no `docker-compose.yml` (teste antes) e `docker compose up -d`.
- Memória: a VM tem 1 GB + 2 GB de swap. Em repouso a stack usa ~220 MB. Se travar por falta de
  memória, `free -h` e `docker stats` mostram quem consome.
- Se a sessão do WhatsApp cair (celular desligado por muito tempo, logout), a tela do WhatsApp mostra
  "desconectado" e basta ler o QR de novo.
- Segurança: só as portas 80/443 estão abertas; o painel `/manager` da Evolution está bloqueado; a API
  exige a chave. Para trocar a chave: edite o `.env`, `docker compose up -d` e atualize no Vercel +
  Redeploy.
