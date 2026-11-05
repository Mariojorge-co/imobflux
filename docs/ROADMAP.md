# Roadmap do Projeto — ImobFlux

Planejamento da evolução do **ImobFlux**. Estado atual em [STATUS_PROJETO.md](STATUS_PROJETO.md).

---

## Concluído

- **Sprints 15–18**: Prioridades reais, Contatos, Conversas, integração WhatsApp textual, Kanban comercial.
- **Sprint 24**: refinamento de UX, identidade canônica de conversas, reordenação persistente do Kanban.
- **Equipe e acesso**: convite por e-mail (SMTP próprio), aceite, redefinição de senha, desativar/reativar.
- **Privacidade reforçada**: contato protegido também em grupo liberado e anexos; webhook com segredo.
- **Mídia no WhatsApp**: download para Storage privado e visualização de imagem, PDF e áudio na conversa.
- **Conexão por QR code**: tela de Configurações > WhatsApp (conectar, renovar QR, desconectar).
- **Rodada de melhorias (outubro/2026)**:
  - correções de bugs de ingestão, oportunidade pela conversa e envio honesto;
  - SLA visual (selo único) na lista, na conversa e no Kanban;
  - Kanban no celular (abas por etapa) e estados vazios guiados;
  - importação de histórico recente do WhatsApp (15 dias), marcada e fora do SLA, com aviso de falha;
  - CI no GitHub (lint, tipos, unitários, build, migrations e pgTAP) e testes sem duplicação.
- **Em uso real (outubro/2026)**: Evolution API hospedada na VPS, número pareado, envio e recebimento de texto e mídia, histórico, SLA e privacidade testados com número real.
- **Pacote de Conversas, respostas rápidas e envio de arquivos (outubro/2026)**: desempenho da troca de conversa, SLA único, reabertura, envio otimista e mídia compacta; respostas rápidas com variáveis, painel e atalho "/"; **envio de arquivos pelo WhatsApp** (clipe, arrastar, colar; imagens, vídeo, áudio, PDF, Office, texto, compactados; até 25 MB; bloqueio de executáveis); **fila de envio** que não trava a caixa e preserva a ordem; **prazos configuráveis** (Configurações > Prazos) com pausa/desativação por conversa; grupos liberados um a um (Configurações > Grupos); conversa consigo mesmo; foto e vídeo compactos; auditoria com rótulos próprios (`RELATORIO_RESPOSTAS_RAPIDAS.md`, `RELATORIO_PACOTE_ARQUIVOS_PRAZOS.md`).
- **Reação de cliente (pronta e testada localmente na branch `fix/reacao-cliente`, a partir da `origin/main` `60c0f00`; migration `006900` só no banco local; AGUARDA "autorizo" das Travas A e B)**: A reação de CLIENTE era descartada (`unknown_reactor`, 10 de 10) porque `ingest_whatsapp_reaction` comparava o telefone por igualdade exata (JID de 12 dígitos x contato de 13). Migration `20260802006900` (CREATE OR REPLACE, retrocompatível): primeiro o contato da conversa individual (resolve `@lid`), depois o telefone com e sem o 9 (o mais antigo), só então `unknown_reactor`; log seguro de reação ignorada no webhook. pgTAP red→green (13 de 21 falham sem a migration; 49 arquivos / 1498 testes passam), 725 unitários (Node 22 e 24), build ok, 3 testes de navegador novos e suítes de mensagens/reações verdes. Auditoria de igualdade exata de telefone/JID no relatório (a ingestão normal e a de grupo ainda precisam da mesma tolerância antes de desligar "só cadastrados"). As 10 reações de teste se perderam: a pessoa reage de novo depois da publicação. Relatório: [RELATORIO_REACAO_CLIENTE.md](RELATORIO_REACAO_CLIENTE.md).
- **Segurança 1 — Next.js 16.4.5 (pronta e testada localmente na branch `fix/seguranca-next`, a partir da `main` `5c40366`; sem migration; só `package.json` e `package-lock.json`, nenhum código do app mudou; AGUARDA "autorizo" da Trava B)**: `next` e `eslint-config-next` 16.2.12 → 16.4.5 (corrige os avisos críticos e altos, entre eles o de DoS em Server Actions que se aplica ao app) e correção segura das dependências indiretas altas; `npm audit` de 1 crítica + 7 altas para **0 críticas e 0 altas** (restam 16 moderadas só de ferramentas de lint). Regressão: 720 unitários (Node 22 e 24), build idêntico, 42 arquivos de navegador (323 testes) sem falhas. Relatório: [RELATORIO_SEGURANCA_NEXT.md](RELATORIO_SEGURANCA_NEXT.md).
- **Noite 2 (JÁ PUBLICADA, main `5c40366`; só testes e documentação, sem migration)**: testes instáveis estabilizados, seis estudos (`ESTUDO_LID`, `ESTUDO_EXCLUSAO_CLIENTE`, `ESTUDO_BLOQUEIO_NUMERO`, `ESTUDO_LEMBRETES_TAREFA`, `PLANO_BACKUP_VPS`, `PROCEDIMENTO_LANCAMENTO_INGESTAO`), `AUDITORIA_PRE_LANCAMENTO` e `CHECKLIST_LANCAMENTO`. Relatório: [RELATORIO_NOITE_2.md](RELATORIO_NOITE_2.md).
- **Aviso de teste com atraso (pronto e testado localmente na branch `fix/push-teste-atraso`, a partir da `main` `5e3a4c7`; sem migration; AGUARDA "autorizo" da Trava B)**: botão "Enviar aviso de teste em 10 segundos" em Preferências (atraso feito no servidor, lista fechada 0/10/20, 1 teste pendente por aparelho e 5 s entre testes; `maxDuration` 30 s só nessa rota) e "Testar este aparelho" para qualquer aparelho da própria pessoa (pelo id, validado no servidor). Ver [RELATORIO_WEB_PUSH.md](RELATORIO_WEB_PUSH.md).
- **Web Push (JÁ PUBLICADO, main `5e3a4c7`; migration `20260802006800` aplicada em produção; chaves VAPID cadastradas pelo Mário)**: avisos de mensagem nova com o ImobFlux fechado (só o responsável; sem responsável, só o dono; sem prévia do texto), seção "Avisos neste aparelho" nas Preferências, `/sw-avisos.js` com push, e a seção do Hoje renomeada para "Cadastros a completar". Falta o mini reteste em iPhone e Android reais. Relatório: [RELATORIO_WEB_PUSH.md](RELATORIO_WEB_PUSH.md).
- **Hoje unificado (JÁ PUBLICADO, main `5518803`; texto original: pronto e testado localmente na branch `feat/hoje-unificado`, a partir da `main` `8db36b6`; sem migration)**: `/prioridades` deixou de ser tela e redireciona (permanente) para `/hoje`; o menu perdeu "Prioridades"; o Hoje mostra, em ordem de ação, contadores do dia (+ "Para agir agora", sem contar a mesma pessoa duas vezes), clientes aguardando resposta da equipe, follow-ups devidos, tarefas, novas sem atendimento, aguardando cliente e, por último e recolhida, a cadastros a completar; listas com "Ver mais". Mesmas RPCs, consultas em paralelo. Relatório: [RELATORIO_HOJE_UNIFICADO.md](RELATORIO_HOJE_UNIFICADO.md).
- **Ajustes 7 (JÁ PUBLICADO, main `8db36b6`; texto original: pronto e testado localmente na branch `fix/ajustes-7`, a partir da `main` `d8215fe`; sem migration)**: iPhone — campos com 16 px reforçados (`!important` + guarda no foco; não consegui reproduzir o zoom no Chrome, causa no iOS não confirmada), moldura da conversa fixa até a borda de baixo e fundos/rolagem elástica do app (faixa escura no app instalado) e **Diagnóstico de tela temporário** em Preferências para coletar números do aparelho. Ver [RELATORIO_AJUSTES_7.md](RELATORIO_AJUSTES_7.md).
- **Ajustes 6 (JÁ PUBLICADO, main d8215fe; texto original: pronto e testado localmente na branch `fix/ajustes-6`, a partir da `main` `b7b9ad5`; sem migration; AGUARDA "autorizo" da Trava B)**: teclado do iPhone (conversa fixa na área visível), cabeçalho da conversa em uma linha no celular (ações no menu ⋯), menu ☰ fecha ao tocar fora e auditoria de todas as sobreposições, miniatura de imagem que ficava em branco (carregava antes da hidratação), vídeo com primeiro quadro no iOS e "Tentar de novo", texto honesto sobre avisos no iPhone, app instalável (manifest, ícones, áreas seguras) e estudo de Web Push (só documento). Ver [RELATORIO_AJUSTES_6.md](RELATORIO_AJUSTES_6.md) e [ESTUDO_WEB_PUSH.md](ESTUDO_WEB_PUSH.md).
- **Ajustes 5 (JÁ PUBLICADO em produção, main b7b9ad5; texto original: pronto e testado localmente na branch `fix/ajustes-5`; sem migration; AGUARDA "autorizo" da Trava B)**: avisos de mensagem nova corrigidos (prazo pausado agora avisa) com painel de diagnóstico, "Testar aviso agora" e service worker mínimo; folhas e menus fecham ao tocar fora; campos de 16 px no celular; seletor de emoji; ajuda de atalhos só pelo botão; "Rascunho:" na lista de conversas. Próxima etapa dos avisos: Web Push com servidor (avisar com o app fechado). Ver [RELATORIO_AJUSTES_5.md](RELATORIO_AJUSTES_5.md).
- **Pacote Noite Geral (publicado em produção em 2026-10-28, main `24ae9eb`; migrations `006500`, `006600`, `006700` aplicadas)**: atalhos (Esc em camadas, Alt+setas, rascunho por conversa, ajuda de atalhos), layout de celular/tablet (duas telas, folhas de toque, 44 px), painel **Hoje**, **respostas rápidas com anexo** (até 5 arquivos), **avisos de mensagem nova** (título, som, aviso do sistema), **busca global** (mensagens, legendas, contatos), **modo escuro** (claro/escuro/automático, contraste AA) e os estudos de Google Contatos e de financiamento. Detalhes e roteiro de teste real em [RELATORIO_PACOTE_NOITE.md](RELATORIO_PACOTE_NOITE.md).
- **Pacote de Mensagens (publicado em 2026-10-16; migrations `005700`–`006200` em produção desde 2026-10-16)**: responder com citação, editar (15 min), apagar para mim (oculta na equipe, dono restaura) e para todos (48 h), encaminhar para até 5 conversas, reações com emoji, áudio de voz (PTT), fixar conversa (pessoal), busca dentro da conversa, nota interna no meio da conversa e Enter envia na legenda; migrations `005700` a `006200` (ver `RELATORIO_PACOTE_MENSAGENS.md`, com o roteiro de teste real no celular).

---

## Próximas prioridades

A Evolution está hospedada e o teste com número real foi feito. Pendências priorizadas (nenhuma em andamento):

0. (Feito: publicar o Web Push, main `5e3a4c7`) **Mini reteste do Web Push em iPhone e Android reais**, usando o teste com atraso (Trava B pendente do pacote `fix/push-teste-atraso`): ver [RELATORIO_WEB_PUSH.md](RELATORIO_WEB_PUSH.md). Prioridade: **ALTA**.
0. (Feito: publicar o Hoje unificado, main `5518803`; `/prioridades` redireciona para `/hoje`) Mini reteste no celular em [RELATORIO_HOJE_UNIFICADO.md](RELATORIO_HOJE_UNIFICADO.md).
0. (Feito: publicar os Ajustes 7, main `8db36b6`) Fazer o mini reteste no iPhone com o app instalado, **me mandando o texto do "Diagnóstico de tela"** (roteiro em [RELATORIO_AJUSTES_7.md](RELATORIO_AJUSTES_7.md)); depois remover o diagnóstico temporário. Prioridade: **ALTA**.
0. (Feito: publicar os Ajustes 6) **Publicar os Ajustes 6** (sem migration: só a Trava B, quando houver "autorizo") e fazer o **mini reteste no iPhone** (teclado, cabeçalho, ☰, imagens/vídeos, instalar como app; roteiro em [RELATORIO_AJUSTES_6.md](RELATORIO_AJUSTES_6.md)). Prioridade: **ALTA**.
0. **Decidir sobre o Web Push** (avisos com o app fechado, no iPhone só com o app instalado): ler as decisões no fim de [ESTUDO_WEB_PUSH.md](ESTUDO_WEB_PUSH.md). Prioridade: **MÉDIA**.
0. Refazer o teste real dos avisos dos Ajustes 5 com "Testar aviso agora" (mini reteste em [RELATORIO_AJUSTES_5.md](RELATORIO_AJUSTES_5.md)).
0. (Feito e publicado, main `5e3a4c7`) **Avisos com o app fechado (Web Push com servidor)**: ver [RELATORIO_WEB_PUSH.md](RELATORIO_WEB_PUSH.md).
0. Teste real do Pacote Noite (já no ar) em 390 px e no computador (roteiro em [RELATORIO_PACOTE_NOITE.md](RELATORIO_PACOTE_NOITE.md)).
0. **Teste real do pacote de mensagens no celular** (roteiro em [RELATORIO_PACOTE_MENSAGENS.md](RELATORIO_PACOTE_MENSAGENS.md); os passos de edição/exclusão/reação vindas do celular confirmam o formato dos eventos da Evolution). Prioridade: **ALTA**.
1. **Teste real do envio de arquivos** (foto, PDF, .rar, vídeo, 24 MB, 26 MB recusado, .exe bloqueado, 3 mensagens seguidas) — roteiro em [RELATORIO_PACOTE_ARQUIVOS_PRAZOS.md](RELATORIO_PACOTE_ARQUIVOS_PRAZOS.md). Prioridade: **ALTA**.
2. **Backup automático da VPS** (Evolution/Postgres/Redis). Prioridade: **ALTA**.
3. **Tratar contatos `@lid`** (usar o telefone real do payload da Evolution; depende de um payload real).
4. **Exclusão real de contato/conversa e bloqueio de número.**
5. **Reduzir a cópia de mensagens na Evolution/VPS** (ver `RELATORIO_WHATSAPP_PESSOAL.md`).
6. **Lembretes ativos de tarefa** (notificações).
7. **Contatos do Google** (importar/sincronizar). Estudo pronto, aguardando decisões do Mário: [ESTUDO_GOOGLE_CONTATOS.md](ESTUDO_GOOGLE_CONTATOS.md).
8. **Acabamento visual** (rodada de ajustes de interface).
9. **Acompanhamento de financiamento** e **agenda de visitas** (novos módulos comerciais). Estudo pronto, aguardando decisões do Mário: [ESTUDO_ACOMPANHAMENTO_FINANCIAMENTO.md](ESTUDO_ACOMPANHAMENTO_FINANCIAMENTO.md).

## Pendências do documento de MVP

Os cinco itens abaixo foram **implementados e publicados em produção em 2026-10-13** (commit `720dd37`; migrations
`004300` a `004900` aplicadas). Detalhes em [RELATORIO_NOITE.md](RELATORIO_NOITE.md) e correções da revisão em [RELATORIO_CORRECOES.md](RELATORIO_CORRECOES.md):

1. ~~Remoção de funcionário~~ (fluxo 23).
2. ~~Atribuição de conversa e troca de responsável~~ (fluxos 18 e 19).
3. ~~Tela de auditoria~~ para o OWNER (fluxo 25).
4. ~~Tela própria de tarefas~~ (fluxos 16 e 17).
5. ~~Exportação de dados~~ pelo OWNER (fluxo 26), em CSV de contatos e oportunidades.

Ainda sem implementação: notificações e lembretes ativos de tarefa; suspensão marcando atribuições para revisão;
exportação de conversas/anexos/relatórios; evento de auditoria por resposta enviada pelo CRM.

## Qualidade contínua

- Atualizar `HANDOFF.md` (ainda descreve a Sprint 24).
- Executar a suíte Playwright isolada de autenticação em ambiente descartável antes de cada release.
- Auditoria geral final (segurança, RLS, performance e UX) antes de comercializar.

---

## Propostas futuras (fora do escopo imediato)

> [!NOTE]
> Possibilidades de expansão, não compromissos.

- Importação de histórico mais profunda, se o provedor permitir (hoje depende do celular e vem uma vez só).
- Gravação de áudio pelo microfone (nota de voz), envio de arquivos em grupos e envio em massa (fora do pacote de arquivos).
- Agendar a varredura de uploads órfãos do envio de arquivos (hoje manual: `npm run sweep:uploads`).
- Ações comerciais adicionais além do fluxo de ganho/perda atual.
- Instagram Direct.
