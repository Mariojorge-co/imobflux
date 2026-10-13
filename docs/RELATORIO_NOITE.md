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
| 2 | Atribuição de conversa | Pendente |
| 3 | Auditoria (registro + tela) | Pendente |
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

(demais itens: ver abaixo, preenchidos conforme concluídos)
