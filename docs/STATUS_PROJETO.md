# Status do Projeto — ImobFlux

- **Projeto**: ImobFlux (CRM Imobiliário B2B / SaaS)
- **Objetivo**: Sistema de gestão comercial e relacionamento para corretores imobiliários e imobiliárias.
- **Versão**: `0.1.0`
- **Sprint Atual**: Sprint 24 — Refinamento de UX e consolidação funcional (implementação concluída; validação automatizada final pendente)
- **Última Atualização**: 2026-10-03

---

## Estado Atual

### Funcionalidades Concluídas
- **Autenticação & Sessão SSR**: Login e logout com gerenciamento de sessão SSR proxy via cookies HTTP-only (Supabase Auth).
- **Bootstrap Controlado**: Inicialização do primeiro usuário `OWNER` e seu `workspace` com validação de token efêmero de alta entropia (`IMOBFLUX_BOOTSTRAP_TOKEN`).
- **Segurança & RLS**: RLS habilitada e forcida nas 19 tabelas de domínio; leitura e escrita restritas ao contexto autenticado do `OWNER` via `private.active_owner_context()`.
- **Módulo de Contatos (100% Real)**: Operações de criação, edição, inativação, reativação, arquivamento e restauração executadas exclusivamente via 5 RPCs `SECURITY DEFINER` auditadas.
- **Módulo de Prioridades (100% Real)**: Dashboard de Prioridades alimentado por consulta real (`get_prioridades_dashboard()`).
- **Módulo de Conversas & Integração WhatsApp Textual (100% Real)**: Leitura de mensagens, envio textual atômico via Server Action `sendMessageAction`, RPC `queue_outgoing_text_message`, gateway com reconciliação idempotente e ingestão via webhook Evolution API (`ingest_whatsapp_text_message`).
- **Kanban Comercial Real & Fundação da Sprint 21 (100% Real)**:
  - 6 etapas oficiais do Kanban provisionadas automaticamente (`Em atendimento`, `Simulação / Análise`, `Documentação`, `Aprovado / Escolhendo imóvel`, `Negociação`, `Contrato`).
  - Fotografia comercial/financeira completa de cada oportunidade (`operation_type`, `property_type_preference`, `city_region_preference`, `value_range_preference`, `down_payment_available`, `timeframe_intent`, `preferences_notes`, `family_income`, `financial_analysis_status`, `approved_amount`, `financial_notes`, `documentation_status`, `origin`, `property_summary`).
  - Tabela isolada `opportunity_financials` para valores financeiros privados (`business_value`, `commission_expected`, `commission_received`) protegida com RLS estrita restrita ao papel `OWNER`.
  - RPCs de transição e encerramento: `set_opportunity_rework` (status `'rework'` com data e motivo de reavaliação, removendo do Kanban ativo), `reactivate_opportunity` (reativação humana), `close_opportunity_won`, `close_opportunity_lost` (exigindo motivo), `close_opportunity_cancelled`.
- **Sprint 24 — refinamento consolidado**:
  - Contatos possui menu contextual em viewport, feedback visível de ciclo de vida, abertura/início seguro de conversas e tratamento de múltiplos telefones.
  - Conversas resolve identidade individual por nome CRM, identidade externa e telefone, nessa ordem, inclusive no fallback de conversas arquivadas.
  - Kanban possui menu fora do contexto de clipping, card acessível sem controles aninhados e reordenação persistente dentro e entre etapas.
  - A ordem usa `opportunities.sort_order`; `reorder_opportunity` mantém atomicidade e auditoria.
  - Cards apenas renumerados preservam `updated_at`; o card efetivamente movimentado pode atualizar seu timestamp.

---

## Banco de Dados

- **Quantidade de Migrations**: migrations 1–32, todas forward-only; as migrations 30, 31 e 32 tratam da ordenação persistente do Kanban e da semântica de `updated_at`.
- **Quantidade de Tabelas**: 18 tabelas de domínio no schema `public`.
- **Row Level Security (RLS)**: permanece habilitada e forçada nas tabelas de domínio.
- **Suíte SQL pgTAP**: não reexecutada nesta consolidação para preservar o banco local validado manualmente.

---

## Frontend & Testes (Status de Validação)

- **Build Next.js**: `npm run build` → **PASS** (Zero erros de compilação ou de tipagem TypeScript).
- **ESLint**: `npm run lint` → **PASS** (0 erros, 0 warnings).
- **Playwright Test Suite**: não reexecutada nesta consolidação; o `globalSetup` atual executa `db reset` e exige ambiente descartável.
- **Validação manual Sprint 24**: Contatos, Conversas, Prioridades e Kanban validados nos fluxos funcionais e responsivos previstos.

---

## Documentos Principais (Single Source of Truth)

- [STATUS_PROJETO.md](file:///C:/Users/User/Desktop/PROJETOS/CRM%20Corretor/docs/STATUS_PROJETO.md): Este documento (Estado atual da aplicação).
- [ROADMAP.md](file:///C:/Users/User/Desktop/PROJETOS/CRM%20Corretor/docs/ROADMAP.md): Planejamento e fases futuras.
- [HANDOFF.md](file:///C:/Users/User/Desktop/PROJETOS/CRM%20Corretor/HANDOFF.md): Guia de transição operacional rápida.
- [DOCUMENTATION_POLICY.md](file:///C:/Users/User/Desktop/PROJETOS/CRM%20Corretor/docs/DOCUMENTATION_POLICY.md): Política permanente de documentação.
- [DECISOES.md](file:///C:/Users/User/Desktop/PROJETOS/CRM%20Corretor/docs/DECISOES.md): Registro histórico de decisões arquiteturais.
- [docs/sprints/](file:///C:/Users/User/Desktop/PROJETOS/CRM%20Corretor/docs/sprints/): Relatórios permanentes imutáveis de cada sprint (`SPRINT_17.md`, `SPRINT_18.md`).
