# Relatório da noite — branch `feat/mvp-noite`

Trabalho autônomo sobre os cinco itens pendentes do MVP, na ordem pedida. **Tudo foi concluído.**

Regras seguidas: commits **locais** na branch `feat/mvp-noite` (criada a partir da `main` em `9ac63f7`); sem push,
sem tocar na `main`, sem deploy; **nenhuma migration aplicada em produção**; banco de teste = Supabase **local** novo e
isolado (sem `db reset` e sem tocar no Supabase `imobflux` nem no de produção); nenhum segredo em arquivo ou log.

## Resumo

| # | Item | Estado | Commit |
|---|---|---|---|
| 1 | Remoção de funcionário (offboarding) | Feito | `330d634` |
| 2 | Atribuição de conversa | Feito | `fb4d41c` |
| 3 | Auditoria (eventos + tela do OWNER) | Feito | `1bdb2be` |
| 4 | Tarefas (responsável, prazo, prioridade + tela) | Feito | `a3168ec` |
| 5 | Exportação CSV (contatos e oportunidades) | Feito | `8d013e0` |
| + | Correção de bug encontrado no caminho (Kanban) | Feito | `7897c15` |

Total do branch: 46 arquivos, ~5.400 linhas, 7 commits (mais este relatório).

## Resultado dos testes (estado final do branch)

| Verificação | Resultado |
|---|---|
| pgTAP, banco **novo** com as 47 migrations aplicadas do zero | **25 arquivos, 801 testes, PASS** |
| Testes unitários (`npm run test:unit`) | **337 passando** (eram 284) |
| `npm run lint` | sem erros |
| `npm run typecheck` | sem erros |
| `npm run build` | ok (rotas novas: `/tarefas`, `/configuracoes/auditoria`, `/configuracoes/exportacao`, `/api/export/[kind]`) |
| E2E no navegador (app compilado + Supabase local) | **29/29** (atribuição, tarefas, exportação, remoção, auditoria, celular) |

Observações:
- O **pgTAP precisa de banco limpo** (vários testes contam linhas globais). Depois do E2E o banco de teste ficou com
  resíduos e 5 testes antigos falharam por isso; no banco novo todos passam. Não é regressão.
- Os scripts de E2E ficaram fora do repositório (área temporária da sessão); os testes automatizados do repositório
  são os pgTAP e unitários.

## Item 1 — Remoção de funcionário (fluxo 23)

**Migration `20260802004300_remove_team_member.sql`** — `public.remove_team_member(uuid)`.
- Só OWNER; alvo ATTENDANT em `invited`, `active` ou `suspended` do mesmo workspace (convite pendente removido =
  convite cancelado). Vínculo vira `removed` com `removed_at`; o acesso cai na hora (o contexto ativo só considera
  vínculos `active`). Reativar removido é impossível; voltar exige novo convite (cria vínculo novo).
- Libera o trabalho sem apagar nada e sem transferir: atribuições de conversa abertas encerradas
  (`end_reason='member_removed'`); oportunidades `open`/`rework` não arquivadas ficam sem responsável; tarefas
  pendentes ficam sem responsável (continuam pendentes, autor preservado).
- Auditoria: `team.member_removed` (com contagens) e `opportunity.responsible_cleared` por oportunidade.
- App: `removeMemberAction`; botões "Remover funcionário" / "Cancelar convite" com confirmação na tela de equipe.
- Testes: pgTAP `team_member_removal` (29), unitário `team-actions` (5).

## Item 2 — Atribuição de conversa (fluxos 18 e 19)

**Migration `20260802004400_conversation_assignments.sql`.**
- `assign_conversation`, `unassign_conversation`, `reassign_conversation`: qualquer membro com acesso comercial à
  conversa atribui, troca e remove; mais de um responsável por conversa; histórico preservado (autor e motivo).
- Segurança: responsável precisa ser membro **ativo** do mesmo workspace; conversa privada (contato protegido) ou
  grupo não liberado só pode ser atribuída a **OWNER**; atribuir não altera visibilidade. Auditoria
  `conversation.assigned` / `conversation.unassigned` (só ids).
- Leitura: `get_conversation_assignees`, `get_member_directory`, `private.member_display_name` (definer; o
  ATTENDANT não lê a tabela de membros pela RLS, então só nomes do próprio workspace são expostos);
  `get_conversations_inbox` ganhou responsáveis, `assigned_to_me`, visão `mine` e contador.
- App: barra de responsáveis na conversa (atribuir, trocar, remover), chip **Minhas** e nomes na lista.
- Testes: pgTAP `conversation_assignment` (36), unitário `assignment` (9).

## Item 3 — Auditoria (fluxo 25)

**Migration `20260802004500_audit_trail.sql`.**
- A tabela já era append-only e legível só pelo OWNER. Eventos novos: `opportunity.conversation_linked`
  (`link_opportunity_conversation`) e `opportunity|contact.qualification_updated` (só nomes de campos). Já auditavam:
  remoção/desativação de membro, atribuição, mudança de etapa, reordenação, arquivamentos, encerramentos,
  privacidade, WhatsApp.
- `get_audit_events` (definer, só OWNER): filtros por categoria/pessoa/período, cursor, nome do autor.
- Tela `/configuracoes/auditoria`: filtros, rótulos em português, ids traduzidos para nomes, links para a
  conversa/oportunidade, paginação; card em Configurações.
- Testes: pgTAP `audit_trail` (28, inclui imutabilidade, isolamento e ausência de conteúdo nos metadados),
  unitário `audit` (13).

## Item 4 — Tarefas (fluxos 16 e 17)

**Migration `20260802004600_work_tasks.sql`.**
- `create_work_task`, `update_work_task`, `reassign_work_task`, `cancel_work_task`; `complete_work_task` e
  `upsert_work_task` mantêm a assinatura (a tela de conversa e os testes antigos continuam valendo) e passam a
  auditar. Tipo (tarefa/follow-up), título, prazo, prioridade, lembrete, observações e responsável opcional, ligados a
  contato, oportunidade e/ou conversa.
- A tarefa herda a privacidade do contexto (RLS); responsável precisa ser ativo; contexto privado só aceita OWNER;
  concluir/cancelar só vale para pendente e nunca move a oportunidade de etapa.
- `get_work_tasks` (invoker): filtros (pendentes/concluídas/canceladas/todas; de todos/minhas/sem responsável),
  atrasadas e contadores.
- Tela `/tarefas` (todos os papéis) e item "Tarefas" na navegação.
- Testes: pgTAP `work_tasks` (43), unitário `tasks` (10).

## Item 5 — Exportação (fluxo 26)

**Migration `20260802004700_export_dataset.sql`.**
- `export_dataset('contacts'|'opportunities')`: só OWNER; registra a exportação (quem, tipo, contagem). Tentativa de
  ATTENDANT é negada **e auditada** (devolve `success=false` em vez de erro, para o registro não ser desfeito).
  Limite de 20.000 linhas com aviso de truncamento.
- Rota `GET /api/export/[kind]`: CSV UTF-8 com BOM, separador `;`, CRLF (Excel pt-BR), datas em Maceió,
  neutralização de injeção de fórmula, `Cache-Control: no-store`, `nosniff`, recusa pedidos cross-site
  (`Sec-Fetch-Site`), 401 sem sessão, 403 para quem não é OWNER.
- Tela `/configuracoes/exportacao` e card em Configurações.
- Testes: pgTAP `export_dataset` (27), unitário `export` (16).

## Bug encontrado e corrigido

**Kanban: o ATTENDANT não via o nome do responsável de colegas** (`responsible_name = null`), porque
`get_kanban_board` é invoker e a RLS só mostra ao ATTENDANT o próprio vínculo. Confirmado por consulta e corrigido na
migration `20260802004800_kanban_responsible_name.sql` (usa `private.member_display_name`); pgTAP
`kanban_responsible_name` (5).

## Decisões tomadas (opção mais segura/conservadora)

1. **Remoção:** oportunidades já encerradas (ganha/perdida/cancelada) mantêm o responsável (é histórico). Sessões do
   Auth não são revogadas por id (a API não permite sem o JWT); na prática o efeito é o mesmo, pois sem vínculo ativo
   toda consulta/ação é negada na hora. A suspensão (fluxo 22) não foi alterada ("marcar atribuições para revisão"
   ficou de fora). Não existe sistema de notificações ainda, então não há o que cancelar.
2. **Atribuição:** o ATTENDANT pode atribuir/trocar/remover responsáveis de qualquer conversa que ele enxerga (a
   matriz diz "condicional ao acesso"). Conversa privada ou grupo não liberado só aceita OWNER como responsável.
3. **Auditoria:** não há exclusão física (arquivamento/inativação, já auditados), então não há evento de exclusão.
   Resposta enviada pelo CRM (citada no fluxo 25) **não** gera evento: seria um por mensagem, duplicando a tabela de
   mensagens. A tela só exibe campos conhecidos; metadados nunca guardam texto digitado.
4. **Tarefas:** a tarefa herda a visibilidade do contexto; responsável com contexto privado só pode ser OWNER.
5. **Exportação:** só OWNER (a matriz e o fluxo 26 dizem exclusivamente OWNER). Contatos protegidos entram, marcados
   como protegidos; arquivados também. Oportunidades **sem** renda familiar, valor aprovado, notas financeiras,
   descrição e comissões. Mensagens, notas e anexos **não** são exportados nesta versão.

## Pendências e limitações

- Notificações (fluxos 19/23 mencionam) não existem no produto.
- Suspensão não marca atribuições para revisão (fluxo 22, item 5).
- Evento de auditoria para "resposta enviada pelo CRM" (decisão de produto).
- Exportações de conversas, anexos e relatórios (fluxo 26 cita) não implementadas.
- Tarefas: sem lembretes ativos (o campo `reminder_at` é guardado, mas nada dispara aviso ainda).
- A tela de tarefas lista até 200 itens (sem paginação).
- Atribuição de conversa não gera notificação ao responsável.

## Migrations ainda NÃO aplicadas em produção — ordem sugerida

Já estão em produção: até `20260802004200`. Pendentes (aplicar nesta ordem, juntas):

1. `20260802004300_remove_team_member.sql`
2. `20260802004400_conversation_assignments.sql`
3. `20260802004500_audit_trail.sql`
4. `20260802004600_work_tasks.sql`
5. `20260802004700_export_dataset.sql`
6. `20260802004800_kanban_responsible_name.sql`

Todas são `create or replace` de funções/novas funções + permissões (nenhuma altera tabela nem apaga dados).
Procedimento de sempre: backup (esquema e dados), `migration list --linked`, `db push --linked --dry-run`,
`db push --linked`, validação somente leitura (migration list; funções e permissões: `anon` sem acesso e
`authenticated` com), apagar o backup. O código do app desta branch **depende** dessas funções: aplique as
migrations antes (ou junto) de publicar o app, senão telas novas (Tarefas, Auditoria, Exportação, responsáveis) darão erro.

## Como reproduzir

- Banco de teste: Supabase local novo (`supabase start` com outro `project_id`/portas) com as migrations do repo;
  `supabase test db --local`. Em banco já usado por E2E, recrie o ambiente (ou use um novo) antes do pgTAP.
- App: `npm ci && npm run lint && npm run typecheck && npm run test:unit && npm run build`.
- Revisão: `git log main..feat/mvp-noite` e `git diff main..feat/mvp-noite`.
