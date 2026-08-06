# Relatório da Sprint 18 — Módulo de Kanban Comercial Real

- **Sprint**: Sprint 18
- **Objetivo**: Implementar o Kanban Comercial funcional conectando a interface às tabelas relacionais existentes (`pipeline_stages`, `opportunities`, `pipeline_history`, `audit_events`, `contacts`, `workspace_members`).
- **Data de Conclusão**: 2026-08-04
- **Status**: `CONCLUÍDO`

---

## Escopo Executado

1. **RPCs de Banco de Dados (`20260802001500_add_kanban_operations_rpcs.sql`)**:
   - `get_kanban_board(p_limit_per_stage int DEFAULT 50)`: Leitura em lote de todas as etapas ativas ordenadas por `position ASC`, retornando até 50 oportunidades por coluna ordenadas por `updated_at DESC, id DESC`, com `total_count` e `has_more` por coluna sem N+1.
   - `move_opportunity_stage`: Movimentação transacional (`FOR UPDATE`, `SECURITY DEFINER`) com verificação de concorrência. Se `p_expected_current_stage_id` for diferente do estado do banco, retorna `status = 'conflict'` sem alterar dados, acionar histórico ou auditoria. Se a etapa de destino for a mesma, retorna `status = 'no_change'`.
   - `create_opportunity`: Criação de oportunidade aberta (`SECURITY DEFINER`), registrando histórico inicial (`previous_stage_id = null`) e auditoria.

2. **Camada de Dados & Server Actions (`lib/kanban/data.ts` e `lib/kanban/actions.ts`)**:
   - `getKanbanBoardData`: Consome a RPC `get_kanban_board` no servidor.
   - `moveOpportunityAction`: Executa a RPC de movimentação e chama `revalidatePath('/kanban')`. Em caso de conflito (`status = 'conflict'`), retorna `{ success: false, code: 'CONFLICT' }`.
   - `createOpportunityAction`: Valida dados de entrada e executa a criação com `revalidatePath('/kanban')`.

3. **Interface & Optimistic UI (`components/kanban/...` e `app/(app)/kanban/page.tsx`)**:
   - `KanbanBoard`: Gerencia a movimentação otimista de cards. Em caso de retorno `CONFLICT`, desfaz a atualização otimista na UI, dispara `router.refresh()` e exibe aviso ao usuário.
   - `KanbanColumn`: Renderiza as colunas com áreas de drop HTML5, contadores de cards e indicação `50+` (`has_more`).
   - `KanbanCard`: Card acessível com suporte a Drag-and-Drop e opção alternativa via menu/select para mobile e navegação via teclado.
   - `CreateOpportunityDialog`: Modal acessível para criação rápida de oportunidades.

---

## Arquivos Criados / Alterados

- `supabase/migrations/20260802001500_add_kanban_operations_rpcs.sql` [NEW]
- `types/kanban.ts` [NEW]
- `lib/kanban/data.ts` [NEW]
- `lib/kanban/actions.ts` [NEW]
- `components/kanban/kanban-card.tsx` [NEW]
- `components/kanban/kanban-column.tsx` [NEW]
- `components/kanban/create-opportunity-dialog.tsx` [NEW]
- `components/kanban/kanban-board.tsx` [NEW]
- `app/(app)/kanban/page.tsx` [MODIFY]
- `supabase/tests/database/kanban_operations.test.sql` [NEW]
- `supabase/tests/database/auth_bootstrap.test.sql` [MODIFY]
- `supabase/tests/database/contact_operations.test.sql` [MODIFY]
- `supabase/tests/database/owner_rls.test.sql` [MODIFY]
- `tests/kanban-actions.unit.spec.ts` [NEW]
- `tests/kanban-board.unit.spec.ts` [NEW]
- `types/database.ts` [MODIFY]

---

## Testes & Validações

- **pgTAP SQL**: `kanban_operations.test.sql` com 18 asserções pgTAP aprovadas (totalizando 291 asserções na suíte geral do banco).
- **Playwright Unit & E2E**: 10 testes específicos do Kanban aprovados (totalizando 70 testes na suíte do Playwright).
- **Lint & Build**: `npm run lint` → **0 erros**, `npm run build` → **compilação limpa sem erros TypeScript**.

---

## Limitações

- Leitura limitada a 50 oportunidades por coluna, com indicador `has_more`.
-Won/Lost e reordenação manual dentro da mesma coluna adiados para futuras iterações.
- Atualização em tempo real via Supabase Realtime ainda não aplicada.

---

## Resultado & Próxima Etapa

A Sprint 18 foi concluída com 100% de aprovação. A próxima etapa recomendada é configurar a conexão real com a Evolution API e escaneamento de QR Code.
