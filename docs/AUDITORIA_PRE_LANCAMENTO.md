# Auditoria pré-lançamento (somente leitura)

> **Nada foi corrigido.** Auditoria feita sobre o repositório (`main` `ef87781`, branch `chore/noite-2`) e o **banco local** de teste. **Nenhum acesso à produção** (banco, Vercel, VPS, Evolution, WhatsApp). Valores de segredos nunca foram impressos; só arquivo e tipo.
> O que só dá para confirmar em produção (cabeçalhos HTTP reais, plano da Vercel, configuração do Supabase Auth, políticas do Storage de produção) está marcado **a confirmar**.

## Resumo (gravidade alta primeiro)

| # | Gravidade | Achado | Onde |
|---|---|---|---|
| 1 | **Alta** | Next.js 16.2.12 com avisos de segurança críticos/altos (correção em 16.4.4) | `package.json` |
| 2 | **Média** | Sem cabeçalhos de segurança (CSP, X-Frame-Options, Permissions-Policy etc.) | `next.config.ts`, `proxy.ts` |
| 3 | **Média** | Sem limite de taxa (rate limit) próprio nas rotas sensíveis; só o freio em memória do teste de push | rotas `app/api/*`, ações de login |
| 4 | **Média** | Mensagem bruta de erro do banco devolvida ao navegador em ações de conversa | `lib/conversations/actions.ts` |
| 5 | Média | Dependências indiretas com avisos altos (postcss, sharp, zod, nanoid, js-yaml, brace-expansion, source-map-js) | `package-lock.json` |
| 6 | Baixa | Proteção contra SSRF do avatar só cobre IPv4 literal | `app/api/contact-avatar/[contactPointId]/route.ts` |
| 7 | Baixa | Lista de rotas privadas do `proxy.ts` incompleta (a proteção real está nas páginas) | `lib/supabase/proxy.ts` |
| 8 | Baixa | Sem páginas próprias de erro/404 (`not-found`, `error`, `global-error`) | `app/` |
| 9 | Baixa | Bucket de mídia sem lista de tipos MIME permitidos | `whatsapp-media` |
| 10 | Baixa | `console.error` do webhook registra o objeto de erro inteiro em 2 pontos | `app/api/webhooks/whatsapp/route.ts` |
| 11 | Informativo | IP da VPS e domínio `sslip.io` em documentos/exemplo versionados | `docs/DEPLOY_EVOLUTION_*.md`, `docker/evolution-prod/.env.example` |
| 12 | Informativo | Chave de exemplo legível em `.env.evolution.example` (é um exemplo, não um segredo) | `docker/evolution/.env.evolution.example` |
| — | OK | RLS ligada e com política em todas as tabelas; `SECURITY DEFINER` todas com `search_path` vazio; `anon` sem acesso a dados; Storage fechado; webhook com segredo em tempo constante; sem segredo no repositório nem no histórico recente | ver abaixo |

---

## 1. Dependências

### 1.1 `npm audit` (não foi aplicada nenhuma correção)
Totais: **1 crítica, 7 altas, 15 moderadas** (23 pacotes).

**[ALTA] Next.js 16.2.12** (direto; correção disponível: **16.4.4**, mesma série 16). Avisos publicados para `>=16.0.0` (vários até `<=16.4.0`):
- RCE sem autenticação na API de otimização de imagem com SVG ou AVIF (`GHSA-2464-fhr4-w9xw`, `GHSA-2xp9-vwfh-vxw4`), RCE em `next/og` `ImageResponse` (`GHSA-vcvr-r3jv-pc5j`), RCE em funções `use cache` que devolvem arrays tipados (`GHSA-673q-mjm6-r5xr`), RCE em servidores Windows (`GHSA-p293-qw3h-jr36`).
- **Negação de serviço** no App Router com Server Actions (`GHSA-p3m5-59mp-jv5r`, alta), SSRF na otimização de imagem (alta), envenenamento de cache SSG/ISR e vazamentos moderados.
- **Aplicabilidade neste projeto (leitura do código):** não há `use cache` nem `ImageResponse`; hospedagem é a Vercel (Linux), então o aviso de Windows não se aplica; `next/image` é usado só em `components/ui/avatar.tsx` e não há `images` configurado (sem domínios remotos). **Já o aviso de Server Actions se aplica** (o app usa Server Actions em grande parte das telas), e a otimização de imagem existe como rota do Next. A Vercel pode ter mitigações de plataforma (**a confirmar**), mas não dá para contar com isso.
- **Recomendação:** pacote dedicado para subir `next` e `eslint-config-next` para 16.4.4 (ou a última 16.x), com a regressão completa de navegador e conferência do `AGENTS.md` (esta versão do Next muda APIs). Esforço: 0,5 a 1 dia. **Fazer antes do lançamento.**

**Dependências indiretas (altas), sem uso direto no código:** `postcss` (leitura de arquivo via `sourceMappingURL`, só no build — corrige com o próprio Next), `sharp` (vem do Next; corrige junto), `zod` (<4.6.6, esgotamento de memória; não é importado pelo código do app, vem de dependência), `nanoid`, `js-yaml`, `source-map-js`, `brace-expansion` (ferramentas de build/lint). O restante moderado é a cadeia do ESLint (`minimatch`), só desenvolvimento. **Recomendação:** `npm audit fix` sem `--force` num pacote de manutenção, depois do Next; o `eslint@4` sugerido pelo audit é um **falso conserto** (retrocesso) e não deve ser aplicado.

### 1.2 Desatualizados relevantes (`npm outdated`)
`next` 16.2.12 → 16.4.4; `eslint-config-next` → 16.4.4; `@supabase/supabase-js` 2.110.8 → 2.118.0 e `@supabase/ssr` 0.12.3 → 0.12.7 (correções, mesma série); `react`/`react-dom` 19.2.4 → 19.3.1; `@playwright/test` 1.62.1 → 1.64.1; `lucide-react`, `geist`, `tailwindcss` (patch). **Não** subir `typescript` 7, `eslint` 10 nem `@types/node` 26 sem pacote próprio (mudanças grandes).

---

## 2. Segredos (arquivo e tipo, nunca valor)

Varredura dos arquivos rastreados (598) e dos **200 commits mais recentes de todas as branches** (conteúdo alterado), com padrões de: JWT, chave privada (PEM), `sb_secret_`, token `sbp_`, atribuições `API_KEY/SECRET/PASSWORD/TOKEN`, URL com credencial, referência de projeto Supabase, IP da VPS.

| Resultado | Detalhe |
|---|---|
| JWT, chave privada, `sb_secret_`, token `sbp_`, referência `*.supabase.co` | **Nenhum** em arquivos rastreados **nem** no histórico recente |
| Arquivos `.env` versionados | Só os `*.example`; `.gitignore` bloqueia `.env*` (exceto exemplos) |
| `.env`/`.pem`/`.key` já adicionados em algum commit | **Nenhum** |
| Atribuições de segredo | `docker/evolution/.env.evolution.example` (valores de exemplo, 3 com texto-modelo e 1 chave de exemplo legível) e `tests/send-whatsapp.unit.spec.ts` (valor de teste obviamente falso) |
| URL com credencial | `docker/evolution-prod/docker-compose.yml` e `.env.evolution.example`: `postgresql://evolution:${...}@evolution-postgres` — **interpolação de variável**, não valor literal |
| IP da VPS / `sslip.io` | `docs/DEPLOY_EVOLUTION_VPS.md`, `docs/DEPLOY_EVOLUTION_GCP.md`, `docker/evolution-prod/.env.example` — **Informativo**: o IP é público por natureza (DNS/HTTPS), mas aparece em repositório; se o repositório for público, considerar trocar por marcador |
| Chaves VAPID | **Nenhuma** no repositório (a de teste é gerada em memória a cada execução) |

Conclusão: **nenhum segredo real encontrado.** Limite da varredura: histórico só dos 200 commits recentes; um segredo antigo exigiria `git log -p` completo (recomendado uma vez antes de abrir o repositório a terceiros). Verificar se o repositório no GitHub é **privado** (**a confirmar**).

---

## 3. Banco local (migrations até `20260802006800`)

| Verificação | Resultado |
|---|---|
| Tabelas de `public`/`private` com RLS **desligada** | **Nenhuma** (29 tabelas em `public`, todas com RLS ligada) |
| RLS ligada **sem nenhuma política** | **Nenhuma** |
| Funções `SECURITY DEFINER` com `search_path` diferente de vazio | **Nenhuma** (98 funções `SECURITY DEFINER` em `public`; os testes pgTAP de lista de permitidas contam e travam novas) |
| Funções executáveis por `anon` | Só 2 funções de **gatilho** (`private.start_whatsapp_history_import`, `public.prevent_append_only_mutation`) e 2 de `updated_at` — não chamáveis como RPC; **sem ação** |
| Tabelas com permissão para `anon` | **Nenhuma** |
| Permissões de `authenticated` nas tabelas | **Apenas `SELECT`** (escritas só por RPC), exceto `push_subscriptions` (SELECT/INSERT/DELETE de linhas próprias, protegidas por RLS). Sem excesso |
| Funções `private.*` executáveis por `authenticated` | 17: ajudantes de RLS/leitura (`can_access_*`, `active_member_context`, `sla_applies`, `search_message_candidates`, `is_self_conversation`…) — **necessárias** porque as políticas rodam com a pessoa logada; **Baixa/Informativo**: revisar se `private.start_whatsapp_history_import` (gatilho) precisa mesmo desse grant |
| Storage | 1 bucket, `whatsapp-media`, **privado**, 50 MiB; **nenhuma política** em `storage.objects` (acesso só por URL assinada gerada no servidor, 60 s). **Baixa:** sem `allowed_mime_types` (qualquer tipo) — a validação é só no app |
| Tabelas append-only | `audit_events` e `pipeline_history` bloqueiam UPDATE/DELETE por gatilho (bom para auditoria; relevante para `docs/ESTUDO_EXCLUSAO_CLIENTE.md`) |

**A confirmar em produção:** o Storage de produção ter as mesmas políticas/bucket (a migration `006400` ajusta o limite) e o Supabase Auth: confirmação de e-mail, política de senha, limites de envio de e-mail e se cadastro aberto (signup) está **desligado** (o app é só por convite).

---

## 4. Aplicação

### 4.1 Cabeçalhos de segurança — **[MÉDIA] #2**
`next.config.ts` só define um redirecionamento; `proxy.ts` só renova a sessão. Não há `headers()` configurado: **sem CSP, sem `X-Frame-Options`/`frame-ancestors` (clickjacking), sem `Permissions-Policy`, sem `X-Content-Type-Options`**. A Vercel acrescenta HSTS em domínios `*.vercel.app`/próprios (**a confirmar**); as rotas de download já enviam `Cache-Control: private, no-store`, e a confirmação de e-mail envia `Referrer-Policy: no-referrer`. Há um `dangerouslySetInnerHTML` (script de tema em `app/layout.tsx`, conteúdo fixo, sem entrada de usuário).
**Recomendação:** adicionar em `next.config.ts`: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` (ou `frame-ancestors 'none'`), `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (câmera/microfone/geolocalização desligados), e uma CSP em modo **report-only** primeiro (o script de tema inline exige `nonce` ou hash). Esforço 0,5 a 1 dia. Cuidado: o service worker e o `manifest` não devem ser afetados.

### 4.2 Rotas de API sem autenticação de sessão (todas as rotas, uma a uma)

| Rota | Pública? | Por quê / proteção |
|---|---|---|
| `POST /api/webhooks/whatsapp` | **Sim** (sem sessão) | É o destino da Evolution. Protegida por **segredo no cabeçalho** (`X-Evolution-Secret`, comparação `timingSafeEqual` sobre digest). Resposta 4xx/200 sem detalhes. Sem o segredo, nada é lido |
| `GET /auth/confirm` | **Sim** | Link de convite/recuperação por e-mail; valida `token_hash` (formato) e `type` (só `invite`/`recovery`); destino por `authFlowDestination` (lista fechada, sem redirecionamento aberto); `Cache-Control: no-store`, `Referrer-Policy: no-referrer` |
| `GET /api/attachments/[id]` | Não | 401 sem login; 404 para UUID inválido; URL assinada de 60 s; `Cache-Control: private, no-store` |
| `GET /api/contact-avatar/[id]` | Não | 401 sem login; ver achado #6 |
| `GET /api/export/[kind]` | Não | 401 sem login, 403 se não for proprietário, checagem `sec-fetch-site` |
| `GET/POST/PATCH/DELETE /api/push/subscriptions` e `POST /api/push/test` | Não | 401 sem login, 403 de outra origem, `Cache-Control: no-store`; sem chaves VAPID responde 503 |
Páginas públicas: `/login`, `/setup`, `/convite`, `/redefinir-senha`, `/manifest.webmanifest`, `/sw-avisos.js`, ícones.
**Sem achado** de rota sensível aberta. Em produção, o smoke de 2026-11 confirmou 401 nas rotas de push sem login.

### 4.3 Limite de taxa — **[MÉDIA] #3**
Não há limite de taxa no código do app, exceto o freio **em memória** do aviso de teste de push (1 pendente e 5 s). Exposição: o **webhook** (protegido por segredo, mas sem limite se o segredo vazar), as **ações de login/redefinir senha/convite** (o Supabase Auth aplica seus próprios limites — **a confirmar** nos valores do projeto), `/api/attachments` e `/api/export`.
**Recomendação:** confirmar limites do Supabase Auth; para o resto, um limite simples por IP/pessoa (ex.: Vercel Firewall / regras de taxa do plano, ou tabela de contagem) nas rotas de exportação e anexos; manter o webhook atrás do segredo e rodar o segredo periodicamente. Esforço 1 dia.

### 4.4 Mensagens de erro que vazam detalhe — **[MÉDIA] #4, [BAIXA] #10**
- `lib/conversations/actions.ts` (6 pontos, ex.: linhas 228, 267, 626, 650, 680, 848) devolve `error.message` do banco ao navegador. As mensagens das RPC do projeto são códigos curtos (`conversation_not_found`…), mas erros inesperados do Postgres (violação de constraint, nome de coluna/índice) também passariam. As demais áreas usam frases fixas em português (bom padrão). **Recomendação:** mapear códigos conhecidos e devolver frase genérica para o resto (como já fazem `message-action-errors.ts` e `permissions.ts`).
- `app/api/webhooks/whatsapp/route.ts` registra `console.error("…", syncError)` e `("…", historyError)` com o objeto de erro inteiro (pode ter `details`/`hint`); outros pontos já registram só o código. Não grava texto de mensagem; mas, por padrão defensivo, registrar só `code`.
- Logs do app: não registram texto de mensagem; o push registra só contagens e códigos.

### 4.5 Páginas de erro e 404 — **[BAIXA] #8**
Não existem `app/not-found.tsx`, `app/error.tsx`, `app/global-error.tsx` nem `error.tsx` por área. Valem as páginas padrão do Next (em inglês, sem a marca). Sem vazamento de pilha em produção, mas a experiência é fraca. **Recomendação:** páginas em português com link de volta, e um `error.tsx` que não exiba mensagem técnica. Esforço 0,5 dia.

### 4.6 Outros
- **[BAIXA] #6 SSRF do avatar:** a rota busca `external_avatar_url` (vem do payload da Evolution) bloqueando `localhost`, `127.*`, `10.*`, `192.168.*`, `169.254.*`, `172.16–31.*`, exige HTTPS e `redirect: "error"`. **Não cobre** IPv6 literal (`[::1]`, `fc00::/7`, `::ffff:127.0.0.1`), `0.0.0.0`, `100.64/10` nem nomes DNS que resolvam para IP interno. O risco real é baixo (a URL só entra pelo webhook autenticado e a Vercel não tem rede interna sensível), mas vale validar por lista de domínios do WhatsApp (`pps.whatsapp.net`) ou resolver o DNS antes. Esforço 0,5 dia.
- **[BAIXA] #7:** `privatePaths` do `proxy.ts` lista `/hoje, /contatos, /conversas, /kanban, /configuracoes`; rotas como `/preferencias` e `/tarefas` ficam de fora da regra do proxy e são protegidas pelo layout do grupo `(app)` (verificado em produção: `/preferencias` → 307 para o login). Funciona; recomendação: deixar o proxy como defesa em profundidade com todas as rotas do grupo.
- **Modo demo:** `NEXT_PUBLIC_DEMO_MODE` só vale fora de produção (`isLocalGatewayBypassAllowed` exige `NODE_ENV !== "production"`). **Sem achado**; confirmar que a variável não existe na Vercel (**a confirmar**, sem listar valores).
- **Redirecionamento aberto / XSS:** sem `dangerouslySetInnerHTML` com dado de usuário; destino de login/convite por lista fechada.
- **Web Push:** rotas exigem sessão e mesma origem; teste de aparelho pelo `id` e RLS; o aviso nunca leva o texto da mensagem.
- **Cookies/sessão:** gerenciados por `@supabase/ssr` (HttpOnly/SameSite pelo padrão da biblioteca; **a confirmar** em produção).

---

## 5. Ordem sugerida de correção (para o `docs/CHECKLIST_LANCAMENTO.md`)
1. Atualizar Next (16.4.4) e dependências indiretas — **antes do lançamento**.
2. Cabeçalhos de segurança (CSP em report-only) e páginas de erro/404.
3. Mensagens de erro: mapear `error.message`; log só com `code`.
4. Limite de taxa nas rotas de anexo/exportação; confirmar limites do Supabase Auth.
5. Endurecer o avatar (lista de domínios).
6. Opcional: restringir MIME do bucket; revisar grant de `private.start_whatsapp_history_import`.
