# HANDOFF Técnico Completo e Atualizado — ImobFlux

Documento de transição técnica referente ao estado atual da aplicação **ImobFlux** após a conclusão da Sprint 24.

> [!IMPORTANT]
> **Fonte Oficial da Documentação (Single Source of Truth)**
> Este documento destina-se à continuidade operacional e onboarding rápido. A documentação técnica oficial e atualizada compõe-se por:
> - **[docs/STATUS_PROJETO.md](file:///C:/Users/User/Desktop/PROJETOS/CRM%20Corretor/docs/STATUS_PROJETO.md)**: Estado atual consolidado da aplicação.
> - **[docs/ROADMAP.md](file:///C:/Users/User/Desktop/PROJETOS/CRM%20Corretor/docs/ROADMAP.md)**: Planejamento futuro por sprint.
> - **[docs/ARQUITETURA.md](file:///C:/Users/User/Desktop/PROJETOS/CRM%20Corretor/docs/ARQUITETURA.md)**: Diretrizes arquiteturais e padrões do sistema.
> - **[docs/DOCUMENTATION_POLICY.md](file:///C:/Users/User/Desktop/PROJETOS/CRM%20Corretor/docs/DOCUMENTATION_POLICY.md)**: Política permanente de documentação.
> - **[docs/sprints/](file:///C:/Users/User/Desktop/PROJETOS/CRM%20Corretor/docs/sprints/)**: Relatórios imutáveis do histórico por sprint (`SPRINT_17.md`, `SPRINT_18.md`).

---

## 1. Resumo Executivo e Estado Atual

O **ImobFlux** é um CRM imobiliário voltado para corretores e imobiliárias (SaaS B2B).

**Estado de Validação**:
- **Migrations SQL**: migrations 30, 31 e 32 aplicadas localmente sem `db reset`.
- **Validação manual Sprint 24**: Contatos, Conversas, Prioridades e Kanban aprovados nos fluxos previstos.
- **Qualidade de Código**: `npm.cmd run lint` e `npm.cmd run build` aprovados; `git diff --check` aprovado.
- **pgTAP e Playwright**: não reexecutados nesta retomada; o global setup atual reseta o banco local.

**Módulos Funcionais Operacionais**:
1. **Autenticação & Sessão SSR**: Login/logout com cookies HTTP-only e proxy de autorização.
2. **Bootstrap Controlado**: Inicialização segura do 1º OWNER via token de alta entropia.
3. **Contatos (100% Real)**: CRUD atômico controlado por 5 RPCs `SECURITY DEFINER` auditadas.
4. **Prioridades (100% Real)**: Dashboard comercial calculado por RPC real (`get_prioridades_dashboard`).
5. **Conversas & WhatsApp Textual (100% Real)**: Leitura de mensagens, envio via `sendMessageAction`, RPC `queue_outgoing_text_message`, gateway com reconciliação idempotente e webhook Evolution API (`ingest_whatsapp_text_message`).
6. **Kanban Comercial (100% Real)**: Leitura em lote via RPC `get_kanban_board`, criação/movimentação auditada e reordenação persistente por `sort_order` via `reorder_opportunity`.

---

## 2. Limitações Atuais do Sistema

- **WhatsApp Textual**: Implementado tecnicamente, mas a conexão real com a Evolution API e geração de QR Code pendentes de configuração de ambiente.
- **Supabase Realtime**: Atualização de telas via re-fetch ou `router.refresh()`; realtime não habilitado.
- **Mídias e Anexos**: Suporte restrito a texto puro (máx. 4096 caracteres).
- **Kanban**: Retorno limitado a 50 oportunidades abertas por etapa, com o indicador `has_more`.
- **Kanban**: retorno limitado a 50 oportunidades abertas por etapa, com indicador `has_more`; reordenação entre e dentro de etapas está implementada.
- **Dark Mode**: Precisa ser inspecionado nas próximas etapas de polimento de UI.
- **Instagram Direct**: Possibilidade futura, fora do escopo do roadmap atual.

---

## 3. Comandos Principais de Execução e Teste

```powershell
# 1. Aplicar somente migrations pendentes, sem destruir o banco manual validado
$env:PATH = "C:\Users\User\AppData\Local\Programs\DockerDesktop\resources\bin;" + $env:PATH
npx.cmd --yes supabase@2.111.0 migration up --local

# 2. Executar pgTAP somente em banco descartável/isolado
npx.cmd --yes supabase@2.111.0 test db --local

# 3. Regenerar tipos TypeScript derivados do banco em UTF-8
$raw = & npx.cmd --yes supabase@2.111.0 gen types typescript --local
$content = $raw -join "`n"
[System.IO.File]::WriteAllText((Resolve-Path "types\database.ts").Path, $content + "`n", [System.Text.Encoding]::UTF8)

# 4. Executar Playwright somente em ambiente descartável, pois o global setup faz db reset
Get-Content .env.local | ForEach-Object { if ($_ -and $_ -notlike '#*') { $name, $val = $_ -split '=', 2; [System.Environment]::SetEnvironmentVariable($name, $val) } }
npx.cmd playwright test tests/webhook.unit.spec.ts tests/gateway.unit.spec.ts tests/actions.unit.spec.ts tests/message-form.unit.spec.ts tests/whatsapp-integration.e2e.spec.ts tests/kanban-actions.unit.spec.ts tests/kanban-board.unit.spec.ts --workers=1

# 5. Executar lint e build da aplicação
npm.cmd run lint
npm.cmd run build
```

---

## 4. Próxima Etapa Recomendada

Configurar uma **conexão Evolution API real e QR Code**, validando o envio e recebimento com um número de WhatsApp real.
