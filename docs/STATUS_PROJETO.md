# Status do Projeto — ImobFlux

- **Projeto**: ImobFlux (CRM Imobiliário B2B / SaaS)
- **Objetivo**: Sistema de gestão comercial e relacionamento para corretores imobiliários e imobiliárias.
- **Versão**: `0.1.0`
- **Sprint Atual**: Sprint 18 — Kanban Comercial Funcional (Concluído)
- **Última Atualização**: 2026-08-04

---

## Estado Atual

### Funcionalidades Concluídas
- **Autenticação & Sessão SSR**: Login e logout com gerenciamento de sessão SSR proxy via cookies HTTP-only (Supabase Auth).
- **Bootstrap Controlado**: Inicialização do primeiro usuário `OWNER` e seu `workspace` com validação de token efêmero de alta entropia (`IMOBFLUX_BOOTSTRAP_TOKEN`).
- **Segurança & RLS**: RLS habilitada e forçada em 18/18 tabelas de domínio; leitura e escrita restritas ao contexto autenticado do `OWNER` via `private.active_owner_context()`.
- **Módulo de Contatos (100% Real)**: Operações de criação, edição, inativação, reativação, arquivamento e restauração executadas exclusivamente via 5 RPCs `SECURITY DEFINER` auditadas.
- **Módulo de Prioridades (100% Real)**: Dashboard de Prioridades alimentado por consulta real (`get_prioridades_dashboard()`), avaliando 4 pendências comerciais objetivas.
- **Módulo de Conversas & Integração WhatsApp Textual (100% Real)**: Leitura de mensagens via `get_conversations_list`, envio textual atômico via Server Action `sendMessageAction`, RPC `queue_outgoing_text_message`, gateway com reconciliação idempotente (`reconcile_outgoing_text_message`), e ingestão via webhook Evolution API (`ingest_whatsapp_text_message`).
- **Módulo de Kanban Comercial Real (100% Real)**: Leitura em lote via RPC `get_kanban_board` (sem N+1), movimentação de etapas com Optimistic UI e trava transacional de concorrência (`move_opportunity_stage`), criação de oportunidades (`create_opportunity`), registro de histórico em `pipeline_history` e auditoria em `audit_events`.

### Funcionalidades em Desenvolvimento
- Nenhuma funcionalidade de código em desenvolvimento no momento (Sprints 17 e 18 concluídas e validadas).

---

## Banco de Dados

- **Quantidade de Migrations**: 15 migrations consolidadas
- **Última Migration**: `20260802001500_add_kanban_operations_rpcs.sql`
- **Quantidade de Tabelas**: 18 tabelas de domínio no schema `public`
- **RPCs Ativas**: 14 RPCs registradas no schema PostgreSQL (`bootstrap_initial_workspace`, `create_contact`, `update_contact`, `set_contact_operational_status`, `inactivate_contact`, `archive_contact`, `restore_contact`, `get_prioridades_dashboard`, `get_conversations_list`, `queue_outgoing_text_message`, `reconcile_outgoing_text_message`, `ingest_whatsapp_text_message`, `get_kanban_board`, `move_opportunity_stage`, `create_opportunity`).
- **Row Level Security (RLS)**: Habilitada e forçada em 18/18 tabelas de domínio.
- **Suíte SQL pgTAP**: 291 asserções pgTAP aprovadas (7 arquivos de suíte executados em container PostgreSQL local).

---

## Frontend & Testes (Status de Validação)

- **Build Next.js**: `npm run build` → **PASS** (Zero erros de compilação ou de tipagem TypeScript).
- **ESLint**: `npm run lint` → **PASS** (0 erros, 0 warnings).
- **pgTAP SQL**: `supabase test db --local` → **PASS** (291 asserções aprovadas em 7 arquivos).
- **Playwright Test Suite**: `npx playwright test` → **PASS** (70 testes unitários e E2E 100% aprovados).

---

## Limitações Atuais

1. **WhatsApp Textual**: Implementado tecnicamente no backend, gateway e webhook, mas a conexão real com a Evolution API e geração de QR Code ainda estão pendentes de configuração de ambiente.
2. **Supabase Realtime**: Atualização de mensagens e cards Kanban depende de re-fetch / `router.refresh()`; subscrição via Supabase Realtime não implementada nesta etapa.
3. **Mídias e Anexos**: Suporte restrito a mensagens de texto puro (máx. 4096 caracteres); mídias, imagens e documentos não integrados.
4. **Limite por Etapa do Kanban**: Retorno limitado a 50 oportunidades abertas por coluna, sinalizado na interface pelo indicador `has_more`.
5. **Ações Adicionadas do Kanban**: Marcar oportunidade como Won/Lost e reordenação manual dentro da mesma coluna adiadas para etapa futura.
6. **Tema Visual / Dark Mode**: Dark mode ainda precisa ser inspecionado.
7. **Canais Adicionais**: Instagram Direct é uma possibilidade futura, não sendo um compromisso do roadmap imediato.

---

## Documentos Principais (Single Source of Truth)

- [STATUS_PROJETO.md](file:///C:/Users/User/Desktop/PROJETOS/CRM%20Corretor/docs/STATUS_PROJETO.md): Este documento (Estado atual da aplicação).
- [ROADMAP.md](file:///C:/Users/User/Desktop/PROJETOS/CRM%20Corretor/docs/ROADMAP.md): Planejamento e fases futuras.
- [HANDOFF.md](file:///C:/Users/User/Desktop/PROJETOS/CRM%20Corretor/HANDOFF.md): Guia de transição operacional rápida.
- [DOCUMENTATION_POLICY.md](file:///C:/Users/User/Desktop/PROJETOS/CRM%20Corretor/docs/DOCUMENTATION_POLICY.md): Política permanente de documentação.
- [DECISOES.md](file:///C:/Users/User/Desktop/PROJETOS/CRM%20Corretor/docs/DECISOES.md): Registro histórico de decisões arquiteturais.
- [docs/sprints/](file:///C:/Users/User/Desktop/PROJETOS/CRM%20Corretor/docs/sprints/): Relatórios permanentes imutáveis de cada sprint (`SPRINT_17.md`, `SPRINT_18.md`).
