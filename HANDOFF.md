# HANDOFF Técnico Completo e Atualizado — ImobFlux

Documento de transição técnica referente ao estado atual da aplicação **ImobFlux** após a conclusão das Sprints 17 e 18.

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
- **Migrations SQL**: 15 migrations consolidadas e aplicadas no PostgreSQL local.
- **Testes SQL (pgTAP)**: **291 asserções aprovadas** (7 arquivos de teste em `supabase/tests/database/`).
- **Testes E2E/Unitários (Playwright)**: **70 testes aprovados** (`npx playwright test`).
- **Qualidade de Código**: `npm run lint` → **PASS** (0 erros, 0 warnings); `npm run build` → **PASS** (0 erros TypeScript).

**Módulos Funcionais Operacionais**:
1. **Autenticação & Sessão SSR**: Login/logout com cookies HTTP-only e proxy de autorização.
2. **Bootstrap Controlado**: Inicialização segura do 1º OWNER via token de alta entropia.
3. **Contatos (100% Real)**: CRUD atômico controlado por 5 RPCs `SECURITY DEFINER` auditadas.
4. **Prioridades (100% Real)**: Dashboard comercial calculado por RPC real (`get_prioridades_dashboard`).
5. **Conversas & WhatsApp Textual (100% Real)**: Leitura de mensagens, envio via `sendMessageAction`, RPC `queue_outgoing_text_message`, gateway com reconciliação idempotente e webhook Evolution API (`ingest_whatsapp_text_message`).
6. **Kanban Comercial (100% Real)**: Leitura em lote via RPC `get_kanban_board`, movimentação otimista com controle de concorrência (`move_opportunity_stage`), criação de oportunidades (`create_opportunity`) e auditoria.

---

## 2. Limitações Atuais do Sistema

- **WhatsApp Textual**: Implementado tecnicamente, mas a conexão real com a Evolution API e geração de QR Code pendentes de configuração de ambiente.
- **Supabase Realtime**: Atualização de telas via re-fetch ou `router.refresh()`; realtime não habilitado.
- **Mídias e Anexos**: Suporte restrito a texto puro (máx. 4096 caracteres).
- **Kanban**: Retorno limitado a 50 oportunidades abertas por etapa, com o indicador `has_more`.
- **Kanban Won/Lost & Reordenação**: Marcação de Won/Lost e reordenação manual na mesma coluna adiados.
- **Dark Mode**: Precisa ser inspecionado nas próximas etapas de polimento de UI.
- **Instagram Direct**: Possibilidade futura, fora do escopo do roadmap atual.

---

## 3. Comandos Principais de Execução e Teste

```powershell
# 1. Resetar banco local e aplicar as 15 migrations
$env:PATH = "C:\Users\User\AppData\Local\Programs\DockerDesktop\resources\bin;" + $env:PATH
npx.cmd --yes supabase@2.111.0 db reset --local --no-seed

# 2. Executar suíte de testes do banco PostgreSQL (291 asserções pgTAP)
npx.cmd --yes supabase@2.111.0 test db --local

# 3. Regenerar tipos TypeScript derivados do banco em UTF-8
$raw = & npx.cmd --yes supabase@2.111.0 gen types typescript --local
$content = $raw -join "`n"
[System.IO.File]::WriteAllText((Resolve-Path "types\database.ts").Path, $content + "`n", [System.Text.Encoding]::UTF8)

# 4. Executar suíte completa do Playwright (70 testes)
Get-Content .env.local | ForEach-Object { if ($_ -and $_ -notlike '#*') { $name, $val = $_ -split '=', 2; [System.Environment]::SetEnvironmentVariable($name, $val) } }
npx.cmd playwright test tests/webhook.unit.spec.ts tests/gateway.unit.spec.ts tests/actions.unit.spec.ts tests/message-form.unit.spec.ts tests/whatsapp-integration.e2e.spec.ts tests/kanban-actions.unit.spec.ts tests/kanban-board.unit.spec.ts --workers=1

# 5. Executar lint e build da aplicação
npm.cmd run lint
npm.cmd run build
```

---

## 4. Próxima Etapa Recomendada

Configurar uma **conexão Evolution API real e QR Code**, validando o envio e recebimento com um número de WhatsApp real.
