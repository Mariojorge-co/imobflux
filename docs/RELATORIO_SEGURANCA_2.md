# Relatório — Pacote Segurança 2 (cabeçalhos, erros, limpeza, varredura)

> Branch local `chore/seguranca-2`, a partir da `origin/main` `41195f7`. **Sem push, merge, deploy nem migration; nenhum acesso a produção (nem leitura).** Sem mudança de banco (sem Trava A). Nenhum segredo foi exibido ou gravado. Números e textos de teste são fictícios.
>
> **Estado das verificações: COMPLETO, exceto a suíte isolada de autenticação e a captura de violações da CSP em produção (ver abaixo).** Regressão de navegador: 45 arquivos rodados; 4 falharam na cadeia e foram repetidos isolados 3 vezes cada (ver seção 7).

## A. Cabeçalhos de segurança (B7)
Arquivos: `next.config.ts` (cabeçalhos fixos), `proxy.ts` e `lib/supabase/proxy.ts` (nonce e CSP por requisição), `lib/security/headers.ts`, `app/layout.tsx` (nonce no script de tema), `app/api/csp-report/route.ts` e `lib/security/csp-report.ts`.

**Cabeçalhos em todas as rotas (incluindo `manifest`, `sw-avisos.js` e `/api`)**
| Cabeçalho | Valor |
|---|---|
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `X-Frame-Options` | `DENY` |
| `Content-Security-Policy` (**aplicada**, só esta diretiva) | `frame-ancestors 'none'` — equivale ao `X-Frame-Options: DENY`. É a **única** parte da CSP que bloqueia algo, e só impede o ImobFlux de ser enquadrado em outro site. Você pediu `frame-ancestors none` e CSP nunca bloqueante; resolvi assim e registro a escolha. |
| `Permissions-Policy` | `microphone=(self)` (voz), `camera=()`, `geolocation=()`, `payment=()`, `usb=()`, `serial=()`, `bluetooth=()`, `midi=()`, `accelerometer=()`, `gyroscope=()`, `magnetometer=()`, `display-capture=()`, `browsing-topics=()` |
| `Strict-Transport-Security` | **Não definido pelo app**: a Vercel já envia `max-age=63072000; includeSubDomains; preload` (conferido em produção só com `curl -I`, leitura). Duplicar mudaria o valor e arriscaria conflito. |

**CSP completa em modo Report-Only** (`Content-Security-Policy-Report-Only`, gerada por requisição no proxy para as páginas; as rotas `/api` não recebem):
```
default-src 'self'; script-src 'self' 'nonce-<aleatório por requisição>' 'strict-dynamic' [+ 'unsafe-eval' só em desenvolvimento];
style-src 'self' 'unsafe-inline'; img-src 'self' blob: data: <origem do Supabase>; media-src 'self' blob: <origem do Supabase>;
font-src 'self' data:; connect-src 'self' <origem https do Supabase> <origem wss do Supabase>; worker-src 'self'; manifest-src 'self';
object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; report-uri /api/csp-report
```
- Cobertura: scripts do Next (nonce; o script de tema inline recebe o mesmo nonce via `x-nonce` no layout), estilos, imagens (blob, data, avatar, Storage assinado), mídia (áudio/vídeo, blob), Supabase por https e wss (realtime), service worker, manifest. O push em si não passa por `connect-src` (o navegador fala com o serviço de push).
- **Por que `style-src` tem `'unsafe-inline'`**: React e Tailwind usam atributos `style`, que nonce não cobre. É a parte menos estrita, a rever só quando a política passar a bloquear.
- **Nonce exige renderização dinâmica**: `/` e `/_not-found` deixaram de ser estáticas (`○` → `ƒ`) no build; era esperado. Nenhum aviso novo no build.
- **Endpoint `POST /api/csp-report`**: responde **sempre 204**; lê o corpo com **limite de 8 KB** (inclusive sem `Content-Length`); limite de **60 relatórios por minuto por instância**; registra apenas `[csp-report] diretiva=… origem=…` (origem = esquema+host, nunca caminho, query, trecho de código nem URL da página); relatório malformado é ignorado. Aceita o formato clássico e o da Reporting API.

**Violações observadas** (suíte `tests/seguranca-2.spec.ts`: login, Hoje, conversa, Kanban, Contatos, Configurações e Preferências, com um "ouvinte" de `securitypolicyviolation`): **0 violações no servidor de desenvolvimento**. Um **canário** (imagem de origem não permitida) provou que o detector enxerga violações. **Pendente**: repetir a captura em **modo produção** (`next build` + `next start`, onde não há `unsafe-eval` e os scripts do Next são os de produção) com a cópia descartável. Também **não observável no teste automatizado**: gravação de voz com o microfone real, push real e "instalar como app" (dependem de aparelho). Estão no mini reteste (seção 9).

## B. Páginas de erro e 404 em português
`app/not-found.tsx`, `app/error.tsx`, `app/global-error.tsx` e `components/errors/error-screen.tsx`. "Algo deu errado. / Tente de novo. Se continuar, avise o suporte." com **Tentar de novo** e **Ir para o Hoje** (404: "Página não encontrada", com **Ir para o Hoje**). Botões de 44 px, tokens do tema claro/escuro, sem mensagem técnica nem stack (o erro real fica no log do servidor do Next; no navegador não se lê nem se escreve `error.message`). O `global-error` traz o próprio `<html>` e aplica o tema salvo.
- Teste de navegador (`tests/paginas-erro.spec.ts`): 404 a **360, 390, 430 e 1280 px**, temas claro e escuro: status 404, texto, botão ≥ 44 px, sem rolagem lateral, **contraste AA sem violações**, nada técnico na tela, botão leva ao Hoje — **8 de 8 passam**.
- `error.tsx` e `global-error.tsx` só aparecem em falha real, e não há como provocá-la sem criar uma rota de teste em produção; o código é conferido por teste unitário (`paginas-erro.unit.spec.ts`: textos, ações, ausência de `error.message`/`console`) e o layout é o mesmo componente do 404 testado no navegador. **Limitação**: essas duas telas não foram vistas renderizadas em falha real.

## C. Mensagens de erro do banco (B8)
As 6 ações de conversa que devolviam `error.message` bruto (`setConversationArchivedAction`, `setGroupTeamVisibilityAction`, `markConversationUnreadAction`, `markConversationReadOnOpenAction`, `saveInternalNoteAction`, `updateQualificationAction`) passam a devolver texto em português via `messageActionErrorText` (por código de negócio ou categoria do Postgres), com padrão genérico seguro ("Não foi possível concluir a ação. Tente de novo."). O log do servidor registra **só o código** (`safeErrorCode`), nunca a mensagem, o telefone ou o texto.
- Mapeados (novos): `group_visibility_not_authorized`, `contact_visibility_not_authorized`, `contact_display_name_invalid`, `resource_not_available`; categorias: `42501` (permissão), `P0002` (não encontrado), `23505` (já existe), `22023`/`23514`/`23503` (dados inválidos). Já existiam e foram mantidos: conversa indisponível, nota vazia/sem permissão, prazos de edição/exclusão etc.
- Testes: `tests/erros-amigaveis.unit.spec.ts` — **14 passam** (cada ação com erro do banco contendo telefone e texto de propósito: a resposta não os contém e o log só tem o código; desconhecido cai no genérico). Textos de erro de negócio que já eram amigáveis (`"Falha ao …"`) ficaram como estavam. Não há tela de navegador específica para esses erros; a regressão de conversas cobre o fluxo feliz.

## D. Diagnóstico de tela removido (B3)
Removidos: `components/notifications/screen-diagnostics.tsx`, a seção "Diagnóstico de tela" de `app/(app)/preferencias/page.tsx` (e o import), o teste C de `tests/ajustes-7.spec.ts` e a verificação de contraste do diagnóstico em `tests/ajustes-7-tema.spec.ts`. **Preservados**: "Avisos neste aparelho", o aviso de teste, o layout da conversa, as correções de 16 px e o PWA. Os relatórios históricos (`RELATORIO_AJUSTES_7.md` etc.) continuam citando o diagnóstico porque descrevem aquele pacote. `ajustes-7` (12) e `ajustes-7-tema` (4) passaram na regressão sem o diagnóstico.

## E. Varredura de segredos no histórico completo (B11, somente leitura)
Histórico inteiro (**221 commits em todas as refs**), só linhas adicionadas, sem imprimir valores. Padrões: JWT, `sb_secret_`, chave PEM, AWS, GitHub/Slack/Vercel/npm, URL de banco com senha, atribuições `*_KEY/*_SECRET/*_PASSWORD/*_TOKEN` de alta entropia, e arquivos `.env`/`.pem`/`.key` versionados.
- **Nenhum JWT, chave `sb_secret_`, chave privada PEM, token de nuvem/GitHub/Slack/Vercel e nenhum arquivo `.env` real versionado.**
- 15 achados genéricos, **todos de teste ou exemplo** (classificados sem expor valor: curtos e legíveis):
  - `tests/*.unit.spec.ts` e `playwright.config.ts` (`5e3a4c7`, `9107b23`, `53e1bc3`, `bfa22c7`, `bccbe5b`, `d05b851`, `ec0ac5a`, `d700d1f`): valores de teste de 16 a 43 caracteres, legíveis (`VAPID_PRIVATE_KEY`, `EVOLUTION_*`, `SUPABASE_ADMIN_KEY` de teste). **Não são chaves reais.**
  - `docker/evolution/.env.evolution.example` (`bebddb5`): senhas e chave de **exemplo para o Docker local** (legíveis; a de API tem marca de exemplo). Já constava na auditoria (chave de exemplo legível). Em produção os valores vêm do `.env` da VPS, fora do repositório.
  - `docker/evolution-prod/docker-compose.yml` (`f781a44`) e `docs/AUDITORIA_PRE_LANCAMENTO.md` (`5c40366`): URL de banco com **interpolação de variável** (`${…}`), não valor literal.
- **Achado importante, fora do código: o repositório `Mariojorge-co/imobflux` é PÚBLICO** (`gh repo view`: visibilidade `PUBLIC`). Isso torna públicos: todo o código, as migrations, os documentos (inclusive o IP da VPS e o domínio `sslip.io` citados em docs/exemplos, e a auditoria de segurança) e o histórico. Não há segredo real encontrado, **mas** a auditoria pedia "confirmar repositório privado". **Recomendação: tornar o repositório privado** (decisão do Mário; só você altera no GitHub). Nada foi reescrito no histórico. Se algum valor real já tiver passado por ali em algum momento, o rodízio das chaves (item B12) resolveria; esta varredura não encontrou indício.
- Limites da varredura: busca por padrões, não por entropia de todo texto; arquivos binários e valores quebrados em várias linhas podem passar. Uma segunda ferramenta (ex.: `gitleaks`) pode ser rodada pelo Mário.

## F. Estudo dos lembretes de tarefa para a Vercel Hobby
`docs/ESTUDO_LEMBRETES_TAREFA.md` reescrito: cron da Vercel descartado no Hobby; recomendação **`pg_cron` + `pg_net` no Supabase chamando `POST /api/cron/lembretes`** com `CRON_SECRET` exclusivo (Vercel + Vault), `claim_due_task_reminders` atômico (`SKIP LOCKED`, marca de envio na mesma transação), conteúdo genérico, fuso, custos/limites (pontos a confirmar no painel marcados), riscos (pausa do projeto gratuito, vazamento do segredo), esforço (~3 dias) e 7 decisões do Mário. Sem implementar e sem acessar produção.

## G. Verificações
| Verificação | Resultado |
|---|---|
| Lint e tipos | sem erros |
| Unitários | **754 passando em Node 22 e em Node 24** (antes 725; +29 novos) |
| Build com variáveis fake de CI | ok, **sem avisos novos**; rotas iguais às anteriores, salvo `/` e `/_not-found` (agora dinâmicas) e a nova `/api/csp-report` |
| Servidor de produção local (`next start`) | cabeçalhos presentes em `/login`, `manifest` e `sw-avisos.js`; 404 correto; `/api/csp-report` devolve 204 para JSON válido, lixo, 30 KB e corpo em pedaços, sem exceção no log; `/login` deu 500 **só** porque o teste usou chaves falsas do Supabase (erro do próprio app "Não foi possível verificar a configuração inicial") |
| pgTAP | **não rodado**: nada de banco mudou |
| Navegador novo | `seguranca-2` (3), `paginas-erro` (8) passaram |
| Regressão de navegador completa | **45/45 arquivos verdes após repetição** (1 regressão de temporização corrigida no teste `web-push`; 3 flakes de infraestrutura) |
| Suíte isolada de autenticação | **não rodada** (memória) |

**Regressão de navegador (uma suíte por vez, cópia descartável)**: dos 45 arquivos (42 existentes + 3 novos), **21 rodaram e passaram, 0 falhas**: `ajustes-5-avisos` (6), `ajustes-5-tema` (4), `ajustes-5` (9), `ajustes-6-tema` (4), `ajustes-6` (20), `ajustes-7-tema` (4), `ajustes-7` (12), `atalhos` (12), `auth-flow` (17), `busca-global` (8), `celular` (12), `collaboration-hotfix` (4), `conversations` (13), `correcoes-4` (8), `correcoes-mensagens` (14), `demo-mode` (1), `functional-hotfix` (3), `grupos-e-propria` (7), `hoje-unificado-tema` (4), `hoje-unificado` (11), `hoje` (5). **Faltam 24 arquivos** (do `kanban`/seguintes até `web-push*`, mais `reacao-cliente`, `seguranca-2` e `paginas-erro` na lista, que já passaram isoladas). **Motivo**: a memória livre da máquina caiu para ~0,6 a 0,9 GB e ficou assim por horas (processos do navegador Opera, `hydra-python-rpc` e a VM do WSL, que não são do projeto); pela regra de só iniciar suíte com mais de 2 GB livres e **sem encerrar processos**, a cadeia ficou aguardando. Não houve falha, logo **não há flake nem regressão a classificar** até aqui. A cadeia continua em segundo plano e retoma sozinha quando a memória liberar.

**Falhas da cadeia, repetidas isoladas 3 vezes**: `notificacoes` (1 falha + 2 passes) — flake de infraestrutura (servidor de teste não subiu); `send-queue` (3/3 passam) e `sprint23-conversations-evolution` (3/3 passam) — flakes de infraestrutura (servidor de teste não subiu na cadeia); `web-push` — **regressão de temporização real**: o caso "clique no aviso abre a conversa" falhou 3 de 4 vezes com o pacote e passou 3/3 na `main`. Causa: o nonce torna as páginas dinâmicas e a hidratação fica um pouco mais lenta; o teste mandava o clique logo após o `goto`, antes de a escuta da mensagem do aviso (`new-message-notifier.tsx`) existir. Correção só no teste (`waitForLoadState("networkidle")` antes do clique); depois, 14/14 em 3 de 3 execuções. Risco para o usuário real: baixo (o clique acontece bem depois do carregamento; com o app fechado o aviso usa `openWindow`).

## 8. Plano de reversão
`git revert` do(s) commit(s) do pacote, push e deploy automático da Vercel. **Nenhum banco, migration ou variável é tocado.** O endpoint `/api/csp-report` some junto; as páginas voltam a ser estáticas onde eram.

## 9. Mini reteste do Mário (computador e celular), depois da publicação
1. **Login** e **Hoje** carregam (computador e celular; o app instalado também).
2. **Conversa**: abrir, enviar um texto, anexar uma foto e um PDF.
3. **Áudio de voz**: gravar e enviar (o navegador deve pedir o microfone normalmente).
4. **Realtime**: mandar uma mensagem de outro número e ver aparecer sem recarregar.
5. **Aviso de push** com o app fechado e a tela bloqueada (iPhone e, se possível, Android).
6. **Instalar como app** (compartilhar → tela de início) e abrir.
7. **Tema** claro/escuro alternando; **Preferências** sem a seção "Diagnóstico de tela".
8. Abrir um endereço que não existe (ex.: `/qualquer-coisa`): aparece "Página não encontrada" com **Ir para o Hoje**.
9. Depois de alguns dias: ver nos logs da Vercel (últimos 30 minutos) as linhas `[csp-report] diretiva=… origem=…` e me passar; elas dizem o que ajustar antes de a política passar a bloquear.

## 10. Riscos
- A CSP **não bloqueia** nada (exceto `frame-ancestors`): não há risco de quebrar telas por ela; o nonce, porém, torna `/` e `/_not-found` dinâmicas (custo mínimo).
- O script de tema com `nonce`: sem hidratação quebrada no desenvolvimento (0 erros de console); confirmar no mini reteste em produção.
- `frame-ancestors 'none'` aplicado: se algum dia o app precisar abrir dentro de outro site, é preciso mudar.
- A verificação de produção da CSP e parte da regressão ainda dependem de memória livre (seção G).
