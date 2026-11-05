# Estudo: lembretes ativos de tarefa (aviso por push no horário) — versão para a Vercel **Hobby**

> Só leitura do código e da documentação. **Nada foi implementado e nada de produção foi acessado.** Atualizado em 2026-11-05 com a informação do Mário de que o plano da Vercel é **Hobby** (cron da Vercel só **uma vez por dia**, precisão de ±59 minutos). Isso encerra a dúvida da versão anterior: a Opção A (cron da Vercel) **não atende**; o estudo agora aprofunda o agendamento dentro do **Supabase** (`pg_cron` + `pg_net`). Os pontos que dependem de números oficiais do Supabase estão marcados **a confirmar** (a documentação deles muda; confirmar antes de implementar).

## 1. Situação atual
- A tabela `work_tasks` **já tem** `due_at` (prazo) e `reminder_at` (lembrete); a criação de tarefa já aceita `reminderAt` (RPC com `p_reminder_at`, que exige `reminder_at <= due_at`). Hoje o lembrete **é só um dado**: nada dispara no horário. A tela **Hoje** lista tarefas vencidas/do dia quando a pessoa abre o app. O estado da tarefa usa `status = 'pending'` (e `completed`/`cancelled`), não "open".
- **Web Push já existe e está validado em iPhone real**: `push_subscriptions` (aparelhos, RLS por pessoa), envio com `web-push` e chaves VAPID, `public/sw-avisos.js`, `sendWebPush` (timeout de 6 s, sem repetição) e `deliverPush` (404/410 desativa a assinatura). Hoje a seleção de destinatários é só de mensagem nova.
- **Não existe agendador** no projeto: sem `vercel.json`, sem `pg_cron`/`pg_net` nas migrations.
- **Restrições do cenário**: Vercel **Hobby**; número de WhatsApp **pessoal**; o app roda na Vercel e o banco no Supabase (plano a confirmar; o estudo assume o gratuito para o pior caso).

## 2. O que é preciso
1. **Quem recebe**: o responsável pela tarefa; sem responsável, o criador ou só o proprietário (decisão). Mesmas regras de visibilidade (atendente só recebe de tarefa dele).
2. **Quando**: no `reminder_at` (e, opcionalmente, no `due_at`). Tarefa concluída/cancelada **antes** do horário não avisa.
3. **Uma vez só**: marca de envio atômica (`reminder_sent_at`), para repetir a rotina não duplicar.
4. **Conteúdo**: genérico por padrão ("Tarefa para agora"); mostrar o **título** é decisão do Mário (pode ter nome de cliente). Toque abre `/tarefas`.
5. **Um disparador** que acorde a cada minuto e envie o que venceu.

## 3. Opções de agendamento (com o Hobby)

### Opção A — Cron da Vercel: **descartada**
No Hobby só roda 1 vez por dia, com ±59 min. Expressões mais frequentes **falham o deploy**. Não serve para lembrete no horário (serviria, no máximo, para um "resumo das tarefas de hoje" diário, sem hora exata).

### Opção B1 — `pg_cron` + `pg_net` chamando uma rota protegida do app (**recomendada**)
- **Como funciona**: um job do `pg_cron` roda a cada minuto e executa uma função SQL. A função usa `net.http_post` (`pg_net`) para chamar `POST https://imobflux.vercel.app/api/cron/lembretes` com um cabeçalho de segredo. A rota (Next.js, na Vercel) chama a função de "claim" no banco, envia o push com o `deliverPush` que já existe e devolve só contagens. O envio fica **no mesmo código** que já está validado (VAPID, 404/410, `tag`).
- **Por que é a melhor**: reaproveita o envio testado; a chave VAPID privada continua só na Vercel; o banco só *acorda* o app. Precisão de minuto, independe do plano da Vercel.
- **Plano gratuito do Supabase**: `pg_cron` e `pg_net` são extensões oferecidas em todos os planos (**a confirmar** no painel do projeto: Database → Extensions). Uma chamada por minuto = ~43 mil requisições por mês à Vercel (cada uma é uma invocação curta de função; dentro do que o Hobby inclui, **a confirmar** no painel de uso). O `pg_net` é assíncrono (não segura o job) e guarda as respostas numa tabela interna por pouco tempo (**a confirmar** o prazo); limpar não é necessário no volume previsto.
- **Segurança do segredo da rota**:
  - Um segredo **novo e exclusivo** (`CRON_SECRET`, longo e aleatório), **diferente** do segredo do webhook e das chaves VAPID.
  - Na Vercel: variável de ambiente `CRON_SECRET` (Production). No Supabase: guardado no **Vault** (`vault.create_secret`) e lido pela função com `vault.decrypted_secrets`; **nunca** escrito numa migration nem em texto no job. A função tem `SECURITY DEFINER`, `search_path` vazio e **sem** permissão para `anon`/`authenticated`.
  - A rota compara em **tempo constante**, aceita só `POST`, responde 401 sem detalhe e **não executa nada** sem o segredo; o dano de um vazamento fica limitado (só envia lembretes já vencidos e ainda não marcados, no máximo N por chamada).
  - Rodízio do segredo: trocar na Vercel e no Vault no mesmo dia (documentar no procedimento).
- **Contras**: configuração em SQL (menos visível que `vercel.json`); migration nova (**Trava A**); um segredo a mais para guardar; se o projeto Supabase gratuito for **pausado por inatividade** (aviso comum do plano gratuito, **a confirmar**), o job para junto: como o app está em uso diário, o risco é baixo, mas deve ser monitorado.

### Opção B2 — Enviar direto do Supabase (Edge Function ou SQL), sem chamar a Vercel
- **Edge Function** (Deno) chamada pelo `pg_cron`/`pg_net`: reimplementa o envio Web Push fora do repositório principal e exige as **chaves VAPID também no Supabase** (duas cópias da chave privada). O plano gratuito inclui invocações de Edge Functions (**a confirmar** o limite mensal), mas é mais código para manter e testar. **Não recomendada** enquanto a B1 resolver.
- **Só SQL**: o Web Push exige criptografia de conteúdo e assinatura ES256 (curva P-256) que o PostgreSQL com `pgcrypto` **não** faz; **inviável**.

### Opção C — Fila no banco processada "por evento"
Sem relógio, atrasa quando ninguém usa o app. Não garante horário. Só como complemento (a mesma rota processa a fila).

### Opção D — Cron externo (cron-job.org, GitHub Actions agendado)
Gratuito, mas é uma peça a mais fora do controle, o segredo fica fora do Supabase/Vercel e o `schedule` do GitHub Actions pode atrasar vários minutos. Fica como **plano B** se o `pg_cron` não estiver disponível.

### Opção E — Adiar com `after()` + espera
Serve para segundos (limite de 30 s da rota), **inviável** para minutos/horas.

## 4. Desenho sugerido (B1)
1. **Migration (aditiva, Trava A)**:
   - `work_tasks.reminder_sent_at timestamptz`;
   - índice parcial em `reminder_at` onde `reminder_sent_at is null and status = 'pending'`;
   - função `public.claim_due_task_reminders(p_limit int)` — `SECURITY DEFINER`, `search_path` vazio, **só `service_role`** — que, em uma transação com `FOR UPDATE SKIP LOCKED`, escolhe tarefas `pending` com `reminder_at <= now()` e `reminder_sent_at is null`, grava `reminder_sent_at = now()` e devolve (tarefa, membro, assinaturas ativas);
   - função `private.trigger_task_reminders()` que lê o segredo do Vault e chama `net.http_post`;
   - `select cron.schedule('lembretes-de-tarefa', '* * * * *', 'select private.trigger_task_reminders()')`;
   - extensões `pg_cron` e `pg_net` habilitadas (se ainda não estiverem; criar a extensão exige permissão que o Supabase oferece pelo painel/migration, **a confirmar**).
2. **Rota** `POST /api/cron/lembretes` (runtime Node, `maxDuration` curto): valida o segredo, chama `claim_due_task_reminders(100)`, envia com `deliverPush` e registra **só contagens e códigos**.
3. **Idempotência / sem duplicar**: a marca `reminder_sent_at` é gravada na **mesma transação** que escolhe a tarefa, com `SKIP LOCKED`; duas execuções simultâneas nunca pegam a mesma tarefa. Se o envio falhar depois da marca, o lembrete **não repete** (melhor perder um aviso do que duplicar; registrar a falha em contagem). Se o Mário preferir tentar de novo, usar uma coluna de tentativas (máximo 2).
4. **Fuso**: `reminder_at` é `timestamptz` (instante absoluto); a comparação com `now()` não depende de fuso. O que depende é como o formulário **grava** o horário: converter do fuso do workspace (`America/Maceio` hoje) para UTC no cliente/servidor (conferir `lib/tasks/actions.ts`). Horário silencioso (opcional): decidir no claim usando o fuso do workspace.
5. **Testes**: pgTAP (quem recebe, concluída não avisa, marca única, só `service_role`, limite de lote, `SKIP LOCKED` em duas sessões), unitário (conteúdo genérico, rota recusa sem segredo e com método errado), navegador (cria tarefa com lembrete, chama a rota com o segredo de teste, sem push real).
6. **Rollback** em `docs/rollback/`: `cron.unschedule`, apaga as duas funções, o índice e a coluna.
7. **Variável nova na Vercel**: `CRON_SECRET` (Production); segredo igual no Vault do Supabase.

## 5. Custos e limites
| Item | Observação |
|---|---|
| Vercel Hobby | Cron só diário: **não atende**. Chamadas vindas do Supabase não são "cron" da Vercel e não sofrem esse limite; contam como invocações de função (~43 mil/mês, curtas) — conferir o uso incluído |
| Supabase gratuito | `pg_cron`, `pg_net` e Vault (**a confirmar** no projeto). Sem custo extra de cobrança prevista; atenção à pausa por inatividade do plano gratuito |
| Web Push | Sem custo por aviso; limites dos serviços Apple/Google/Mozilla; TTL de 1 h |
| Execução | Lote de 100 lembretes por minuto e no máximo ~50 aparelhos por rodada (teto do `deliverPush`); o excedente sai na rodada seguinte |
| Precisão | Minuto, mais o atraso próprio do push |

## 6. Riscos
- **Pausa do projeto Supabase gratuito** por inatividade: o job para. Mitigar com uso diário e um aviso se `cron.job_run_details` ficar parado (verificação manual no checklist de rotina).
- **Segredo da rota vazado**: qualquer um dispararia avisos; dano limitado (só lembretes vencidos e marcados, em lote pequeno), mas exige rodízio. Nunca em log, commit ou chat.
- **Duplicar aviso** se a marca não for atômica (resolvido pelo `SKIP LOCKED` na mesma transação).
- **Aviso perdido** se o envio falhar depois da marca (por escolha: não repetir).
- **Fuso** do formulário; **título com nome de cliente** (decisão 3).
- **`pg_net` sem resposta**: a chamada é assíncrona; o job não sabe se a Vercel respondeu. Monitorar a tabela de respostas do `pg_net` no diagnóstico.
- **Migration em produção** (Trava A, backup) e variável nova na Vercel (autorização separada).

## 7. Recomendação
**Opção B1**: `pg_cron` + `pg_net` no Supabase chamando `POST /api/cron/lembretes` na Vercel, com `CRON_SECRET` exclusivo (Vercel + Vault), `claim_due_task_reminders` atômico e conteúdo genérico por padrão. Antes de implementar: **confirmar no painel do Supabase** que `pg_cron`, `pg_net` e Vault estão disponíveis no plano do projeto e quais são os limites atuais; se não estiverem, usar a Opção D como ponte. Entregar em um pacote com 1 migration (Trava A), a rota, os testes, o rollback e a tela mostrando "Lembrete enviado às HH:MM".

## 8. Esforço estimado
| Etapa | Esforço |
|---|---|
| Confirmar extensões e limites no painel do Supabase (Mário, sem alterar nada) | 0,25 hora |
| Migration + claim + agendamento + pgTAP + rollback | 1 dia |
| Rota do cron, envio e testes | 1 dia |
| Segredo (Vercel + Vault), verificação em produção, rodízio documentado | 0,5 dia |
| Tela (indicador de lembrete enviado, fuso) | 0,5 dia |
| Lembrete também no `due_at` e repetições (opcional) | +1 dia |

## 9. Decisões que o Mário precisa tomar
1. Aceita o desenho B1 (banco acorda o app por `pg_cron` + `pg_net`)? Autoriza conferir no painel do Supabase se as extensões e o Vault estão disponíveis?
2. Autoriza criar a variável nova `CRON_SECRET` na Vercel e o segredo no Vault do Supabase quando chegar a hora (a criação é uma autorização separada)?
3. Quem recebe: só o responsável? E sem responsável: o criador ou só o proprietário?
4. O aviso mostra o **título** da tarefa ou um texto genérico?
5. Avisar só no `reminder_at`, ou também no `due_at` (e se atrasar)?
6. Repetir o aviso se a tarefa continuar aberta (ex.: 1 vez depois de 1 hora) ou apenas uma vez? E se o envio falhar: perder ou tentar de novo (máximo 2)?
7. Horário silencioso (não avisar de madrugada)? Hoje as mensagens não têm, por decisão sua.
