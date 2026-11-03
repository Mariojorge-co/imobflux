# Relatório — Web Push (avisos de mensagem nova com o ImobFlux fechado) + ajustes de texto

> Estado: **pronto e testado localmente; NADA publicado.** Branch `feat/web-push`, a partir da `main` `5518803`.
> **Há migration** (`20260802006800_web_push.sql`, só aplicada no banco LOCAL) e uma dependência nova (`web-push` 3.6.7): a ordem é
> **Trava A (banco) → você gera as chaves e cadastra as 3 variáveis na Vercel → Trava B (app)**. Sem as variáveis o recurso fica **desligado** e
> nada quebra (o webhook segue normal e a tela mostra "indisponível"). Não gerei chaves de produção; nenhuma chave aparece neste relatório.

## O que foi feito

**Banco (só local nesta etapa)**
- `public.push_subscriptions`: uma linha por aparelho (`endpoint` único, `p256dh`, `auth`, `user_agent` curto, `platform` ios/android/desktop, `created_at`,
  `last_seen_at`, `last_error_at`, `disabled_at`) e uma opção mínima por aparelho, **desligada por padrão**: `include_sla_disabled` (avisar também as
  conversas com o prazo desativado, como já existe nos avisos com o app aberto). RLS: cada pessoa só **lê, cria e apaga** as próprias; só altera a
  opção acima. O envio usa a chave de serviço no servidor (lê as assinaturas dos destinatários e marca erro/desativação).
- `public.register_push_subscription(...)`: grava o aparelho da pessoa logada (idempotente por endpoint; se o mesmo aparelho entrou com outra pessoa, a linha
  antiga some, então o aparelho passa a ser de quem entrou).
- `public.get_push_targets(message_id)`: **só `service_role`** (nem `authenticated` nem `anon` executam); `SECURITY DEFINER`, `search_path` vazio; **nunca lê
  o texto da mensagem**. Aplica as MESMAS regras do avisador atual (`lib/notifications/model.ts`) e mais a regra de destinatários:

| Situação | Quem recebe |
|---|---|
| Mensagem de cliente, conversa **com responsável(is)** | só o(s) responsável(is) (o dono NÃO recebe se não for responsável) |
| Conversa **sem responsável** | só o **dono** |
| Atendente numa conversa que **não enxerga** (contato protegido, grupo não liberado) | **nunca** |
| Conversa privada (contato protegido) sem responsável | só o dono |
| Conversa **do número com ele mesmo** | ninguém |
| Grupo **owner_only** (não liberado à equipe) | ninguém; grupo liberado segue a regra de responsável/dono |
| Conversa arquivada | ninguém |
| Mensagem da equipe (CRM ou celular), histórico, apagada ou escondida | ninguém |
| Prazo **pausado** | avisa (o prazo volta quando o cliente fala) |
| Prazo **desativado** | só quem ligou a opção do aparelho (padrão: ninguém) |
| Membro/usuário/workspace inativo; assinatura desativada | ninguém |

  Responsável inativo (suspenso) não conta: se só restar ele, a conversa cai na regra "sem responsável" (dono).
- pgTAP `supabase/tests/database/web_push.test.sql` (**41 testes**): RLS por pessoa, atendente sem acesso às de outros, dono sem responsável, responsável(is),
  conversa privada, conversa do número com ele mesmo, grupo `owner_only` e liberado, arquivada, membro e usuário inativos, prazo pausado/desativado,
  assinatura desativada, mensagem da equipe/histórico/escondida, permissões das funções. **Red→green:** rodei antes da migration (falhou: `push_subscriptions` não existe) e depois
  de aplicá-la só no banco local (passou 41/41). Rollback documentado em `docs/rollback/20260802006800_rollback.sql`.

**Servidor**
- `lib/push/*`: `config.ts` (lê `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`; qualquer uma ausente ou inválida = **recurso desligado**),
  `payload.ts` (título **"Nova mensagem de {nome}"**, texto fixo "Toque para abrir a conversa.", **sem prévia**; o conteúdo não tem nem como carregar o
  texto da mensagem), `delivery.ts` (envio **em paralelo**, timeout de 6 s, **uma tentativa, sem repetição**; **404/410 desativa** a assinatura; outra falha só
  marca `last_error_at`; teto de 50 aparelhos por mensagem), `server.ts` (`web-push`, `after()`), `validate.ts`, `api.ts`.
- **Webhook**: depois de gravar a mensagem, `scheduleNewMessagePush(message_id)` roda dentro de `after()` — só quando a mensagem é **nova** (`status: success`, não
  duplicada) e **não é da equipe**. O que o webhook responde à Evolution **não mudou**. Sem chaves VAPID não faz nada.
- **Log**: só contagens e códigos (`[push] aparelhos=2 enviados=1 desativados=1 falhas=0 codigos=410:1`). Nunca conteúdo, endpoint, nome ou chave (teste unitário confere).
- **Rotas** (autenticadas, mesma origem, sem cache): `GET/POST/DELETE/PATCH /api/push/subscriptions` (lista **sem** endpoint nem chaves — só os 12 últimos caracteres do
  endpoint, para marcar "este aparelho"; registra; remove; liga/desliga a opção do prazo desativado) e `POST /api/push/test` (**aviso de teste só para o aparelho
  que pediu**, e só se a assinatura for da própria pessoa).

**Confirmação na documentação oficial (iOS)**: a WebKit ("Meet Web Push") diz que quebrar a promessa `userVisibleOnly` **cancela a assinatura**, e o código do WebKit
conta pushes sem notificação visível ("silent push quota": depois de poucos, a assinatura é removida). **Portanto o service worker mostra SEMPRE uma notificação por
push**, mesmo com o app em primeiro plano; a **etiqueta (tag) por conversa** (a mesma `conversa-<id>` do aviso local) faz um aviso substituir o outro em vez de empilhar,
e, se já havia um aviso da mesma conversa há menos de 6 s (o local, com a aba aberta), a troca é silenciosa para não tocar duas vezes. Com a aba em foco o
`NewMessageNotifier` já não mostra aviso do sistema, então o do servidor é o único: não há duplicata. O post de iOS+iPadOS da WebKit não detalha essa regra; a fonte é "Meet Web Push" e o
commit "Enforce silent push quota" (consultados em 29/10/2026). O comportamento exato por versão de iOS só o aparelho real confirma.

**Front-end**
- `/sw-avisos.js`: trata `push` (título "Nova mensagem de …", **sem prévia**, ícone do app, tag por conversa, caminho só do próprio app: `//` e `javascript:` caem em
  `/conversas`) e `notificationclick` (foca e abre a conversa certa; se focar for recusado, abre mesmo assim; sem janela aberta, abre uma). **Continua sem `fetch` e sem cache.**
- **Preferências → "Avisos neste aparelho"**: botão **"Ativar avisos neste aparelho"** (a permissão só é pedida **no toque**), estados claros — *verificando*, *indisponível* (servidor sem chaves),
  *no iPhone fora do app instalado* (passo a passo de instalar pelo Safari, iOS 16.4+), *navegador sem suporte*, *permissão negada* (como reativar, por plataforma), *ativo* —,
  lista dos **seus** aparelhos com remover, **"Enviar aviso de teste"** e a opção do prazo desativado. Textos curtos e honestos; sem campos de texto (nada de zoom); sem
  `maximum-scale`/`user-scalable`. Não mexi no Diagnóstico de tela nem no layout da conversa.
- Textos que diziam "Web Push ainda não existe" (guia por aparelho, aviso do iPhone, comentários) foram atualizados e remetem à nova seção.

**Ajustes de texto**: a seção do Hoje "Higiene de cadastro" virou **"Cadastros a completar"**, com o subtítulo **"Não é urgente, mas ajuda a não perder cliente"** (testes e
documentação atualizados). ROADMAP e STATUS corrigidos: o **Hoje unificado já está publicado (commit `5518803`)** e `/prioridades` redireciona para `/hoje`.

## Testes (feitos no ambiente descartável; chaves VAPID descartáveis geradas em memória; NENHUM push real)

- **Lint e tipos:** limpos. **Unitários:** 702 passando em **Node 22 e em Node 24** (22 novos em `tests/web-push.unit.spec.ts`: chaves VAPID válidas/ausentes, conteúdo do aviso sem prévia,
  nome sujo, validação do aparelho, envio em paralelo sem repetição, 404/410, log sem endpoint/chave, estados da tela, e garantias do service worker e do webhook). **Build** com variáveis fake de CI: ok
  (`/api/push/subscriptions`, `/api/push/test` e `/preferencias` dinâmicas).
- **Banco:** pgTAP novo `web_push.test.sql` com **41 testes** (red→green descrito acima). **pgTAP completo no banco limpo: 48 arquivos, 1477 testes, todos passando** (CI roda num banco limpo).
  Os 3 testes de allowlist de `SECURITY DEFINER` (`auth_bootstrap`, `contact_operations`, `owner_rls`) **falharam** ao incluir as 2 funções novas e foram atualizados (+2: 98, 121 e 121); sem isso o CI do banco quebraria.
  Observação: no banco local de desenvolvimento (com dados antigos) 3 testes de outros arquivos falham por dado sujo; no banco limpo todos passam.
- **Navegador, chaves VAPID descartáveis em memória, NENHUM push real** (endpoints de mentira `192.0.2.x`, faixa de documentação sem rota; no navegador a assinatura é falsa):
  `web-push.spec.ts` (14): seção nas Preferências; ativar/listar/teste só neste aparelho/remover; API exige login e cada pessoa só enxerga e apaga os próprios aparelhos (sem endpoint nem chaves
  na resposta; origem cruzada barrada); **service worker** com evento `push` e clique **simulados** (título "Nova mensagem de …", sem prévia, uma notificação por conversa, troca silenciosa, conteúdo estranho e caminho
  `//` ou `javascript:` caem em `/conversas`, clique abre a conversa); **destinatários de ponta a ponta** pelo webhook (sem responsável → só o dono; com responsável → só ele; mensagem da equipe → ninguém);
  **tempo do webhook** (com 3 aparelhos pendurados por até 6 s a resposta não piora: dentro de +1,5 s do tempo sem aparelhos e abaixo de 3 s; o envio roda depois e é registrado); mensagem duplicada não avisa de novo;
  iPhone no navegador (orienta a instalar), iPhone instalado, permissão negada, celular 360/390/430 (sem rolagem lateral, alvos de 44 px) e atendente só vê os próprios aparelhos.
  `web-push-desligado.spec.ts` (3, servidor SEM chaves): tela "indisponível", API 503, webhook normal e nenhuma tentativa de aviso.
  `web-push-tema.spec.ts` (4): contraste AA em claro e escuro, 390 e 1440 px (seção ativa com lista, instalar no iPhone, negada e "Cadastros a completar" aberta): **0 violações**.
- **Regressão, uma suíte por vez, todas passando no fim:** web-push 14, web-push-tema 4, web-push-desligado 3, hoje-unificado 11, hoje-unificado-tema 4, hoje 5, notificacoes 5, ajustes-5-avisos 6, ajustes-5 9,
  ajustes-6 20, ajustes-7 13, ajustes-7-tema 4, celular 12, tema 7, tema-novas-telas 4, tema-correcoes 4, conversations 13, sprint23-conversations-evolution, sprint23-hotfix, grupos-e-propria,
  correcoes-mensagens, mensagens-pacote, quick-replies, respostas-anexos, responder-gesto, send-files, prazos 7, functional-hotfix 3, collaboration-hotfix 4, atalhos 12, busca-global 8, correcoes-4 8,
  inbox-realtime 3, auth-flow 17, team-management 3.
- **O que a regressão pegou (nada escondido):** (1) os 3 testes de allowlist de `SECURITY DEFINER` (acima); (2) um teste meu do service worker reaproveitava a mesma etiqueta logo depois de fechar o aviso e falhou
  1 vez de 2 (o Chrome não mostrou o aviso na mesma hora): uso etiqueta diferente por caso (não afeta o app: no uso real a etiqueta é por conversa); (3) `ajustes-7` não subiu o servidor de teste uma vez (timeout de 180 s do
  servidor, instabilidade do ambiente) e `prazos` (webhook 404 na preparação) e `atalhos` (Alt+seta, instável conhecido) falharam uma vez cada: **passaram na repetição, sem mudança de código**; (4) se sobra um servidor de teste de outra rodada
  na porta, ele reaproveita o ambiente antigo (sem chaves): os testes de push encerram o servidor antes.
- **Chrome, não WebKit/iPhone/Android reais:** nenhum push real foi enviado; o iPhone e o Android só o aparelho confirma (ver abaixo).

## O que só o iPhone e o Android reais confirmam

- **iPhone (iOS 16.4+, app instalado pelo Safari):** se a permissão aparece só no toque; se o aviso chega **com o app fechado e a tela bloqueada**; se aparece o nome certo;
  se tocar abre a conversa; se o Foco (modo "Não perturbe") se comporta como esperado; se a assinatura **sobrevive dias** sem ser revogada (o iOS é o ponto mais sensível).
- **Android (Chrome):** com o app fechado, em segundo plano e com economia de bateria ligada; aviso ao tocar abre a conversa.
- **Computador:** com o navegador aberto em outra aba e (varia por sistema) com o navegador fechado.
- O serviço de push real (Google/Apple/Mozilla) responde como o código espera (201 aceito; 404/410 para assinatura morta). Os testes simulam o evento `push` e o clique no service
  worker e usam endereços de mentira; **nada foi enviado a um serviço de push de verdade**.
- O tempo do envio e se o `after()` termina dentro do limite da função na Vercel (o envio leva 1–2 s no normal; o teto por aparelho é 6 s e o webhook tem `maxDuration = 60`).

## Passo a passo para você gerar as chaves VAPID NO SEU COMPUTADOR (a chave privada nunca vai ao chat)

1. Abra o PowerShell na pasta do projeto: `cd "C:\Users\User\Desktop\PROJETOS\CRM Corretor"` (a `main` ou esta branch, com `npm install` feito).
2. Gere o par **gravando num arquivo temporário, sem imprimir na tela**:

```powershell
node -e "const k=require('web-push').generateVAPIDKeys(); require('fs').writeFileSync(process.env.TEMP+'\\vapid-imobflux.json', JSON.stringify(k,null,2))"
notepad "$env:TEMP\vapid-imobflux.json"
```

3. No Bloco de Notas aparecem `publicKey` e `privateKey`. **Copie cada valor direto para a Vercel** (próximo passo). **Não cole no chat, não salve no projeto, não comite.**
4. Vercel → projeto `imobflux` → **Settings → Environment Variables** → adicione, no ambiente **Production**:
   - `NEXT_PUBLIC_VAPID_PUBLIC_KEY` = o valor de `publicKey` (é pública por definição);
   - `VAPID_PRIVATE_KEY` = o valor de `privateKey` — marque como **Sensitive** (nunca volta a ser exibida);
   - `VAPID_SUBJECT` = `mailto:` + seu e-mail (por exemplo `mailto:voce@seudominio.com`).
5. **Apague o arquivo temporário**: `Remove-Item "$env:TEMP\vapid-imobflux.json"`. Guarde a privada só num gerenciador de senhas, se quiser poder repor depois.
6. As variáveis só valem para o **próximo deploy**: por isso a ordem é Trava A → variáveis → **Trava B** (o deploy do app já nasce com as chaves). Se você cadastrar depois do deploy, faça um
   "Redeploy" na Vercel.
7. **Trocar a chave privada invalida todas as assinaturas** (cada pessoa precisa ativar de novo em Preferências). Não troque sem necessidade.

## Checklist da Trava A (banco) — só com o seu "autorizo"

1. **Backup** (esquema e dados) do banco de produção, em arquivo local fora do projeto.
2. `supabase migration list --linked`: confirmar que a produção está até `20260802006700` e que **só `20260802006800` está pendente**.
3. `supabase db push --linked --dry-run`: tem de listar **somente** a `006800` (cria 1 tabela, 1 índice, 4 policies, 2 funções; nada existente muda).
4. Com o "autorizo": `supabase db push --linked`.
5. Validação **somente leitura**: `migration list` sem pendências; `get_push_targets` executável **só** por `service_role` (`anon` e `authenticated` sem acesso);
   `register_push_subscription` executável por `authenticated` e não por `anon`; a tabela com RLS ligada e 4 policies.
6. Apagar o backup. Rollback (se preciso): `docs/rollback/20260802006800_rollback.sql` (apaga a tabela de aparelhos; nenhuma mensagem é tocada).

Depois: você cadastra as 3 variáveis (acima) e autoriza a **Trava B** (merge fast-forward, push, CI, Vercel `Ready` e smoke: `/login` 200, `/preferencias` 307 → login, `/api/push/subscriptions` 401 sem login,
`/sw-avisos.js` 200 com o texto novo, `/manifest.webmanifest` 200).

## Aviso de teste com atraso (pacote `fix/push-teste-atraso`, a partir da `main` `5e3a4c7`; sem migration)

**Por quê**: o teste imediato chegava antes de dar tempo de fechar o app e bloquear a tela no iPhone.

**O que mudou**
- `POST /api/push/test` aceita `delaySeconds` opcional, de uma **lista fechada: 0, 10 e 20**. Qualquer outro valor (5, 15, -1, 10.5, texto) é recusado com 400 e a mensagem "Atraso inválido. Use 0, 10, 20 segundos." Sem o campo = 0 (como antes).
- Com atraso, a rota **responde na hora** (202, `{status:"scheduled", delaySeconds}`) e o envio acontece **no servidor**, em `after()`, depois da espera: o app pode estar fechado. Vai **só para o aparelho que pediu** (a RLS só devolve as assinaturas da própria pessoa) e o conteúdo continua o aviso genérico de teste (nada de cliente ou prévia).
- **Tempo na Vercel**: `maxDuration` desta rota passou de 15 para **30 s** (atraso máximo 20 s + envio até 6 s = 26 s). Só esta rota mudou; as outras ficaram como estavam (o webhook já tem 60 s).
- **Limite de abuso**: no máximo **1 teste pendente por aparelho** e **5 s** entre pedidos. Repetir cedo responde 429 com texto amigável ("Já há um teste a caminho. Aguarde o aviso chegar." ou "Aguarde alguns segundos antes de pedir outro teste."). O controle fica na memória da instância (freio contra clique repetido, não uma garantia entre instâncias); um pendente que nunca terminou deixa de bloquear depois de 1 minuto. Não precisou de migration.
- Se o serviço de push disser 404/410 no envio com atraso, a assinatura é **desativada** (não há mais sessão da pessoa para apagar). O log tem só a duração, "enviado" ou o **código** da falha.
- **Tela**: o botão "Enviar aviso de teste" continua e ganhou "Enviar aviso de teste em 10 segundos", com o texto "O aviso chega em cerca de 10 segundos. Feche o app e bloqueie a tela agora." Ao agendar, a tela confirma "Teste agendado: o aviso chega em cerca de 10 segundos, mesmo com o app fechado." (sem cronômetro: quem espera é o servidor). Botões de 44 px; nada de campo novo, sem `maximum-scale`.
- Regra em `lib/push/test-run.ts` (pura, testável); a rota só liga os pedaços.

**Testes**: lint e tipos limpos; 718 unitários em Node 22 e 24 (16 novos em `tests/web-push-teste.unit.spec.ts`: atraso válido e inválido, recurso desligado 503, limite pendente/intervalo/expiração, só o aparelho solicitante, aparelho de outra pessoa 404, conteúdo genérico, falha 410 e rede só com código); build ok; navegador: `web-push-teste.spec.ts` 3/3 (agenda na hora, mensagem, segundo pedido 429, 401 sem login, 400 para atraso fora da lista, 44 px a 390 px), `web-push.spec.ts` 14/14, `web-push-desligado.spec.ts` 3/3 (inclui 503 com atraso), `web-push-tema.spec.ts` 4/4 (contraste AA) e `notificacoes.spec.ts` 5/5, uma suíte por vez. Nenhum push real foi enviado (endpoints de mentira).
- **Não coberto localmente**: a espera real de 10 s seguida do envio ao serviço de push de verdade (só o unitário, com relógio e envio simulados) e a chegada no iPhone: isso é o mini reteste abaixo. No primeiro ciclo o teste de service worker do `web-push.spec.ts` falhou duas vezes (servidor de teste frio) e passou 2 de 2 nas repetições sem mudar código.

**Acréscimo: testar qualquer aparelho da própria pessoa.** Na lista "Seus aparelhos com aviso", cada aparelho **ativo** tem "Testar este aparelho" e "Testar em 10 segundos" (o desativado pelo serviço não tem). Dá para apertar no computador e receber no celular.
- A rota passou a pedir o aparelho **pelo `id` da assinatura** (`{ id, delaySeconds }`). O `endpoint` informado pelo cliente **não é mais aceito** (sem `id` válido, 400); os botões do aparelho atual também usam o `id`.
- O servidor procura o `id` com o cliente **da pessoa logada**, e a RLS só devolve as assinaturas dela: aparelho de outra pessoa, inexistente ou desativado dá **404** (sem agendar nada). Não existe atalho com o cliente administrativo para achar o aparelho. O limite (1 pendente por aparelho, 5 s) é por `id`, e o aviso continua o genérico de teste.
- Testes: unitários 720 (Node 22 e 24; entre os 18 desta rota: não autenticado 401 antes de tudo, endpoint no lugar do id não acha nada, aparelho de outra pessoa/inexistente/desativado, só o aparelho pedido recebe); navegador: `web-push-teste.spec.ts` 4/4 (inclui a lista com aparelho do dono, desativado e do atendente, o corpo do pedido só com `id` e `delaySeconds`, o 429 e os 404), `web-push` 14/14, `web-push-desligado` 3/3, `web-push-tema` 4/4 e `notificacoes` 5/5. Sem push real. A isolação entre pessoas é garantida pela RLS (já coberta nos 41 testes pgTAP de `web_push`); o unitário usa uma busca simulada que só devolve os aparelhos da pessoa.

### Mini reteste de 1 minuto (iPhone, app instalado)
1. **Preferências → Avisos neste aparelho** (já ativo).
2. Toque **Enviar aviso de teste em 10 segundos**: aparece "Teste agendado…".
3. **Feche o app** (deslize para cima) e **bloqueie a tela**.
4. Em cerca de 10 segundos chega **"Aviso de teste do ImobFlux"**. Toque: abre em Preferências.
5. Se tocar duas vezes seguidas, a segunda deve dizer "Já há um teste a caminho".
6. (Opcional) No computador, em Preferências, ache o iPhone na lista e toque **Testar em 10 segundos** nele: o aviso chega no iPhone.

## Mini reteste (10 minutos)

**iPhone (iOS 16.4 ou mais novo)**
1. No **Safari**, abra o ImobFlux → Compartilhar → **Adicionar à Tela de Início**. Abra **pelo ícone novo**.
2. **Preferências → Avisos neste aparelho**: toque **Ativar avisos neste aparelho** e aceite a permissão. Deve aparecer "Ativo neste aparelho".
3. Toque **Enviar aviso de teste**: o aviso aparece no iPhone.
4. **Feche o app** (deslize para cima) e **bloqueie a tela**. De **outro número**, mande uma mensagem para o número do ImobFlux em uma conversa **em que você é o responsável**.
5. Chega "Nova mensagem de {nome}" **sem o texto**. Toque: o ImobFlux abre na conversa certa.
6. Confira: numa conversa **sem responsável** quem recebe é só o dono; um atendente **não** recebe de conversa de outro atendente.

**Android (Chrome)**: repita 2–6 (não precisa instalar; instalar melhora a confiabilidade). Teste também com o app fechado e a tela bloqueada.

**Se algo não chegar**: Preferências → Avisos neste aparelho → veja se o aparelho aparece **ativo** (se aparecer "desativado pelo serviço de aviso", toque em Desativar e ative de novo);
no iPhone, confira Ajustes → Notificações → ImobFlux e os Modos de Foco.
