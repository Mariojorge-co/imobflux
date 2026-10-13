# Relatório das correções da revisão adversarial — branch `feat/mvp-noite`

Correções dos achados da revisão adversarial, feitas **somente no ambiente local** (Supabase local), sem push, sem
tocar na `main` e **sem aplicar nada em produção**. As migrations `20260802004300` a `20260802004800` ficaram
**intactas**; todas as correções de banco estão em **uma única migration nova, `20260802004900_review_fixes.sql`**.
Método: teste de banco (pgTAP) escrito antes (vermelho), depois a implementação (verde).

> **Parado aguardando a sua autorização expressa para o passo de produção.**

## Resumo por achado

| Achado | O que foi feito | Commit |
|---|---|---|
| **A1 (ALTO)** reconvidar removido | `prepare_team_invitation` reaproveita o `app_users` existente; `inviteMemberAction` usa o caminho de e-mail de acesso. Testado do remover ao aceitar, no banco **e** no navegador, com o e-mail real (Mailpit) | `a67f464` |
| A1 (complemento) | Mensagem clara quando o reconvidado repete a senha anterior | `280bf8b` |
| **B1** `service_role` | `revoke` explícito de `service_role` nas funções novas e nas privadas auxiliares; teste que varre todas | `79aacef` |
| **B2** corrida remoção × atribuição | 4 funções leem o membro com `FOR SHARE`; teste observa o travamento de linha | `85cc47a` |
| **B3** concluir de novo | `complete_work_task` idempotente (`already_completed`) + mensagem amigável no app | `82cc6a0` |
| **B4** `upsert_work_task` | só edita tarefa pendente | `b8d6bc1` |
| **B5** nomes na auditoria | `get_audit_events` devolve `member_names` (inclui removidos); a tela usa | `1ea59c5` |
| **M1** exportação | teto de 5.000 linhas, aviso visível na tela, `maxDuration = 30` | `8ef2c0b` |

## Detalhes e decisões

**A1 — reconvidar removido.** Causa: `prepare_team_invitation` criava um `app_users` novo sem vínculo de acesso, e o
acesso já existente não podia ser religado (`team_auth_identity_already_linked`). Agora, se o e-mail já existe em
`auth.users` e o `app_users` correspondente está ativo e **sem vínculo vivo** em nenhum workspace, ele é reaproveitado
(o vínculo antigo continua `removed`; o novo nasce `invited`; o nome cadastrado é mantido). Se a identidade está
desativada ou ativa em outro workspace: `team_identity_unavailable` (mensagem em português; evita dois contextos
ativos, que o MVP não suporta). No app, quando a identidade foi reaproveitada, o convite do Auth (que recusa e-mail já
registrado) é substituído pelo mesmo caminho do reenvio (e-mail de acesso + convite pendente já vinculado).
Verificado no navegador: convidar → aceitar → remover (a sessão aberta perde o acesso na hora) → reconvidar o mesmo
e-mail → chega e-mail novo → aceitar → entra e volta a ver as conversas; um único `app_users`, vínculo antigo
removido, novo ativo, equipe lista a pessoa uma vez.
Observação de UX: quem volta já tem uma senha e o Auth recusa repetir a mesma. Antes a tela dizia só "Não foi possível
definir sua senha"; agora diz "Escolha uma senha diferente da anterior". Só mudou a mensagem (nenhuma verificação do
fluxo de convite foi alterada).

**B1 — `service_role`.** Honestidade sobre a reprodução: neste banco local o privilégio padrão do `postgres` **não**
concede EXECUTE a `service_role` em funções novas, então o problema só existe se o ambiente hospedado tiver o padrão
antigo. Por isso o vermelho foi provado **simulando o padrão antigo** (grant manual nas funções): o teste falhou e
passou a verde com a 004900. O `revoke` explícito independe do padrão do ambiente. O teste `new_functions_grants`
fica como guarda permanente.

**B2 — corrida.** `assign_conversation`, `reassign_conversation`, `create_work_task` e `reassign_work_task` leem o
membro com `FOR SHARE`. Como `remove_team_member` usa `FOR UPDATE`, uma remoção concorrente espera e depois libera o
que foi atribuído; uma atribuição que começa depois enxerga o removido e é recusada. O teste observa o travamento de
linha dentro da transação (`pgrowlocks`) e cobre a ordem das operações.

**B3 — opção escolhida: idempotência no banco.** É a mais simples e coerente com `assign`/`reassign` ("unchanged").
Concluir tarefa já concluída devolve sucesso (`already_completed`), sem novo evento e sem trocar quem concluiu.
Concluir tarefa **cancelada** continua recusado (`task_not_pending`), e o app mostra mensagem em português.
Mudança consciente de teste: em `work_tasks.test.sql`, "concluir de novo é recusado" passou a esperar o
comportamento idempotente.

**B4.** `upsert_work_task` só edita tarefa pendente. Nenhum teste antigo dependia do comportamento anterior (os de
reagendar follow-ups usam tarefas pendentes e passaram sem alteração).

**B5.** `get_audit_events` devolve `member_names` com o nome de todos os membros citados (autor e ids do metadata),
inclusive removidos, sempre do próprio workspace (id de outro workspace nunca é resolvido). A tela usa esse mapa; a
lista de equipe só alimenta o filtro "Pessoa".

**M1.** Teto de 5.000 linhas (as mais antigas entram). A tela de exportação mostra o total de cada tipo e um aviso
visível quando passa do teto; o cabeçalho `X-Export-Truncated` continua. **Auditoria "success" depois da resposta:
não foi viável sem quebrar o desenho** (documentado também no código da rota). O evento é gravado pelo banco quando
ele entrega as linhas; mover o registro para depois (um segundo passo chamado pelo app) permitiria obter os dados
**sem rastro** chamando a função diretamente. Limitação aceita: a auditoria registra "dados liberados", não "arquivo
baixado".

## Um erro meu, pego pelos testes antigos

Na primeira versão da 004900, `select display_name into v_display_name` zerava o nome quando o e-mail já estava no
Auth mas não havia `app_users` (criação passaria a falhar com nome nulo). Os testes antigos de `team_management`
acusaram 13 falhas; corrigi com uma variável separada e acrescentei teste do caso (e-mail no Auth sem cadastro).

## Resultados da verificação

| Verificação | Resultado |
|---|---|
| pgTAP, banco **novo e limpo**, todas as migrations do zero (004300 a 004900) | **31 arquivos, 884 testes, PASS** |
| Testes unitários | **351 passando** |
| `lint`, `typecheck`, `build` | sem erros |
| E2E no navegador (banco local separado dos testes de banco) | **19/19**: reconvite completo com e-mail real, remoção, atribuição, nomes na auditoria, concluir tarefa em página desatualizada, aviso e teto de exportação |
| Rollback da 004900 (script testado) | pós-rollback a suíte anterior (801) passa; reaplicando a 004900, 884 passam |
| Realtime e sessão de usuário removido (local) | **14/14**, veja abaixo |

Ambientes: quatro Supabase locais novos e isolados (testes de banco, verificação do zero, E2E e prova do rollback),
nenhum `db reset`, nenhum contato com produção. Todos foram parados ao final.

### Realtime e sessão do usuário removido (item que a revisão não conseguiu verificar)
Teste com um atendente real (login, canal Realtime aberto) removido pelo dono:
- Ativo: recebe a mensagem nova pelo Realtime e enxerga as conversas.
- Depois de removido: **não recebe mais eventos** nem no canal que já estava aberto nem num canal novo aberto com o
  token antigo; a API devolve **0** conversas, mensagens e vínculos; diretório de membros vazio; exportação, auditoria
  e criação de tarefa são **negadas**; tarefas visíveis: nenhuma.
- A conta do Auth continua existindo: o token antigo segue válido para `getUser()` e `refreshSession()` funciona, mas
  o acesso a dados continua negado (mesmo com a sessão renovada). O bloqueio é pelo vínculo, não pelo token. Se quiser
  encerrar a sessão do removido também no Auth, isso precisaria de uma chamada administrativa por usuário (não feita).

## Pendências futuras (apenas registradas, como pedido)

- **M2:** medir o custo de `get_conversations_inbox` com volume real (a busca de responsáveis roda para todas as
  conversas do workspace por causa dos contadores).
- **B6:** limite de frequência na exportação (e nas tentativas negadas, que geram eventos de auditoria sem limite).
- **B7 (informativos):** funções novas usam `limit 1` no contexto (indeterminado se um usuário estiver em vários
  workspaces); ao proteger contato/restringir grupo, atribuições e tarefas de atendentes permanecem (invisíveis a
  eles); `member_display_name` resolve nome de qualquer membro do próprio workspace só por id; um atendente pode
  tirar o dono dos responsáveis de uma conversa (a matriz diz "condicional ao acesso"); os testes de banco contam
  funções \`SECURITY DEFINER\` com números fixos.
- Pendências do relatório anterior (notificações, suspensão marcar atribuições para revisão, exportação de conversas
  e anexos, evento de auditoria por resposta enviada) seguem como estavam.

## Lista final de migrations para produção (ainda NÃO aplicadas)

Em produção estão aplicadas até a `20260802004200`. Pendentes, **nesta ordem, num único `db push`**:

1. `20260802004300_remove_team_member.sql`
2. `20260802004400_conversation_assignments.sql`
3. `20260802004500_audit_trail.sql`
4. `20260802004600_work_tasks.sql`
5. `20260802004700_export_dataset.sql`
6. `20260802004800_kanban_responsible_name.sql`
7. `20260802004900_review_fixes.sql`

Todas só criam/substituem funções e permissões: **nenhuma altera tabela nem dado existente**, sem bloqueio de tabela.
Procedimento de sempre: backup (esquema e dados), `migration list --linked`, `db push --linked --dry-run`,
`db push --linked`, validação somente leitura (migration list; funções e permissões: `anon` e `service_role` sem
acesso, `authenticated` com), apagar o backup.

**Ordem segura de publicação:** migrations primeiro, app depois. O app da branch funciona com o banco antigo nos
recursos já existentes e degrada nos novos; a `main` atual continua funcionando com o banco novo (assinaturas
preservadas). Sem a 004900 o app cai nos comportamentos antigos (reconvite de removido falha, nomes "outro membro",
teto de 20.000 linhas com aviso de 5.000).

### Rollback da 004900
Arquivo pronto e **testado**: `docs/rollback/20260802004900_rollback.sql` (não é migration; fica fora de
`supabase/migrations`). Devolve as 9 funções ao estado da 004800 copiando as definições dos arquivos de origem, dentro
de uma transação, sem tocar em tabela ou dado. Os `revoke` de `service_role` podem ficar. O que não se desfaz:
convites/identidades já reaproveitados continuam válidos e os eventos de auditoria são permanentes. Se a migration
for considerada revertida, registrar com `supabase migration repair --status reverted 20260802004900`.
