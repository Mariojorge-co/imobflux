# Relatório da noite — branch `feat/mvp-noite`

Trabalho autônomo sobre os itens pendentes do MVP. Regras seguidas: tudo em commits **locais** na branch
`feat/mvp-noite` (sem push, sem tocar na `main`, sem deploy); migrations aplicadas **somente** em um Supabase
local novo e isolado (`imobflux-night-0001`, portas 573xx), sem `db reset` e sem tocar na produção.

> Atualizado ao fim de cada item. Se este relatório estiver incompleto, o trabalho parou por limite de uso:
> o que consta como "feito" está commitado e testado.

## Estado por item

| # | Item | Estado |
|---|---|---|
| 1 | Remoção de funcionário | Feito e commitado |
| 2 | Atribuição de conversa | Feito e commitado |
| 3 | Auditoria (registro + tela) | Feito e commitado |
| 4 | Tarefas | Pendente |
| 5 | Exportação CSV | Pendente |

## Item 1 — Remoção de funcionário (fluxo 23)

**Migration:** `20260802004300_remove_team_member.sql` — função `public.remove_team_member(uuid)`.

**Comportamento**
- Só OWNER; alvo precisa ser ATTENDANT em `invited`, `active` ou `suspended` do mesmo workspace. Convite
  pendente removido = convite cancelado.
- Vínculo vira `removed` (com `removed_at`). O acesso cai imediatamente porque `private.active_member_context()`
  só considera vínculos `active`. Reativar um removido é impossível (`team_member_not_reactivatable`); voltar
  exige novo convite (cria vínculo novo).
- Libera o trabalho sem apagar nada e sem transferir para outra pessoa: atribuições de conversa abertas são
  encerradas (`end_reason='member_removed'`); oportunidades `open`/`rework` não arquivadas ficam sem
  responsável; tarefas `pending` ficam sem responsável (continuam pendentes, autor preservado).
- Auditoria: `team.member_removed` (com contagens) e `opportunity.responsible_cleared` por oportunidade.

**App:** ação `removeMemberAction`; botões "Remover funcionário" / "Cancelar convite" (com confirmação) na tela
de equipe.

**Testes:** pgTAP `team_member_removal.test.sql` (29), unitário `team-actions.unit.spec.ts` (5).

**Decisões**
- Oportunidades já encerradas (ganha/perdida/cancelada) mantêm o responsável: é histórico, não trabalho aberto.
- Não revogo as sessões do Auth por usuário (a API não permite por id sem o JWT): o efeito prático é o mesmo,
  pois sem vínculo ativo todas as consultas e ações são negadas na hora.
- A suspensão (fluxo 22) não foi alterada; "marcar atribuições para revisão" ao suspender fica como pendência.
- Notificações pendentes: o sistema ainda não tem notificações, então não há o que cancelar.

## Item 2 — Atribuição de conversa (fluxos 18 e 19)

**Migration:** `20260802004400_conversation_assignments.sql`.

- `assign_conversation`, `unassign_conversation`, `reassign_conversation` (SECURITY DEFINER, `search_path=''`): qualquer
  membro com acesso comercial à conversa atribui, troca e remove; mais de um responsável por conversa; histórico
  preservado (atribuições encerradas ficam com autor e motivo).
- Regras de segurança: responsável precisa ser membro **ativo** do mesmo workspace; conversa privada (contato
  protegido) ou grupo não liberado só pode ser atribuída a **OWNER** (atribuir a ATTENDANT entregaria trabalho que ele
  não vê); atribuir não altera visibilidade. Auditoria `conversation.assigned` / `conversation.unassigned` (só ids).
- Leitura: `get_conversation_assignees` e `get_member_directory` (definer; o ATTENDANT não lê a tabela de membros pela
  RLS, então só nomes do próprio workspace são expostos); `get_conversations_inbox` ganhou responsáveis,
  `assigned_to_me`, visão `mine` e contador.
- App: barra de responsáveis na conversa (atribuir, trocar, remover), chip **Minhas** e nomes na lista.
- Testes: pgTAP `conversation_assignment.test.sql` (36), unitário `assignment.unit.spec.ts` (9).

**Decisões:** o ATTENDANT pode atribuir/trocar/remover qualquer responsável de conversa que ele enxerga (a matriz diz
"CONDICIONAL ao acesso"); atribuição a um suspenso é recusada; ao suspender (fluxo 22) as atribuições permanecem
(a marcação "para revisão" não foi implementada).

## Item 3 — Auditoria (fluxo 25)

**Migration:** `20260802004500_audit_trail.sql`.

- A tabela já era append-only (triggers) e legível só pelo OWNER. Faltavam eventos: agora
  `link_opportunity_conversation` (`opportunity.conversation_linked`) e `update_contact_opportunity_qualification`
  (`opportunity|contact.qualification_updated`, só nomes de campos) auditam. Já auditavam: remoção/desativação de
  membro, atribuição, mudança de etapa, reordenação, arquivamentos, encerramentos, privacidade, WhatsApp.
- `get_audit_events` (definer, só OWNER): filtros por categoria/pessoa/período, cursor, nome do autor.
- Tela `/configuracoes/auditoria` (OWNER) com filtros, rótulos em português, ids de membro traduzidos para nomes,
  links para conversa/oportunidade, paginação. Card em Configurações.
- Testes: pgTAP `audit_trail.test.sql` (28), unitário `audit.unit.spec.ts` (13).

**Decisões**
- "Exclusões": o sistema não tem exclusão física (arquivamento/inativação, já auditados), então não há evento de
  exclusão a criar.
- Resposta enviada pelo CRM (citada no fluxo 25) **não** gera evento: seria um evento por mensagem, duplicando a
  tabela de mensagens. Fica como decisão de produto pendente.
- Metadados nunca guardam texto digitado; a tela só exibe campos conhecidos.

(demais itens: ver abaixo, preenchidos conforme concluídos)
