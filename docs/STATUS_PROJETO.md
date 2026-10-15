# Status do Projeto — ImobFlux

- **Projeto**: ImobFlux (CRM imobiliário B2B / SaaS)
- **Objetivo**: gestão comercial e relacionamento para corretores e imobiliárias, com WhatsApp integrado.
- **Versão**: `0.1.0`
- **Produção**: app em `https://imobflux.vercel.app` (Vercel) e banco no Supabase (`imobflux-prod`).
- **Última atualização**: 2026-10-15 (pacote de Conversas publicado: troca de conversa rápida, contador de espera único, envio otimista e mídia; migration `005100` aplicada em produção em 2026-10-15, ver `RELATORIO_CONVERSAS_PACOTE.md`)

---

## Resumo

Escopo do documento de MVP (`FLUXOS_NEGOCIO.md`, 28 fluxos) implementado em cerca de **95%** (com o branch `feat/mvp-noite`; hoje em produção, cerca de 85%). Pronto para uso
real com clientes em cerca de **65%**: o código do WhatsApp está completo e testado com Evolution simulada e
real em ambiente local, mas **falta hospedar a Evolution publicamente, configurar as variáveis no Vercel e
testar com um celular real** (roteiro em [DEPLOY_EVOLUTION_VPS.md](DEPLOY_EVOLUTION_VPS.md)).

---

## Funcionalidades concluídas

- **Acesso e equipe**: login/logout SSR com cookies HTTP-only, bootstrap controlado do primeiro OWNER, convite
  de funcionário (e-mail via SMTP próprio, templates com `token_hash`), aceite, redefinição de senha, "ver
  senha", desativar e reativar funcionário. Papéis OWNER e ATTENDANT.
- **Privacidade**: contato protegido oculto do ATTENDANT em toda parte (incluindo grupo liberado e anexos);
  grupos nascem restritos ao OWNER até serem liberados; webhook com segredo (falha fechada).
- **Contatos**: criar, editar, inativar, reativar, arquivar e restaurar via RPCs auditadas; múltiplos telefones.
- **Conversas e WhatsApp**:
  - envio e recebimento de texto, idempotência, reconciliação e estado honesto de envio;
  - **mídia**: imagem, PDF, áudio, vídeo e figurinha são baixados para o Storage privado do Supabase e abertos
    dentro da conversa (com nova tentativa quando o download falha);
  - **conexão por QR code** (Configurações > WhatsApp, só OWNER): cria a instância, aponta o webhook, mostra e
    renova o QR, detecta pareamento e desconexão;
  - **histórico recente**: importa em melhor esforço o que o WhatsApp envia no pareamento (últimos 15 dias),
    marcado como "histórico importado", fora do SLA e da contagem de não lidas, com a mesma privacidade;
    falha da importação é sempre mostrada ao OWNER;
  - atualização em tempo real (Supabase Realtime) da lista e da conversa.
- **SLA visual**: selo com cor, ícone e texto (verde, amarelo, laranja, vermelho; neutro quando a equipe já
  respondeu) na lista de conversas, no cabeçalho da conversa e nos cards do Kanban.
- **Kanban comercial**: 6 etapas, criação, edição, reordenação persistente (`sort_order`), encerramento
  (ganho/perdido/cancelado), retrabalho, valores financeiros restritos ao OWNER. **No celular**: abas de etapa
  com uma coluna por vez e alerta de cliente esperando; desktop com rolagem lateral.
- **Prioridades**: dashboard real (`get_prioridades_dashboard`).
- **Estados vazios guiados** em Conversas e Kanban (conectar WhatsApp / criar primeira oportunidade).
- **Tarefas**: criação e conclusão a partir da conversa (RPCs `upsert_work_task` e `complete_work_task`).

## Publicado em produção em 2026-10-13 (ex-branch `feat/mvp-noite`, commit `720dd37`)

Detalhes, testes e decisões em [RELATORIO_NOITE.md](RELATORIO_NOITE.md). Correções da revisão adversarial em [RELATORIO_CORRECOES.md](RELATORIO_CORRECOES.md). Migrations `004300` a `004900` aplicadas em produção em 2026-10-13 (backup feito antes e apagado depois da validação).
- **Remoção de funcionário** (fluxo 23): acesso revogado na hora, trabalho liberado para reatribuição, nada apagado.
- **Atribuição de conversa** (fluxos 18 e 19): vários responsáveis, troca com histórico, filtro "Minhas", respeitando a privacidade.
- **Auditoria** (fluxo 25): eventos que faltavam e tela de consulta para o OWNER.
- **Tarefas** (fluxos 16 e 17): responsável, prazo, prioridade, lembrete e tela própria.
- **Exportação CSV** (fluxo 26): contatos e oportunidades, só OWNER, auditada.
- Correção: o ATTENDANT passa a ver o nome do responsável de colegas no Kanban.

## Ainda não implementado (do documento de MVP)

- Sincronização completa inicial (fluxo 3): a Evolution só entrega o histórico recente decidido pelo celular, no
  pareamento; importar tudo não é possível por esse caminho.
- Notificações e lembretes ativos de tarefa (o campo de lembrete é guardado, mas nada avisa).
- Suspensão marcar atribuições para revisão (fluxo 22, item 5).
- Exportação de conversas, anexos e relatórios (só contatos e oportunidades por enquanto).
- Evento de auditoria para "resposta enviada pelo CRM" (decisão de produto: seria um evento por mensagem).

## Limitações conhecidas

- O histórico depende do celular e chega uma única vez, no pareamento. Um lote acima de ~4,5 MB recusado pela
  Vercel não chega ao app e só é percebido pelo prazo de 10 minutos.
- A Evolution usa o protocolo não oficial do WhatsApp Web: há risco de bloqueio do número.
- Nada disso foi validado com celular real.

---

## Banco de dados

- **Migrations**: 51 arquivos forward-only (`20260802000100` a `20260802005100`); todas as 51 estão em produção (`004300` a `004900` em 2026-10-13; `005000` em 2026-10-14; `005100` em 2026-10-15).
- **Tabelas de domínio**: 19 (`public`), com RLS habilitada e forçada.
- **Funções**: leitura por RPCs `SECURITY INVOKER` (RLS preservada); escrita por RPCs `SECURITY DEFINER`
  auditadas; funções de ingestão e de mídia só para `service_role`.
- **Bucket privado** `whatsapp-media` no Storage, sem políticas (acesso só pelo servidor).

## Qualidade e testes

- **pgTAP**: 31 arquivos, 884 testes passando no branch `feat/mvp-noite` (`supabase test db --local`, em banco novo/descartável); na `main`, 19 arquivos e 633 testes.
- **Unitários**: 351 testes no branch `feat/mvp-noite` (284 na `main`) (`npm run test:unit`).
- **Ponta a ponta** (ambiente descartável, scripts fora do repositório): QR com Evolution real v2.3.7 (16/16) e
  simulada (25/25), mídia, histórico (25/25), Kanban/SLA/estados vazios (19/19).
- **`npm run lint`**, **`npm run typecheck`** (zero erros) e **`npm run build`**: aprovados.
- **CI** (`.github/workflows/ci.yml`): a cada push em `main` e em pull requests roda lint, tipos, unitários,
  build e, em job separado, migrations + pgTAP.

## Infraestrutura

- **Vercel**: variáveis necessárias para o WhatsApp: `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`,
  `EVOLUTION_WEBHOOK_SECRET` (**pendentes de configuração/confirmação**).
- **Evolution API**: compose local em `docker/evolution/`; produção prevista em VPS Contabo (Debian 12) com
  `docker/evolution-prod/` (**pendente de hospedagem**).
- **Supabase**: migrations aplicadas por `supabase db push --linked` com backup, dry-run e validação.

---

## Documentos principais

- [STATUS_PROJETO.md](STATUS_PROJETO.md): este documento.
- [ROADMAP.md](ROADMAP.md): planejamento.
- [DEPLOY_EVOLUTION_VPS.md](DEPLOY_EVOLUTION_VPS.md): hospedagem da Evolution (VPS Contabo), Vercel e roteiro do teste com celular.
- [FLUXOS_NEGOCIO.md](FLUXOS_NEGOCIO.md): documento de MVP (28 fluxos).
- [HANDOFF.md](../HANDOFF.md): transição operacional (ainda descreve a Sprint 24; consulte este status primeiro).
- [DECISOES.md](DECISOES.md), [ARQUITETURA.md](ARQUITETURA.md), [DOCUMENTATION_POLICY.md](DOCUMENTATION_POLICY.md).
- [docs/sprints/](sprints/): relatórios imutáveis por sprint.

## Publicado em produção em 2026-10-14 (ex-branch `feat/whatsapp-pessoal`, commit `965f695`)

Preparação do WhatsApp para um número pessoal. Detalhes em [RELATORIO_WHATSAPP_PESSOAL.md](RELATORIO_WHATSAPP_PESSOAL.md); rollback em `docs/rollback/20260802005000_rollback.sql`.
- **Chaves por conexão** (Configurações > WhatsApp, só o dono, auditadas): histórico ao conectar (0 a 15 dias), receber grupos (padrão desligado) e modo "só cadastrados" (padrão desligado; contador "N ignoradas").
- Lista de transmissão, canal e Status nunca entram na conversa individual.
- A conexão de produção (ainda **não pareada**) foi deixada pela migration com histórico 0, grupos desligados e modo "só cadastrados" ligado. **O QR code ainda não foi escaneado.**
- Pendência: contatos `@lid` (WhatsApp novo, sem telefone real) viram contato com telefone falso com o modo desligado; tratar depende de um payload real da Evolution (campos alternativos de telefone).

## Checklist de publicação (antes de qualquer merge ou push na `main`)

O CI do GitHub roda em **Node 22**; o desenvolvimento local costuma usar Node 24. Já houve falha só no CI por diferença entre as duas versões (`require.resolve("@/...")` em teste), então rode **nas duas versões**:

1. `npm run lint`, `npm run typecheck` e `npm run test:unit` com **Node 24** (o local).
2. Os mesmos três com **Node 22**, sem instalar nada: `npx -y node@22 node_modules/eslint/bin/eslint.js`, `npx -y node@22 node_modules/typescript/bin/tsc --noEmit` e `npx -y node@22 node_modules/@playwright/test/cli.js test -c playwright.unit.config.ts`.
3. Build com as variáveis falsas do CI (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_CLIENT_KEY` e `SUPABASE_ADMIN_KEY` com valores de mentira): `npm run build`.
4. Em testes, use caminho relativo em `require.resolve(...)` (o apelido `@/` só funciona em `require(...)` e `import`).
5. Mudança de banco: suíte pgTAP do zero e, em produção, backup, `migration list --linked`, `db push --linked --dry-run` e validação somente leitura (migrations primeiro, app depois).
6. Depois do push, conferir **por CLI** (sem abrir painel): CI com `gh run list -R Mariojorge-co/imobflux -L 3` e, para os jobs, `gh run view <id> -R Mariojorge-co/imobflux --json jobs` (esperado: "Lint, tipos, testes unitários e build" e "Banco (migrations + pgTAP)" em success); deploy com `vercel ls imobflux` (o mais recente em Production deve estar "Ready" e com a idade batendo com o push) e `vercel inspect <url>`. Ferramentas e logins já feitos neste Windows (`gh` em `C:Program FilesGitHub CLIgh.exe` se o PATH não atualizar; `vercel` global do npm). Só leitura: nunca rodar `vercel setup`/`link`/`deploy`.

## Publicado em produção em 2026-10-15 (ex-branch `fix/conversas-pacote`)

Detalhes, números de desempenho, testes e roteiro em [RELATORIO_CONVERSAS_PACOTE.md](RELATORIO_CONVERSAS_PACOTE.md); rollback da migration em `docs/rollback/20260802005100_rollback.sql`.
- **Troca de conversa rápida:** lista no layout (carregada uma vez), cabeçalho por uma consulta (`get_conversation_item`), consultas em paralelo, acesso do usuário em 1 consulta, esqueleto e prefetch; medido em banco local com 230 conversas: de ~1,6 s para ~0,4 s no navegador.
- **Contador de espera numa regra só:** nos dois sentidos; conversa **arquivada** (= encerrada) fica sem chip em lugar nenhum; resposta que falhou não conta; mensagem do cliente numa conversa arquivada **reabre** a conversa (com auditoria).
- **Envio:** bolha "Enviando…" na hora, falha marcada como "Não enviada", eco do webhook sem bolha duplicada; a instância de envio vem do banco (a fila devolve `instance_name`). `EVOLUTION_INSTANCE_NAME` na Vercel continua como reserva e **não deve ser removida** por enquanto.
- **Mídia e espaço:** figurinha pequena sem bolha, foto/vídeo com altura limitada e ampliar, responsáveis no cabeçalho, caixa de texto que cresce.

## Pendências a registrar (conferir antes de seguir)
- **Investigar ANTES de convidar funcionários:** o teste de navegador `tests/team-management.spec.ts` ("ATTENDANT não administra equipe e respeita contatos, grupos e histórico temporal") **falha**: o atendente é redirecionado (`/conversas?reason=access_changed`) ao abrir um grupo liberado. Falha com o app da `main`, com o banco em qualquer estado testado (inclusive só até a `004200`) e **antes** do trabalho de 13 a 15/10, então não é regressão recente. Pode ser teste desatualizado ou bug real de visibilidade de grupo para atendente; há tarefa aberta para investigar. Hoje só existe o dono (e um atendente de teste), por isso o risco imediato é baixo.
- **Suíte não executada:** `isolated-tests/email-auth-flow.spec.ts` (config `playwright.auth-isolated.config.ts`) exige uma cópia dedicada `imobflux-auth-disposable` com Supabase na porta 56321 e não foi rodada nesta entrega. Cobre e-mail, convite e recuperação (as suítes `auth-flow`, `team-management` e `email-auth-flow` unitária passaram). Rodar antes de mexer de novo em autenticação ou convite.
- **Verificação do CI:** confirmar no GitHub (Actions ou e-mail) que o job "Lint, tipos, testes unitários e build" (Node 22) e o de banco ficaram verdes depois do push, e a Vercel em "Ready".
- Em aberto, sem relação com esta entrega: contatos `@lid`, exclusão real de contato/conversa e custo do `get_conversations_inbox` com volume maior (item M2).

## Publicado em produção em 2026-10-15 (ex-branch `feat/respostas-rapidas`): respostas rápidas

Detalhes em [RELATORIO_RESPOSTAS_RAPIDAS.md](RELATORIO_RESPOSTAS_RAPIDAS.md); rollback da migration em `docs/rollback/20260802005200_rollback.sql`.
- **Respostas rápidas publicadas:** painel (⚡ na caixa de mensagem), atalho "/", variáveis, aviso de `{{campo}}` ao enviar, caixa de mensagem maior (40%/60% da tela), gestão em `/configuracoes/respostas-rapidas` (aberta a todos os membros). Usar nunca envia.
- Migration `20260802005200_quick_replies.sql` aplicada em produção (Trava A) e app publicado (Trava B). As tabelas começam vazias; os exemplos entram só pelo botão "Adicionar exemplos".
- Foto na conversa: máximo 220 px (desktop) / 180 px (celular) no maior lado.
- Teste `team-management` (atendente em grupo liberado) corrigido: era teste desatualizado (contato protegido prevalece em grupo, migration 003600), não bug.
- **Pendências:**
  - Eventos de auditoria de respostas rápidas aparecem como "Outros" na tela de Auditoria (o filtro por categoria é validado numa função de banco; ampliar exige nova migration).
  - Vídeo na conversa ainda no limite antigo (220/280 px); só a foto foi reduzida.
  - Suíte `email-auth-flow` (cópia `imobflux-auth-disposable`) ainda não executada; rodar antes de mexer em autenticação ou convite.
  - Conferir o CI (Node 22) no GitHub e o Ready da Vercel depois do push.

## Em revisão (NÃO publicado): branch `feat/pacote-arquivos-prazos`

Envio de arquivos pelo WhatsApp, fila de envio não bloqueante, prazos configuráveis (pausa por conversa), grupos e conversa consigo mesmo. Detalhes, contrato da Evolution, decisões, roteiro de teste e riscos em [RELATORIO_PACOTE_ARQUIVOS_PRAZOS.md](RELATORIO_PACOTE_ARQUIVOS_PRAZOS.md).
- **4 migrations só locais** (`20260802005300`–`005600`), todas com rollback testado em `docs/rollback/`. **Publicar migrations primeiro (Trava A) e o app depois (Trava B).**
- Antes de publicar: rodar o checklist abaixo e conferir CI e Vercel por CLI (`gh run list`, `vercel ls`).
- Pendências conhecidas: eco de arquivo antes da confirmação pode gerar linha duplicada no banco (a tela esconde); varredura de uploads órfãos manual (`npm run sweep:uploads`); só um envio real prova o comportamento da Evolution com arquivos grandes.
