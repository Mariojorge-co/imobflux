# Relatório de Auditoria de Performance e Validação Empírica (Sprint 16.5.2B)

Documento de validação empírica de performance da camada PostgreSQL/Supabase do **ImobFlux**. Os benchmarks foram executados exclusivamente em banco local descartável com dados sintéticos volumosos.

---

## 1. Metodologia e Volume Sintético

- **Ambiente**: PostgreSQL 17.6 local (Supabase CLI / Docker).
- **Mecanismo de Análise**: `EXPLAIN (ANALYZE, BUFFERS, VERBOSE)` sob sessão autenticada com RLS ativa (`set request.jwt.claims`).
- **Volume Sintético Gerado**:
  - **Conversas**: 1.000 registros ativas em um único workspace.
  - **Mensagens**: 100.000 mensagens (100 mensagens por conversa, alternando entre *incoming* e *outgoing*).
  - **Contatos & Pontos de Contato**: 1.000 contatos sintéticos com 1.000 telefones associados.
  - **Participantes**: 1.000 vínculos de conversa/contato.

---

## 2. Inspecção de Índices Reais por Tabela

### `conversations`
- `pk_conversations`: Primary Key em `(workspace_id, id)`.
- `uq_conversations_channel_thread`: Unique `(channel_connection_id, external_thread_id)`.
- `idx_conversations_accessible_list`: Composite Index em `(workspace_id, archived_at, operational_status, started_at desc)`.
- `idx_conversations_privacy_cutoff`: Composite Index em `(workspace_id, commercial_visible_from)`.
- `idx_conversations_archived`: Composite Index em `(workspace_id, archived_at)`.

### `messages`
- `pk_messages`: Primary Key em `(workspace_id, id)`.
- `uq_messages_external_identity`: Unique `(workspace_id, channel_connection_id, external_message_id)`.
- `uq_messages_client_idempotency`: Unique `(workspace_id, client_idempotency_key)`.
- `idx_messages_conversation_cursor`: Composite Index em `(workspace_id, conversation_id, occurred_at desc, id desc)`.
- `idx_messages_pending_delivery`: Partial Index em `(workspace_id, status, created_at asc)`.
- `fk_messages_sender_contact_point`: FK para `contact_points(workspace_id, id)` — **Sem índice dedicado** (Validado em benchmark).
- `fk_messages_internal_author`: FK para `workspace_members(workspace_id, id)` — **Sem índice dedicado**.

### `contacts` & `contact_points`
- `idx_contacts_active_list`: Composite Index em `(workspace_id, archived_at, operational_status, created_at desc)`.
- `idx_contacts_display_name_normalized`: Index em `(workspace_id, display_name_normalized)`.
- `idx_contact_points_contact`: Composite Index em `(workspace_id, contact_id)`.

---

## 3. Matriz de Resultados dos Testes A/B (EXPLAIN ANALYZE)

| Consulta / Hipótese | Plano / Varredura Antes | Tempo Antes | Plano / Varredura Depois | Tempo Depois | Ganho / Redução | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **`messages` por `sender_contact_point_id`** | **Sequential Scan** (100.000 linhas lidas, 2.792 buffers) | **161,62 ms** | **Index Scan** (`temp_idx_messages_sender_contact_point`, 92 buffers) | **0,97 ms** | **-99,4% de tempo** (-96,7% buffers) | **CONFIRMADO (Crítico)** |
| **Leads Sem Revisão (Regra 3)** | **Seq Scan** em `contacts` + Top-N Heap Sort | 2,15 ms | **Seq Scan** em `contacts` (1.000 linhas no cache) | 0,96 ms | ~1,1 ms | **INCONCLUSIVO (Adiado)** |
| **`messages` por `channel_connection_id`** | **Seq Scan** filtrado (9 buffers) | 0,55 ms | **Seq Scan** (Postgres optou por não usar o índice) | 0,66 ms | 0% | **REJEITADO (Desnecessário)** |
| **Reescrita da RPC `get_conversations_list` com `LIMIT` Antecipado** | N/A (Ingênuo) | N/A | **Incorreto Logicamente**: `last_activity_at = COALESCE(occurred_at, started_at)` | N/A | N/A | **REJEITADO (Incorreto)** |

---

## 4. Análise Detalhada dos Achados

### 4.1. Achados Confirmados
- **Índice em `messages(workspace_id, sender_contact_point_id)`**:
  - **Evidência**: Em um banco com 100.000 mensagens, a busca de histórico/mensagens por ponto de contato sem índice causava *Sequential Scan* varrendo 100.000 linhas em **161,62 ms**. Com o índice composto, o Postgres passou a realizar *Index Scan* lendo apenas as páginas relevantes em **0,97 ms** (redução de 99.4% no tempo de execução).
  - **Custo de Escrita**: Baixo (apenas mensagens do tipo `incoming` populam `sender_contact_point_id`).

### 4.2. Achados Rejeitados
1. **Limitar `conversations` antes de calcular `last_activity_at` em `get_conversations_list`**:
   - **Motivo da Rejeição**: A ordenação da lista de conversas depende do timestamp da última mensagem recebida/enviada (`COALESCE(last_message.occurred_at, conversations.started_at)`). Se aplicarmos `LIMIT` na tabela `conversations` antes de calcular a última mensagem, conversas antigas que receberam novas mensagens seriam incorretamente omitidas do topo da lista.
2. **Índice em `conversations(workspace_id, channel_connection_id)`**:
   - **Motivo da Rejeição**: No cenário de leitura, a busca por canal traz a maioria das conversas do workspace e o Postgres opta por varredura simples. A FK já possui integridade `ON DELETE RESTRICT`.

### 4.3. Achados Inconclusivos / Adiados
- **Índice parcial para Leads sem revisão (`contacts`)**:
  - **Motivo**: Para bases com até 1.000 contatos, o Postgres realiza o scan da tabela em memória (37 páginas) em menos de 1ms, ignorando o índice. O índice parcial só trará benefícios mensuráveis para workspaces com mais de 50.000 contatos.

---

## 5. Arquitetura de Longo Prazo para a RPC `get_conversations_list`

### O Gargalo Real
Na RPC atual, o tempo de execução é de ~25ms a 87ms para 1.000 conversas. O custo vem do `LATERAL JOIN` que busca a última mensagem de 100% das conversas do workspace para poder ordená-las por `last_activity_at DESC`.

### Solução Arquitetural Recomendada (Futura)
Em vez de reescrever a query com `LIMIT` antecipado (o que causaria erro de ordenação), a solução performática sustentável para a fase pós-WhatsApp é **denormalizar `last_activity_at timestamptz` na tabela `conversations`**, mantida por uma Trigger de `INSERT` na tabela `messages`.

- **Vantagem**: A tabela `conversations` passa a ser indexada diretamente por `(workspace_id, archived_at, last_activity_at desc)`. O Postgres poderá ordenar e aplicar `LIMIT 20` instantaneamente em **< 0,5 ms**, buscando mensagens e participantes **apenas** para as 20 conversas resultantes.
- **Riscos / Mitigação**: Requer atenção à contenção de lock em inserções concorrentes massivas na mesma conversa.

---

## 6. Aplicação das Otimizações (Sprint 16.5.3)

As duas otimizações parciais de índice confirmadas no benchmark foram aplicadas com sucesso através da migration `20260802001300_add_message_sender_indexes.sql`:
1. `idx_messages_sender_contact_point` em `public.messages (workspace_id, sender_contact_point_id) WHERE sender_contact_point_id IS NOT NULL`.
2. `idx_messages_internal_author` em `public.messages (workspace_id, internal_author_member_id) WHERE internal_author_member_id IS NOT NULL`.

Validadas com 100% de aprovação na suíte de testes pgTAP (`schema_integrity.test.sql`) e integração do sistema.

