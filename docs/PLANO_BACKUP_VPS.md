# Plano de backup automático da VPS (Evolution, Postgres, Caddy)

> **Só o plano.** Nada foi acessado na VPS (nem SSH, nem consulta). Tudo abaixo vem do que o repositório define (`docker/evolution-prod/`, `docs/DEPLOY_EVOLUTION_VPS.md`). O que o repositório **não consegue dizer** (se o cron do `backup.sh` foi mesmo instalado, quanto disco está livre, quantos backups existem) está marcado **a verificar na VPS**, pelo Mário ou numa sessão futura autorizada.

## 1. O que roda na VPS
Contabo Cloud VPS (4 vCPU, 8 GB, 100 GB, Debian 12), com Docker Compose em `~/evolution-prod/`:

| Serviço | Imagem | Dado persistente | Importância |
|---|---|---|---|
| `evolution-api` | `evoapicloud/evolution-api:v2.3.7` | nada em disco próprio (usa o Postgres) | A sessão do WhatsApp está **no Postgres** |
| `evolution-postgres` | `postgres:16-alpine` | volume `evolution_postgres_data` | **Crítico**: instância, sessão (QR), mensagens salvas pela Evolution |
| `caddy` | `caddy:2-alpine` | volumes `caddy_data` (certificados) e `caddy_config` | Baixa: o Caddy emite o certificado de novo sozinho |
| Arquivos | `.env`, `docker-compose.yml`, `Caddyfile`, `backup.sh` | `~/evolution-prod/` | `.env` guarda os **segredos**; os demais estão no repositório |

O CRM (mensagens, contatos, mídia) fica no **Supabase**, não na VPS. Perder a VPS **não** perde o CRM: perde a sessão do WhatsApp (basta ler o QR de novo) e o que só existia na Evolution.

## 2. Estado atual (pelo repositório)
Existe `backup.sh`: `pg_dump` do banco `evolution` comprimido (`backups/evolution-AAAAMMDD.sql.gz`), permissão 600, **retenção de 7 dias**, agendado por cron às 04:15 (`15 4 * * *`). O guia manda copiar de vez em quando para o PC por `scp`. **Lacunas**: (a) a cópia fica **na própria VPS** (se a VPS morre, o backup morre junto); (b) a cópia para fora é manual; (c) não há aviso quando o backup falha; (d) a restauração nunca foi ensaiada (que se saiba); (e) o `.env` e os volumes do Caddy não entram. **A verificar na VPS**: se o cron realmente existe (`crontab -l`) e se `backup.log` mostra "backup ok" todo dia.

## 3. O que salvar
1. **Dump lógico do Postgres da Evolution** (já existe). É o item que importa.
2. **Segredos** (`.env`: `AUTHENTICATION_API_KEY`, `POSTGRES_PASSWORD`, `DOMAIN`): guardar **em gerenciador de senhas**, não em arquivo de backup comum. Sem eles não se reconstrói a ligação com a Vercel.
3. **Configuração** (`docker-compose.yml`, `Caddyfile`, scripts): já está versionada no repositório; basta anotar a **versão da imagem** em uso.
4. **Certificados do Caddy** (`caddy_data`): opcional. Reemitir é automático; o único risco é o limite de emissões do Let's Encrypt (domínio `sslip.io` é compartilhado). Se quiser, copie o volume 1 vez por semana.
5. **Não** salvar: logs, imagens Docker, o conteúdo de `node_modules`.

## 4. Frequência e retenção (proposta)
| Camada | Frequência | Retenção | Onde |
|---|---|---|---|
| Dump local | diário 04:15 (já existe) | 7 dias | VPS (`~/evolution-prod/backups/`) |
| **Cópia externa** | diário, logo depois do dump | **30 dias** (diários) + 6 mensais | fora da VPS (ver seção 5) |
| Snapshot da VPS (painel Contabo) | semanal, antes de mudanças grandes | 2 a 4 | Contabo (custo do plano; conferir) |
| Cópia manual no PC | mensal | 3 | PC do Mário (`scp`) |

## 5. Onde guardar (opções)
- **A. Storage de objetos barato** (Backblaze B2, Cloudflare R2 com `rclone`, ou bucket privado do Supabase): enviar o `.sql.gz` **criptografado** (`age` ou `gpg`, chave guardada fora da VPS). Custo de centavos por mês para poucos MB. **Recomendada.**
- **B. Outro servidor/PC com `rsync` por SSH** (chave só de escrita): sem custo, mas exige máquina ligada.
- **C. Só snapshot do provedor**: simples, mas atado ao mesmo provedor e à mesma conta.
O backup contém a **sessão do WhatsApp**: quem tiver o arquivo pode assumir a conta. Por isso: criptografar antes de sair da VPS, bucket privado, acesso só do Mário.

## 6. Como automatizar (desenho, sem executar)
1. Estender o `backup.sh` (no repositório, revisado e testado em máquina de teste): depois do dump, **testar o arquivo** (`gunzip -t`, tamanho mínimo), **criptografar** e **enviar** com `rclone copy`; registrar em `backup.log`.
2. **Alerta de falha**: no fim do script, uma chamada a um serviço de "heartbeat" (healthchecks.io, plano gratuito) só se tudo deu certo; se o aviso não chegar no prazo, o serviço manda e-mail ao Mário. Falha silenciosa é o maior risco de backup.
3. **Retenção** na ponta externa por regra de ciclo de vida do bucket (30 dias).
4. Crontab com `flock` para não sobrepor execuções; usuário `imobflux`, nunca root.
5. Monitorar **espaço em disco** (alerta acima de 80%) e o tamanho do dump (queda brusca = problema).

## 7. Como testar a restauração (obrigatório, o backup só vale se restaura)
Ensaio **fora da produção** (máquina local com Docker ou VPS descartável), trimestral e depois de cada mudança do script:
1. Baixar o último backup externo, descriptografar.
2. Subir um Postgres 16 limpo (`docker run postgres:16-alpine`), criar o banco e `gunzip -c arquivo | psql`.
3. Conferir: tabelas de instância existem, contagem de linhas coerente, sem erro no `psql`.
4. (Opcional, mais forte) subir a Evolution `v2.3.7` apontando para esse Postgres de teste, **sem** conectar ao WhatsApp, e ver que a instância aparece.
5. Registrar data, duração e resultado (tabela no fim deste documento).
**Cuidado**: nunca restaurar apontando para o WhatsApp de verdade enquanto a produção está de pé: duas Evolutions com a mesma sessão derrubam a conta.

## 8. Plano de desastre (resumo)
| Cenário | O que fazer | Perda |
|---|---|---|
| Contêiner da Evolution travou | `docker compose restart` | nenhuma |
| Disco corrompido / VPS perdida | Nova VPS com `setup-vps.sh`, `docker compose up`, restaurar o dump, apontar o domínio/segredos na Vercel (webhook e chave) | mensagens recebidas depois do último backup que só existiam na Evolution; o CRM não perde nada |
| Backup inexistente | Nova instância e leitura do QR | sessão antiga; histórico recente pode vir de novo pela janela de histórico (0 a 15 dias) |
| Conta do WhatsApp banida | fora do alcance de backup | n/a |

## 9. Riscos
Backup só na VPS; falha silenciosa do cron; backup sem criptografia vazando a sessão; disco cheio; restaurar sem testar; chave de criptografia perdida (guardar em dois lugares).

## 10. Esforço estimado
| Etapa | Esforço |
|---|---|
| Revisar o estado atual na VPS (cron, logs, espaço) | 0,5 hora (Mário ou sessão autorizada) |
| Estender `backup.sh` + testes em máquina local | 0,5 dia |
| Conta no bucket + `rclone` + criptografia + heartbeat | 0,5 dia |
| Ensaio de restauração e registro | 0,5 dia |

## 11. Decisões que o Mário precisa tomar
1. Onde guardar a cópia externa (B2/R2, Supabase Storage, outro servidor) e o orçamento mensal?
2. Retenção desejada (30 dias + mensais) está boa?
3. Autoriza uma sessão futura **com acesso à VPS** só para verificar o cron e o espaço em disco (hoje nada foi acessado)?
4. Quem recebe o alerta de falha (e-mail do Mário)?
5. Quer snapshot semanal do provedor, ciente do custo?
