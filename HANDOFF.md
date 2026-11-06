# HANDOFF — ImobFlux (estado em 05/11/2026)

Documento de retomada: o que está no ar, como trabalhar, como voltar depois de um reinício. A fonte detalhada continua sendo `docs/`.

> [!IMPORTANT]
> **Leia antes de mexer no Next.js**: `AGENTS.md` avisa que esta versão do Next (16.4.5, Turbopack) tem mudanças em relação ao que se conhece. Consulte `node_modules/next/dist/docs/` antes de usar uma API do framework.

**Fontes oficiais** (nesta ordem para se situar): [docs/STATUS_PROJETO.md](docs/STATUS_PROJETO.md) (estado), [docs/ROADMAP.md](docs/ROADMAP.md) (planejamento), [docs/CHECKLIST_LANCAMENTO.md](docs/CHECKLIST_LANCAMENTO.md) (o que falta para lançar), [docs/AUDITORIA_PRE_LANCAMENTO.md](docs/AUDITORIA_PRE_LANCAMENTO.md), [docs/ARQUITETURA.md](docs/ARQUITETURA.md), [docs/MATRIZ_PERMISSOES.md](docs/MATRIZ_PERMISSOES.md), [docs/DOCUMENTATION_POLICY.md](docs/DOCUMENTATION_POLICY.md). Cada pacote tem um `docs/RELATORIO_*.md`.

---

## 1. O que é e o que está em produção

CRM imobiliário B2B (SaaS) com WhatsApp integrado. Pilha: Next.js 16.4.5 (Turbopack), React 19, Tailwind v4, Supabase (Postgres com RLS, RPCs `SECURITY DEFINER`, Storage privado, Realtime), Evolution API v2.3.7 numa VPS, hospedagem na Vercel (Node 24.x), Web Push (VAPID).

**Produção**
- App: `https://imobflux.vercel.app` (deploy automático a cada push na `main`).
- Banco: projeto Supabase `imobflux-prod`. Migrations só entram com a Trava A.
- Evolution: VPS com HTTPS, número de WhatsApp pareado, filtro "só números cadastrados" **ligado** (ver `docs/PROCEDIMENTO_LANCAMENTO_INGESTAO.md`).
- `main` = `d406ec1` (correção da reação de cliente; antes, `60c0f00`: Next.js 16.4.5). CI verde nos dois jobs.

**Módulos no ar**: login/equipe/convites/papéis (OWNER e ATTENDANT); contatos e privacidade (protegidos); conversas, mídia, envio de arquivos, editar/apagar/reagir; respostas rápidas; Kanban comercial; tarefas; "Hoje" unificado com prazos/SLA; Web Push (migration `006800`, tela em Preferências, teste imediato/com atraso/por aparelho); app instalável; temas claro/escuro.

## 2. Pacotes recentes (mais novo primeiro)

| Pacote | Estado | Relatório |
|---|---|---|
| Reação de cliente (nono dígito e `@lid`; migration `20260802006900`) | Publicado: migration em produção e app em `d406ec1`; validado com uma pessoa real | `docs/RELATORIO_REACAO_CLIENTE.md` |
| Segurança 1 (Next.js 16.2.12 → 16.4.5, `npm audit` 1 crítica + 7 altas → 0 + 0) | Publicado, `60c0f00`; retestado em computador e celular | `docs/RELATORIO_SEGURANCA_NEXT.md` |
| Noite 2 (testes estabilizados, estudos, auditoria, checklist) | Publicado, `5c40366` | `docs/RELATORIO_NOITE_2.md` |
| Aviso de teste com atraso e teste por aparelho | Publicado, `ef87781` | `docs/RELATORIO_WEB_PUSH.md` |
| Web Push | Publicado, `5e3a4c7`; **iPhone real validado** (inclusive com o app fechado e a tela bloqueada); **Android pendente** | `docs/RELATORIO_WEB_PUSH.md` |
| Hoje unificado, Ajustes 5/6/7, mensagens, arquivos/prazos | Publicados | `docs/RELATORIO_*.md` |

## 3. Pendências (resumo; a lista completa e a ordem estão no checklist)

- **Mário**: reteste do Web Push no Android (B1); teste real de arquivos e mensagens (B4); decisões listadas em cada `ESTUDO_*.md`.
- **Pequenas, do CC**: nenhuma aberta. O Diagnóstico de tela foi removido no pacote Segurança 2.
- **Segurança**: o pacote Segurança 2 está PUBLICADO (main `92b66a7`, 06/11). Pendências: nonce da CSP em produção (B27), clique do aviso com página hidratando (B28), repositório do GitHub público (B29), limite de taxa (B9) e backup da VPS (B10).
- **Antes de desligar "só cadastrados"** (continua **ligado**: o número é pessoal): `@lid` e nono dígito na ingestão normal e de grupo (B13; a auditoria está em `docs/RELATORIO_REACAO_CLIENTE.md`), bloqueio de número (B14), exclusão de cliente (B16).

## 4. Rotina de trabalho e Travas

1. Cada pacote nasce numa **branch local** a partir da `main` atual; nada vai ao GitHub sem ordem.
2. Entrega-se um relatório curto e **para-se** esperando o "autorizo".
3. **Trava A = banco**: só quando há migration. Backup do Supabase antes, aplicar a migration em produção, conferir; depois a Trava B.
4. **Trava B = app**: confirmar `main` == `origin/main` e árvore limpa; diff só do que se espera; lint, tipos, unitários em Node 22 e 24, build com variáveis fake de CI; merge **fast-forward only** + push (nunca `--force`); acompanhar o CI (`gh run watch`: jobs "Lint, tipos, testes unitários e build" e "Banco (migrations + pgTAP)"), o deploy (`vercel ls` até Ready) e o log de build; smoke **somente leitura** (`/login` 200, `/hoje` 307, `/prioridades` 308 para `/hoje`, `/preferencias` 307, `/sw-avisos.js` e `/manifest.webmanifest` 200, rotas de push sem login 401).
5. Reversão: `git revert` do pacote, push e deploy automático (migration: script em `docs/rollback/`).
6. O flake de horário do `today_overview.test.sql` foi corrigido (horários fixos ao meio-dia de Maceió); não há mais janela proibida de publicação.

**Regras permanentes**: nunca resetar/destruir a `main` nem o banco de produção; sem `git reset --hard`, `git clean`, `docker system prune`, remoção de volumes; encerrar processos só por PID (nunca todos os `node`); segredos nunca no chat, em commit ou em documento; não imprimir texto de mensagens de clientes; um navegador de teste por vez; não rodar dois lotes de teste no mesmo banco; não tocar na Evolution/VPS/webhook/instância do WhatsApp nem nas variáveis da Vercel sem ordem. Commits terminam com a linha `Co-Authored-By` do assistente; PRs com a linha "Generated with Claude Code".

## 5. Ambiente local

- Windows, Git Bash e PowerShell; **Docker Desktop precisa estar aberto**. Supabase CLI sempre fixo: `npx --yes supabase@2.111.0 ...`.
- `docs/PROGRESSO_PACOTE.md` é **local** (ignorado pelo git): diário curto de cada pacote e lições.
- **Banco local principal** (pasta do projeto): não rodar `db reset` nele; usar `migration up --local` para aplicar migrations.
- **Cópias descartáveis** (pastas irmãs em `C:\Users\User\Desktop\PROJETOS\`): `imobflux-suite-disposable` (regressão de navegador, Supabase portas 63521+, servidor de teste na porta 3055) e `imobflux-auth-disposable-*` (suíte isolada de autenticação e pgTAP limpo, portas 56321+). Nelas `db reset` é permitido. Sincronizar com `robocopy /MIR` excluindo `node_modules`, `.next`, `.env*` e `.git`.
- Testes:
  - unitários: `npx -y node@22 node_modules/@playwright/test/cli.js test -c playwright.unit.config.ts` (idem `node@24`);
  - navegador: `npx playwright test -c playwright.suite.config.ts tests/<arquivo>.spec.ts`, **um arquivo por vez**, na cópia descartável (42 arquivos, 323 testes, 1 skip pré-existente);
  - pgTAP: `npx --yes supabase@2.111.0 test db --local supabase/tests/database/` em banco descartável (48 arquivos, 1477 testes);
  - build como o CI: mover `.env.local` para fora, definir `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321`, `NEXT_PUBLIC_SUPABASE_CLIENT_KEY=ci-placeholder-client-key`, `SUPABASE_ADMIN_KEY=ci-placeholder-admin-key`, rodar `npm run build` e restaurar `.env.local`.
- Dica de shell: heredocs e regex com barras quebram no Git Bash; prefira escrever um arquivo com a ferramenta de edição ou um script `node`. Arquivos antigos têm fim de linha CRLF.

## 6. Como retomar depois de um reinício do PC

1. Abrir o Docker Desktop e esperar ficar "running".
2. Na pasta do projeto: `git status`, `git branch --show-current`, `git log --oneline -5` e `git fetch` + comparar `main` com `origin/main`.
3. Ler `docs/PROGRESSO_PACOTE.md` (última seção) e o topo de `docs/STATUS_PROJETO.md` para saber o pacote em andamento.
4. Conferir memória livre (menos de 2 GB: não iniciar regressão de navegador) e se sobrou servidor de teste na porta 3055 ou stack do Supabase de cópia descartável (`docker ps`); encerrar só o que for dos testes, por PID.
5. Não aplicar nada em produção para "retomar": retomada é só preparar e reportar até chegar um "autorizo".

## 7. Plano da Vercel e número

O plano é **Hobby** (cron da Vercel só uma vez por dia; os logs de execução guardam só 30 minutos). O número de WhatsApp pareado é **pessoal**.
