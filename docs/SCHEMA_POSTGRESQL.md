# Schema PostgreSQL do ImobFlux

Status: autenticação local, bootstrap inicial e RLS somente leitura para o
OWNER individual implementados até a Sprint 13, sem dados de negócio ou
integração externa.

## 1. Objetivo

Este documento resume a implementação executável do modelo definido em
`docs/MODELO_LOGICO_BANCO.md`. A especificação completa do domínio permanece no
modelo lógico; este arquivo registra somente decisões físicas, migrations e
validação.

## 2. Estrutura Supabase

O projeto usa a estrutura mínima compatível com Supabase CLI:

```text
supabase/
  config.toml
  migrations/
  tests/database/
```

`config.toml` contém apenas o identificador local do projeto e desabilita seed.
Supabase Auth é usado exclusivamente no ambiente local nesta sprint. Não há
vínculo remoto, credencial versionada, bucket ou função de borda.

## 3. Migrations

As migrations são aplicadas em ordem lexical e de dependência:

| Ordem | Migration | Responsabilidade |
| --- | --- | --- |
| 1 | `20260802000100_create_foundation.sql` | Usuários duráveis, workspaces e memberships |
| 2 | `20260802000200_create_contacts_and_channels.sql` | Contatos, pontos e conexões externas |
| 3 | `20260802000300_create_conversations.sql` | Conversas, participantes, mensagens, anexos e atribuições |
| 4 | `20260802000400_create_commercial_operations.sql` | Pipeline, oportunidades, tarefas e notas |
| 5 | `20260802000500_create_audit_and_technical_triggers.sql` | Auditoria e integridade técnica reutilizável |
| 6 | `20260802000600_harden_schema_integrity.sql` | Correções de timestamps, append-only, autoria de convite e unicidade de Auth |
| 7 | `20260802000700_add_local_auth_and_initial_bootstrap.sql` | FK de Auth, grants restritos e bootstrap global inicial |
| 8 | `20260802000800_grant_service_role_bootstrap_access.sql` | Privilégios mínimos do cliente administrativo isolado |
| 9 | `20260802000900_enable_owner_rls.sql` | RLS somente leitura para o OWNER individual autenticado |
| 10 | `20260802001000_add_contact_operations.sql` | Operações transacionais e auditadas do módulo Contatos |

As migrations são forward-only, não contêm `IF NOT EXISTS` para esconder
divergências e não incluem dados reais ou seed funcional. A migration corretiva
remove somente a constraint `uq_app_users_auth_user` para substituí-la, na mesma
transação, pelo índice UNIQUE parcial definido no modelo lógico. Nenhuma tabela,
coluna ou dado é removido.

## 4. Extensões e UUID

Nenhuma extensão é habilitada pelas migrations. As PKs usam `uuid` com
`gen_random_uuid()`, função disponível no PostgreSQL atual e no ambiente
PostgreSQL do Supabase.

O teste habilita pgTAP dentro de uma transação própria. Isso é dependência de
validação, não extensão do schema de produção, e o teste termina com rollback.

## 5. Tabelas

O schema `public` contém as 18 tabelas aprovadas:

1. `app_users`
2. `workspaces`
3. `workspace_members`
4. `contacts`
5. `contact_points`
6. `channel_connections`
7. `conversations`
8. `conversation_participants`
9. `messages`
10. `attachments`
11. `conversation_assignments`
12. `pipeline_stages`
13. `opportunities`
14. `opportunity_conversations`
15. `pipeline_history`
16. `work_tasks`
17. `internal_notes`
18. `audit_events`

Todas usam PK UUID. As tabelas do tenant carregam `workspace_id`; FKs compostas
e UNIQUEs de suporte impedem referências entre workspaces.

## 6. Funções e triggers

As funções técnicas e de bootstrap existentes preservam seu comportamento. As
três funções técnicas de `public` não usam `SECURITY DEFINER`:

- `public.set_updated_at()`: define automaticamente `updated_at` com
  `statement_timestamp()` antes de alterações;
- `public.prevent_append_only_mutation()`: rejeita `UPDATE`, `DELETE` e
  `TRUNCATE` em registros append-only;
- `public.bootstrap_initial_workspace(...)`: cria atomicamente `app_user`,
  workspace, membership OWNER e evento de auditoria do primeiro bootstrap.

`private.active_owner_context()` e as cinco RPCs do módulo Contatos são as seis
funções `SECURITY DEFINER` aprovadas nos schemas da aplicação. Todas pertencem
a `postgres`, possuem `search_path` vazio, usam objetos totalmente qualificados
e não contêm SQL dinâmico. O contexto privado é `STABLE`, não aceita parâmetros
e retorna somente `app_user_id`, `member_id` e `workspace_id` derivados de
`auth.uid()` quando usuário, membership OWNER e workspace estão ativos.

As cinco RPCs `VOLATILE` de Contatos são `create_contact`, `update_contact`,
`set_contact_operational_status`, `archive_contact` e `restore_contact`. Cada
uma exige exatamente um contexto de OWNER ativo antes de derivar workspace e
member da sessão. Elas não aceitam `workspace_id`, `member_id` nem campos de
privacidade. A criação e a edição registram opcionalmente um telefone brasileiro
normalizado (`+55` seguido de 10 ou 11 dígitos), sem criar número principal. A
edição é rejeitada com segurança caso o contato já possua mais de um telefone
ativo; nenhum número é escolhido ou removido arbitrariamente.

As mutações de contato, ponto telefônico e `audit_events` fazem parte da mesma
transação. A auditoria guarda somente tipo de ação, alvo, ator e metadados sem
PII (flags e estados), nunca nome ou telefone. Arquivar e restaurar alteram
somente `archived_at`; não há operação de exclusão física.

`authenticated` possui somente `USAGE` no schema privado e `EXECUTE` em
`private.active_owner_context()`. Nas RPCs de Contatos, somente
`authenticated` possui `EXECUTE`; `PUBLIC`, `anon` e `service_role` são
explicitamente revogados. `authenticated` continua sem `INSERT`, `UPDATE`,
`DELETE`, `TRUNCATE`, `REFERENCES` ou `TRIGGER` diretos em `contacts`,
`contact_points` e `audit_events`.

`set_updated_at()` é usada por 12 triggers nas tabelas mutáveis que possuem a
coluna e sempre substitui qualquer valor de `updated_at` enviado pelo cliente.
`statement_timestamp()` representa o início da instrução corrente, portanto uma
atualização posterior dentro da mesma transação recebe um instante posterior.
`pipeline_history` e `audit_events` possuem, cada uma, um trigger por linha para
`UPDATE`/`DELETE` e um trigger por instrução para `TRUNCATE`. Não existe trigger
de negócio, auditoria automática, criação de OWNER, sincronização ou alteração
automática do pipeline.

O bootstrap usa `SECURITY INVOKER`, `search_path` vazio, nomes totalmente
qualificados e advisory transaction lock. `PUBLIC`, `anon` e `authenticated`
não possuem `EXECUTE`; somente `service_role` pode chamar a função. Qualquer
workspace existente encerra globalmente o bootstrap do MVP.

## 7. Constraints principais

- todos os estados são `text` com `CHECK` nomeado;
- as 55 FKs de domínio usam `ON DELETE RESTRICT` e nenhuma usa cascata;
- referências entre tabelas do tenant incluem `workspace_id`;
- `auth_user_id` é nullable e possui índice UNIQUE parcial explícito com
  `WHERE auth_user_id IS NOT NULL`; sua FK validada referencia `auth.users(id)`
  com `ON DELETE SET NULL`, preservando identidade e autoria duráveis;
- membership não removido, convite aberto e OWNER não removido possuem UNIQUEs
  parciais;
- `invited_by_member_id` é obrigatório para memberships convidados; a única
  forma local com autor nulo exige OWNER já ativado, `user_id` preservado e
  ausência completa dos dados de convite. Essa representação continua válida
  nos estados `active`, `suspended` e `removed`;
- membership não pode indicar a si próprio como autor do convite, e a FK
  composta do autor impede referência a outro workspace;
- convite cancelado pode terminar removido sem `user_id`, desde que preserve
  e-mail, convite e remoção e nunca tenha sido ativado;
- ponto de contato é único por workspace, tipo e valor normalizado;
- conta externa é única por provedor e existe no máximo uma conexão ativa por
  provedor em cada workspace;
- conversa é única por conexão e thread externa;
- participante possui exatamente uma identidade;
- mensagem CRM exige saída, autor e chave local; mensagem WhatsApp exige ID e
  timestamps externos e proíbe autoria interna presumida;
- mensagem externa e chave local de idempotência possuem UNIQUEs independentes;
- tarefas exigem ao menos um contexto e notas exigem exatamente um;
- oportunidade ganha ou perdida exige `closed_at`; arquivamento é independente;
- atribuições e vínculos oportunidade-conversa não podem duplicar linha ativa;
- pipeline e auditoria rejeitam atualização, exclusão e truncamento.

## 8. Índices

Além dos índices gerados por PKs e UNIQUE constraints, existem 55 índices
explicitamente declarados para:

- identidade de Auth não nula, membership e OWNER;
- busca por contato e ponto normalizado;
- privacidade de contato e conversa;
- conexão e identidade externa;
- paginação keyset de mensagens, pipeline e auditoria;
- entrega e idempotência de mensagens;
- anexos e associações ativas;
- Kanban, responsável e contato da oportunidade;
- tarefas por prazo, prioridade, responsável e contexto;
- notas por contexto;
- auditoria por tempo, alvo, ator e correlação.

Nenhum índice de cache de última mensagem, contador ou resumo foi criado.

## 9. RLS, grants e autenticação

RLS está habilitada nas 18 tabelas. Cada tabela possui exatamente uma policy
explícita de `SELECT`, restrita a `authenticated` e baseada na subconsulta
estável de `private.active_owner_context()`:

- `app_users` expõe somente o próprio usuário de domínio ativo;
- `workspaces` expõe somente workspace ativo do contexto OWNER;
- `workspace_members` expõe somente vínculos do workspace autorizado;
- as outras 15 tabelas exigem `workspace_id` presente no contexto OWNER ativo.

Não existem policies de `INSERT`, `UPDATE` ou `DELETE`. `authenticated` recebe
somente `SELECT` nas 18 tabelas e continua sem `INSERT`, `UPDATE`, `DELETE`,
`TRUNCATE`, `REFERENCES` ou `TRIGGER`. `anon` permanece sem qualquer grant de
tabela. O schema `private` não integra os schemas expostos pelo PostgREST.

A escrita será liberada progressivamente por módulo vertical. Cada liberação
deverá incluir, na mesma etapa, grants mínimos, policies `USING` e `WITH CHECK`,
operação transacional, auditoria e testes. Por isso, a Sprint 13 não testa
`WITH CHECK` e não conecta funcionalidade de escrita.

`service_role` recebe somente `SELECT` em `app_users`, `workspaces` e
`workspace_members`, além de `INSERT` nessas três tabelas e em `audit_events`.
Ela não possui `UPDATE`, `DELETE`, `TRUNCATE`, `TRIGGER` ou `REFERENCES`, nem
qualquer privilégio nas outras 14 tabelas. Esse conjunto permite a consulta do
vínculo ativo e a execução do bootstrap com `SECURITY INVOKER` sem ampliar o
acesso do cliente administrativo.

## 10. Testes estruturais

`supabase/tests/database/schema_integrity.test.sql` possui 72 verificações pgTAP
em transação, incluindo:

- existência das 18 tabelas e PKs;
- RLS desabilitada e ausência de cascata;
- verificação por catálogo de que todas as FKs entre tabelas do tenant incluem
  `workspace_id` nos dois lados;
- índice parcial de `auth_user_id` e rejeição de identidade não nula duplicada;
- lifecycle, autoria e isolamento do autor de convite de memberships;
- OWNER e conexão ativa duplicados;
- identidade normalizada duplicada;
- unicidade de conversa por conexão e thread externa;
- unicidade de posição e nome normalizado das etapas ativas;
- exclusividade do participante;
- origem, autoria e idempotência de mensagens;
- integridade dos estados de anexos;
- coerência do ator de auditoria;
- contextos de tarefas e notas;
- encerramento de oportunidade;
- associações ativas duplicadas;
- preservação e proteção contra `UPDATE`, `DELETE` e `TRUNCATE` dos históricos;
- proteção equivalente da auditoria;
- uso seguro e avanço de `updated_at` em instruções posteriores da mesma
  transação.

Os dados usados são UUIDs e textos sintéticos, e o teste termina com `ROLLBACK`.

`supabase/tests/database/auth_bootstrap.test.sql` acrescenta 46 verificações
para a FK de Auth, privilégios das sete operações em todas as 18 tabelas,
permissões e segurança da função, bootstrap único, auditoria e preservação do
domínio após remoção de `auth.users`.

`supabase/tests/database/owner_rls.test.sql` acrescenta 60 verificações
transacionais para RLS, policies, grants, segurança do schema privado, função
de contexto, estados negados de identidade e membership, isolamento entre
workspaces, leitura das 18 tabelas pelo OWNER e rejeição de toda escrita. A
exposição do schema privado pelo PostgREST e a rejeição de ATTENDANT pelo DAL
também são verificadas pela regressão Playwright.

## 11. Como validar

Com Supabase CLI e um runtime compatível com Docker já instalados:

```bash
npx.cmd --yes supabase@2.111.0 start
npx.cmd --yes supabase@2.111.0 db reset --local --no-seed
npx.cmd --yes supabase@2.111.0 test db --local
npx.cmd --yes supabase@2.111.0 db lint --local --level warning
```

`supabase db reset` é destrutivo somente para o banco local descartável. Nunca
usar `--linked` para esta validação.

Validação do projeto web:

```bash
npm run lint
npm run build
npm run test:auth
```

## 12. Rollback

Não existem migrations destrutivas de rollback. Em desenvolvimento local, um
banco descartável pode ser reconstruído pela sequência completa. Após qualquer
implantação, uma correção deve ser uma nova migration forward-only, precedida de
backup e validação no ambiente adequado.

## 13. Pontos adiados

Continuam fora desta sprint:

- garantia transacional de pelo menos um OWNER ativo;
- transferência de propriedade;
- eventual rebaixamento para ATTENDANT do membership que foi criado como OWNER
  inicial sem convite. O schema não possui um campo histórico que identifique
  essa origem, e nenhum campo foi adicionado na Sprint 10.1;
- restauração de atribuições após reativação;
- validação de membro ativo em responsabilidades e autorias;
- validação de etapa ativa em novas movimentações;
- validação das transições permitidas entre estados de membership;
- atomicidade entre etapa atual e histórico;
- regra transacional de mensagem contendo texto ou anexo;
- normalização concreta de telefone e validação completa de timezone IANA;
- convites, recuperação e alteração de senha, MFA e login social;
- grants e policies de escrita, Storage, API de negócio e integrações;
- policies comerciais e temporais para ATTENDANT.

Esses adiamentos não removem colunas ou relações necessárias para as etapas
futuras.

## 14. Diferenças e esclarecimentos de implementação

- Um membership removido aceita `user_id` nulo exclusivamente quando representa
  convite cancelado antes da ativação. Membership já ativado exige e preserva
  `user_id`.
- Um único UNIQUE parcial para OWNER não removido também impede dois OWNERs
  ativos, evitando índice redundante.
- A regra append-only foi materializada com o mesmo guard técnico para
  `UPDATE`, `DELETE` e `TRUNCATE` em `pipeline_history` e `audit_events`; ele não
  cria eventos nem executa lógica comercial.
- O OWNER inicial sem convite permanece estruturalmente válido quando ativo,
  suspenso ou removido. A constraint exige `role = 'owner'`, `user_id` e
  `activated_at`, ausência de e-mail e timestamps de convite, além das regras de
  lifecycle e timestamps já existentes.
- A constraint UNIQUE comum de `app_users.auth_user_id` foi substituída por um
  índice UNIQUE parcial explícito. A semântica de múltiplos nulos é preservada e
  a implementação passa a corresponder literalmente ao modelo lógico.
- A FK de autenticação usa `ON DELETE SET NULL`; remover a credencial de Auth
  não remove `app_users`, membership, workspace ou autorias históricas.
- `external_created_at` e `received_at` são obrigatórios para mensagens de
  origem WhatsApp, mas não possuem ordenação rígida entre si porque pertencem a
  relógios diferentes. `occurred_at` continua sendo o instante canônico.

Não há outra divergência estrutural em relação a
`docs/MODELO_LOGICO_BANCO.md`.

## 15. Bootstrap e compensação entre Auth e domínio

O bootstrap é global e executável uma única vez no MVP individual. Ele não
representa o futuro fluxo de provisionamento de workspaces, que exigirá uma
operação administrativa distinta. A indisponibilidade de `/setup` é apenas UX;
a função PostgreSQL rejeita um segundo bootstrap mesmo diante de concorrência.

O token de bootstrap deve ser gerado com alta entropia. Ele é recebido somente
por `POST`, comparado por digest com `timingSafeEqual` e nunca é colocado em URL,
query string, log, mensagem de erro ou bundle. Server Actions validam a origem e
usam redirecionamentos fixos.

Auth Admin e PostgreSQL não compartilham uma transação. Os resultados são
tratados separadamente:

- sucesso completo: Auth user e domínio público são criados, e a sessão é
  iniciada;
- falha antes do RPC: nenhum registro público é criado e não há compensação;
- erro reportado pelo RPC com `app_user` encontrado na reconciliação: o commit
  do domínio é considerado concluído, não há exclusão e o fluxo prossegue para
  autenticação;
- erro do RPC com ausência do `app_user` confirmada: a aplicação tenta excluir
  de Auth somente o UUID criado pela tentativa atual;
- erro do RPC seguido de falha na consulta de reconciliação: o resultado é
  ambíguo, nenhuma exclusão é executada e a recuperação passa a ser
  administrativa;
- falha da compensação após ausência confirmada: o domínio público continua
  vazio, mas existe um Auth user órfão que exige recuperação administrativa.

A compensação recebe diretamente o UUID retornado por `createUser`; ela nunca
procura nem exclui por e-mail e só ocorre após uma consulta bem-sucedida
confirmar a ausência em `public.app_users`. Para recuperar um órfão ou resultado
ambíguo, o administrador deve identificar em ambiente confiável somente o UUID
registrado no diagnóstico server-side, verificar a correspondência em
`public.app_users.auth_user_id` e decidir a recuperação sem presumir que o RPC
falhou. Uma nova tentativa só deve ocorrer após essa verificação.

A configuração inicial usa `America/Maceio` como fuso do workspace. Não existe
seletor de fuso nesta sprint; a função PostgreSQL continua recebendo o valor
explicitamente informado pela aplicação.
