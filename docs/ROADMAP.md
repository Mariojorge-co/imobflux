# Roadmap do Projeto — ImobFlux

Documento de planejamento das próximas sprints e evolução do sistema **ImobFlux**. Representa exclusivamente a sequência de desenvolvimento planejada e confirmada.

---

## Sprints Concluídas

- **Sprint 15 — Conectar Prioridades ao Banco Real** (Status: `CONCLUÍDO`)
- **Sprint 15.1 — Refinamento de UX de Contatos** (Status: `CONCLUÍDO`)
- **Sprint 16 — Módulo Interno de Conversas (Base Funcional)** (Status: `CONCLUÍDO`)
- **Sprint 17 — Integração WhatsApp Textual (RPCs, Gateway, Action & Webhook)** (Status: `CONCLUÍDO`)
  - Fluxo atômico de envio e ingestão textual via Evolution API, idempotência, reconciliação e formulário de envio.
- **Sprint 18 — Módulo de Kanban Comercial Real** (Status: `CONCLUÍDO`)
  - Leitura em lote via RPC `get_kanban_board`, movimentação otimista com controle de concorrência (`move_opportunity_stage`), criação de oportunidades (`create_opportunity`) e auditoria.

---

## Planejamento das Próximas Sprints

### Próximas Prioridades de Desenvolvimento

1. **Configuração de Conexão Evolution API Real e QR Code**
   - **Objetivo**: Configurar instância real na Evolution API, gerando e escaneando o QR Code para conectar a conta de WhatsApp da imobiliária à tabela `channel_connections`.
   - **Prioridade**: ALTA

2. **Validação de Envio e Recebimento com Número Real**
   - **Objetivo**: Testar o ciclo completo de envio e recebimento de mensagens de texto com um aparelho/número de WhatsApp real conectado à Evolution API.
   - **Prioridade**: ALTA

3. **Supabase Realtime para Conversas e Kanban**
   - **Objetivo**: Implementar subscrições em tempo real via Supabase Realtime no cliente de Conversas e Kanban para atualização instantânea da interface sem depender de refresh manual.
   - **Prioridade**: MÉDIA

4. **Polimento Necessário para Uso Diário**
   - **Objetivo**: Refinar a experiência do usuário, cobrindo inspeção de Dark Mode, tratamento de estados de erro de rede e pequenos ajustes visuais.
   - **Prioridade**: MÉDIA

5. **Auditoria Geral do MVP**
   - **Objetivo**: Conduzir uma auditoria completa de segurança, RLS, performance e UX para validação final da primeira versão comercializável.
   - **Prioridade**: MÉDIA

---

## Propostas Futuras (Fora do Escopo Imediato)

> [!NOTE]
> Os itens abaixo representam possibilidades de expansão e não constituem compromissos do roadmap atual.

- **Suporte a Mídias e Anexos no WhatsApp**: Envio e recepção de fotos, áudios e documentos.
- **Ações de Won/Lost e Reordenação no Kanban**: Marcação de oportunidades como ganhas/perdidas e ordenação manual customizada dentro da mesma coluna.
- **Instagram Direct Integration**: Integração futura com a API do Instagram Direct.
