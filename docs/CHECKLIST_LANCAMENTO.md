# Checklist de lançamento

> Consolidado a partir de `docs/ROADMAP.md`, `docs/STATUS_PROJETO.md` e dos estudos desta noite (`ESTUDO_LID`, `ESTUDO_EXCLUSAO_CLIENTE`, `ESTUDO_BLOQUEIO_NUMERO`, `ESTUDO_LEMBRETES_TAREFA`, `PLANO_BACKUP_VPS`, `PROCEDIMENTO_LANCAMENTO_INGESTAO`, `AUDITORIA_PRE_LANCAMENTO`). Estado conhecido em 2026-11: `main` em `ef87781`, Web Push, teste de push com atraso e Hoje unificado publicados.
>
> **Status:** `Pronto` = feito e verificado; `Falta` = trabalho a fazer; `Decisão` = depende de escolha do Mário.
> **Dono:** `CC` = Claude Code; `Mário`; `Ambos`.
> **Esforço:** estimativa de trabalho de desenvolvimento (CC) ou de tempo do Mário.

## A. Já pronto (para não esquecer do que existe)
| Item | Status | Dono | Observação |
|---|---|---|---|
| Conversas, contatos, kanban, tarefas, Hoje, prazos/SLA, respostas rápidas, envio de arquivos | Pronto | CC | Em produção |
| Equipe, convites, atribuição, permissões por papel, auditoria, exportação | Pronto | CC | Em produção |
| Evolution na VPS (HTTPS), número pareado, envio/recebimento, histórico | Pronto | Ambos | Em produção |
| Web Push (migration `006800`, chaves VAPID, rotas, tela em Preferências) | Pronto | CC/Mário | Publicado em `5e3a4c7`; **falta o reteste em aparelhos reais** (item B1) |
| Aviso de teste com atraso e teste por aparelho | Pronto | CC | Publicado em `ef87781` |
| App instalável (manifest, ícones), temas claro/escuro, contraste AA, 16 px/44 px no celular | Pronto | CC | Em produção |
| Testes: unitários, navegador, pgTAP (48 arquivos), CI nos dois jobs | Pronto | CC | `docs/RELATORIO_NOITE_2.md` traz o estado dos testes instáveis |

## B. Para o lançamento (ordem sugerida)

### Fase 1 — Validar o que já está no ar (esta semana)
| # | Item | Status | Dono | Esforço |
|---|---|---|---|---|
| B1 | **Mini reteste do Web Push** em iPhone (iOS 16.4+, app instalado pelo Safari) e Android: ativar, teste imediato, teste de 10 s, mensagem real com app fechado e tela bloqueada (roteiro em `RELATORIO_WEB_PUSH.md`) | Falta | Mário | 30 min |
| B2 | Reteste do iPhone dos Ajustes 7 (campos sem zoom, sem faixa escura) e envio do texto do "Diagnóstico de tela" | Falta | Mário | 15 min |
| B3 | Remover o **Diagnóstico de tela** temporário (`components/notifications/screen-diagnostics.tsx` e a seção em Preferências) depois de B2 | Falta | CC | 1 h |
| B4 | Teste real do envio de arquivos (foto, PDF, vídeo, 24 MB, 26 MB recusado, .exe bloqueado) e do pacote de mensagens (editar/apagar/reagir vindos do celular) | Falta | Mário | 1 h |
| B5 | **Teste de ponta a ponta com um atendente real** (seção C) | Falta | Ambos | 1 a 2 h |

### Fase 2 — Segurança e estabilidade (antes de abrir para clientes)
| # | Item | Status | Dono | Esforço |
|---|---|---|---|---|
| B6 | **Atualizar o Next.js (16.4.4)** e dependências indiretas (`AUDITORIA_PRE_LANCAMENTO.md`, achado #1/#5) | Falta | CC | 0,5 a 1 dia |
| B7 | Cabeçalhos de segurança (CSP em report-only) + páginas de erro/404 em português (achados #2/#8) | Falta | CC | 1 dia |
| B8 | Mapear mensagens de erro do banco e log só com código (achados #4/#10) | Falta | CC | 0,5 dia |
| B9 | Limite de taxa em anexos/exportação; conferir limites do Supabase Auth e que o cadastro aberto está desligado (achado #3) | Falta | Ambos | 1 dia + 15 min do Mário no painel |
| B10 | **Backup automático da VPS** com cópia externa criptografada, alerta de falha e ensaio de restauração (`PLANO_BACKUP_VPS.md`) | Decisão (onde guardar, custo) + Falta | Ambos | 1,5 dia CC + decisões |
| B11 | Rodar `git log -p` completo à procura de segredos antes de abrir o repositório a terceiros; confirmar repositório privado | Falta | CC/Mário | 30 min |
| B12 | Rodar o rodízio do segredo do webhook e das chaves após a equipe toda ter acesso (rotina) | Decisão | Mário | 30 min |

### Fase 3 — Qualidade dos dados antes de desligar o filtro de contatos
| # | Item | Status | Dono | Esforço |
|---|---|---|---|---|
| B13 | **`@lid` e nono dígito** (leitura de `remoteJidAlt`, fim do contato com telefone falso; `ESTUDO_LID.md`) — recomendado **antes** de desligar "só cadastrados" | Decisão + Falta | Ambos | 2,5 a 3 dias (+ coleta de amostras) |
| B14 | **Bloquear número** (só ImobFlux primeiro; `ESTUDO_BLOQUEIO_NUMERO.md`) | Decisão + Falta | Ambos | 2 a 3 dias |
| B15 | Tela de contatos duplicados / mesclar (`ESTUDO_LID.md`) | Decisão + Falta | CC | 2 a 3 dias (pode vir depois do lançamento) |
| B16 | **Exclusão/anonimização de cliente** (fase 1 de `ESTUDO_EXCLUSAO_CLIENTE.md`) — necessária para atender pedido de titular (LGPD) | Decisão + Falta | Ambos | 2 a 3 dias |
| B17 | Decisão jurídica: prazo de guarda das conversas, aviso de privacidade/termos para quem escreve ao número | Decisão | Mário | — |

### Fase 4 — Operação do dia a dia
| # | Item | Status | Dono | Esforço |
|---|---|---|---|---|
| B18 | **Lembretes ativos de tarefa** por push (`ESTUDO_LEMBRETES_TAREFA.md`); depende do plano da Vercel (Hobby só cron diário) | Decisão + Falta | Ambos | 3 dias |
| B19 | Distribuição de leads sem responsável (hoje só o proprietário recebe o aviso) | Decisão | Mário | — (escopo a definir) |
| B20 | Contatos do Google, financiamento e agenda de visitas (estudos prontos) | Decisão | Mário | Pós-lançamento |
| B21 | Reduzir a cópia de mensagens na Evolution/VPS (`RELATORIO_WHATSAPP_PESSOAL.md`) | Decisão | Ambos | A definir |
| B22 | Atualizar `HANDOFF.md` (ainda descreve a Sprint 24) | Falta | CC | 1 h |

### Fase 5 — O dia do lançamento
| # | Item | Status | Dono | Esforço |
|---|---|---|---|---|
| B23 | Seguir `PROCEDIMENTO_LANCAMENTO_INGESTAO.md` para **desligar "só números cadastrados"** (somente se B13 e B14 estiverem resolvidos ou aceitos como risco) | Decisão | Mário | 1 hora de janela |
| B24 | Conferir backup recente, painel de logs e saldo/limites dos planos (Vercel, Supabase, VPS) no dia | Falta | Mário | 30 min |
| B25 | Primeiros dias: monitorar contatos novos, duplicados, falhas de webhook e push (tabela do procedimento) | Falta | Ambos | diário, 10 min |

## C. Teste de ponta a ponta com um atendente real
Objetivo: provar o caminho completo com uma pessoa de verdade, num aparelho dela. Roteiro (preencher a tabela com o resultado):

| Passo | Quem | Como | Esperado | Resultado |
|---|---|---|---|---|
| 1 | Mário (proprietário) | Configurações > Equipe > convidar o atendente pelo e-mail dele | E-mail de convite chega | |
| 2 | Atendente | Abrir o link do e-mail **no próprio aparelho**, definir senha, entrar | Cai em `/hoje`, vê só o que é dele | |
| 3 | Atendente | Safari/Chrome: instalar o ImobFlux na Tela de Início (iPhone) e abrir pelo ícone | App abre sem barra do navegador | |
| 4 | Atendente | Preferências > Avisos neste aparelho > Ativar > Enviar aviso de teste em 10 segundos; fechar o app e bloquear a tela | Aviso "Aviso de teste do ImobFlux" em ~10 s | |
| 5 | Mário | Atribuir uma conversa ao atendente | Conversa aparece para ele; auditoria registra a atribuição | |
| 6 | Cliente de teste (outro número) | Mandar mensagem na conversa atribuída | **Aviso no celular do atendente** ("Nova mensagem de {nome}", sem texto) com app fechado; toque abre a conversa certa | |
| 7 | Atendente | Responder pelo ImobFlux | Mensagem chega ao cliente; estado "enviada" | |
| 8 | Cliente de teste | Mandar mensagem em conversa **de outro** atendente/sem responsável | O atendente **não** recebe o aviso; o proprietário recebe o dos sem responsável | |
| 9 | Atendente | Tentar abrir conversa de outro atendente pelo endereço | Recusado | |
| 10 | Mário | Desativar o atendente | Perde o acesso e deixa de receber avisos | |

## D. Decisões do Mário reunidas (de todos os estudos)
1. **Plano da Vercel** (Hobby ou Pro)? Define lembretes de tarefa (B18) e limites.
2. **`@lid` sem telefone**: criar contato provisório ou ignorar? Autoriza coleta de amostras? (B13)
3. **Bloqueio**: só ImobFlux primeiro? O que fazer com a conversa existente? (B14)
4. **Exclusão**: prazo de guarda; anonimizar basta?; só proprietário; lixeira de quantos dias? (B16/B17)
5. **Backup da VPS**: onde guardar, orçamento, retenção; autoriza uma sessão com acesso à VPS só para verificar? (B10)
6. **Lançamento**: desligar "só cadastrados" já ou manter e cadastrar clientes? Número é pessoal ou comercial? (B23)
7. **Distribuição de leads** sem responsável. (B19)
8. **Aviso de privacidade/termos** e base legal. (B17)

## E. Ordem sugerida resumida
`B1/B2/B4` (você) → `B3` → `B6` → `B7/B8` → `B10` → `B5` (ponta a ponta) → `B13` + `B14` → `B16` → `B9/B11/B12` → `B18` → `B23` (lançamento) → `B15/B19/B20` depois.
