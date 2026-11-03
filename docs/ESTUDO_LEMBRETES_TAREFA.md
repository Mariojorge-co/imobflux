# Estudo: lembretes ativos de tarefa (aviso por push no horário)

> Só leitura do código e da documentação pública da Vercel (consultada em 2026-11, página "Usage & Pricing for Cron Jobs"). Nada foi implementado. Não se sabe qual plano da Vercel o projeto usa: isso muda a recomendação (ver seção 3).

## 1. Situação atual
- A tabela `work_tasks` **já tem** `due_at` (prazo) e `reminder_at` (lembrete), e a criação de tarefa já aceita `reminderAt` (`lib/tasks/actions.ts`, RPC com `p_reminder_at`; a tela de tarefas mostra o campo). Hoje o lembrete **é só um dado**: nada dispara no horário. O que existe para ver tarefas é passivo: a tela **Hoje** lista tarefas vencidas/do dia quando a pessoa abre o app.
- **Web Push já existe** (publicado): tabela `push_subscriptions` (aparelhos, RLS por pessoa), envio via `web-push` com chaves VAPID, o service worker `public/sw-avisos.js` (sempre mostra uma notificação por push, com `tag` para não empilhar), a função de envio `sendWebPush` (timeout de 6 s, sem repetição) e a entrega em `deliverPush` (404/410 desativa a assinatura). A seleção de destinatários hoje é só para mensagem nova (`get_push_targets`, dedicada ao webhook).
- **Não existe** agendador no projeto: nada em `vercel.json` (o arquivo nem existe), nenhum `pg_cron`/`pg_net` nas migrations.

## 2. O que é preciso
1. **Quem recebe**: o responsável pela tarefa (`responsible_member_id`); sem responsável, o criador? ou só o proprietário (decisão). Respeitar as mesmas regras de visibilidade (atendente só recebe de tarefa dele).
2. **Quando**: no `reminder_at` (e, opcionalmente, no `due_at`). Tarefa concluída/cancelada/arquivada antes do horário **não** avisa.
3. **Uma vez só**: precisa de marca de envio (`reminder_sent_at` ou tabela de envios) para que repetir a rotina não duplique o aviso.
4. **Conteúdo**: genérico e sem dado de cliente, no padrão já adotado: título da tarefa (ou "Tarefa para agora"), sem descrição; toque abre `/tarefas` (ou a conversa). Decisão do Mário: mostrar o **título** da tarefa (pode conter nome de cliente)?
5. **Um disparador** que acorde de tempos em tempos e envie o que venceu.

## 3. Onde agendar (opções)

### Opção A — Cron da Vercel (`vercel.json`) chamando uma rota do app
Uma rota `GET /api/cron/lembretes` protegida por `CRON_SECRET` (cabeçalho `Authorization: Bearer …`, que a Vercel envia sozinha), que consulta lembretes vencidos e envia.
- **Plano Hobby**: no máximo **1 execução por dia** e precisão de **±59 minutos** (expressões mais frequentes **falham o deploy**). Isso **não serve** para lembrete no horário.
- **Plano Pro**: a cada **minuto**, precisão de minuto. Serve. Cada execução é uma Function (conta no uso/cobrança da Vercel; uma chamada por minuto = 43 mil/mês, normalmente dentro do incluído para uma função curta, a confirmar no painel).
- Prós: tudo no repositório, fácil de ler; reaproveita `sendWebPush`. Contras: depende de pagar o Pro (se hoje for Hobby).

### Opção B — `pg_cron` + `pg_net` no Supabase (recomendada para o plano gratuito)
O próprio banco chama a rota do app a cada minuto (`net.http_post` com um segredo no cabeçalho), ou a função SQL monta a lista e a rota só envia.
- Prós: roda no plano gratuito do Supabase (extensões `pg_cron`/`pg_net` disponíveis; **a confirmar** no projeto), precisão de minuto, independe do plano da Vercel.
- Contras: configuração em SQL (migration + segredo guardado no banco/Vault), menos visível que `vercel.json`, e é preciso proteger a rota (segredo diferente do webhook). Migration nova (Trava A).

### Opção C — Fila no banco + "empurrão" por evento
Em vez de relógio, gravar o envio agendado numa tabela (`push_outbox`) e processar quando **qualquer** requisição do app chegar. Não garante horário (se ninguém usa o app, atrasa). **Não recomendada** isolada; serve como complemento de A ou B (a mesma rotina processa a fila).

### Opção D — Serviço externo de cron (cron-job.org, GitHub Actions agendado)
Chama a rota a cada minuto/5 minutos, de graça. Contras: mais uma peça fora do controle, segredo exposto fora, `schedule` do GitHub Actions pode atrasar vários minutos.

### Opção E — Adiar o disparo com a técnica do teste com atraso (`after()` + espera)
Só serve para atrasos de segundos (limite da função: 30 s nesta rota); **inviável** para lembretes em minutos/horas.

## 4. Desenho sugerido (para A ou B)
1. **Migration (aditiva)**: `work_tasks.reminder_sent_at timestamptz`; índice parcial em `reminder_at` onde `reminder_sent_at is null and status = 'open'`; função `private`/`public` `claim_due_task_reminders(p_limit)` (`SECURITY DEFINER`, `search_path` vazio, **só `service_role`**) que, numa transação com `FOR UPDATE SKIP LOCKED`, marca `reminder_sent_at = now()` e devolve (tarefa, membro, assinaturas ativas). Marcar **antes** de enviar evita duplicar (melhor esforço, sem repetição, como o aviso de mensagem).
2. **Rota** `GET /api/cron/lembretes` (autenticada por segredo, comparação em tempo constante): chama a função, envia com `deliverPush`, registra só contagens e códigos.
3. **Teste**: pgTAP (quem recebe, concluída não avisa, marca única, `service_role`), unitário (conteúdo genérico, sem repetição) e navegador (cria tarefa com lembrete; simula a chamada do cron com o segredo de teste; sem push real).
4. **Rollback** em `docs/rollback/`: remove função, índice e coluna.
5. **Variável nova na Vercel**: `CRON_SECRET` (a Vercel já a usa nos crons).

## 5. Custos e limites
| Item | Observação |
|---|---|
| Vercel Hobby | Cron só diário, ±59 min: **não atende** |
| Vercel Pro | Cron por minuto; cobrança de uso das Functions (uma chamada curta por minuto) |
| Supabase gratuito | `pg_cron`/`pg_net` (a confirmar); cada chamada é uma requisição à Vercel |
| Web Push | Sem custo por aviso; limites dos serviços de push (Apple/Google/Mozilla), TTL de 1 h |
| Função | Tempo máximo por execução; enviar a no máximo ~50 aparelhos por rodada já é o teto de `deliverPush` |
| Lotes | Limitar a N lembretes por execução (ex.: 100) e continuar na rodada seguinte |

## 6. Riscos
- **Plano Hobby** + `vercel.json` a cada minuto: o deploy **falha** (não afeta produção em execução, mas trava a publicação). Conferir antes.
- **Duplicar aviso** se a marca de envio não for atômica (por isso o `SKIP LOCKED`).
- **Fuso horário**: `reminder_at` é `timestamptz`; a tela precisa exibir/gravar no fuso do usuário (já é um tema do app; conferir o formulário).
- **Aviso sem o app aberto no iPhone** exige o app instalado e as chaves VAPID (já resolvido).
- **Vazar dado**: o título da tarefa pode ter nome de cliente; por isso a decisão 4.
- **Segredo do cron** vazado = qualquer um dispara avisos (limitar o dano: a rota só envia lembretes já vencidos e marcados).
- Atraso: nunca é exato ao segundo (minuto na melhor hipótese; push tem atraso próprio).

## 7. Recomendação
Confirmar o plano da Vercel. **Se for Pro**: Opção A (mais simples de manter). **Se for Hobby**: Opção B (`pg_cron` + `pg_net`), que não custa nada. Em ambos: o mesmo desenho de claim atômico e conteúdo genérico. Entregar em um pacote com 1 migration (Trava A), a rota e a tela mostrando "Lembrete enviado às HH:MM".

## 8. Esforço estimado
| Etapa | Esforço |
|---|---|
| Migration + função de claim + pgTAP + rollback | 1 dia |
| Rota do cron, envio e testes | 1 dia |
| Configuração do agendador (A ou B) e verificação | 0,5 dia |
| Tela (indicador de lembrete enviado, fuso) | 0,5 dia |
| Lembrete no `due_at` e repetições (opcional) | +1 dia |

## 9. Decisões que o Mário precisa tomar
1. Qual é o plano da Vercel hoje (Hobby ou Pro)? Aceita migrar para Pro?
2. Quem recebe: só o responsável? E se não houver responsável?
3. O aviso mostra o título da tarefa ou um texto genérico?
4. Avisar só no `reminder_at`, ou também no `due_at` (e se atrasar)?
5. Repetir o aviso se a tarefa continuar aberta (ex.: 1 vez depois de 1 hora) ou apenas uma vez?
6. Horário comercial: não avisar de madrugada? (hoje as mensagens não têm horário silencioso por decisão sua.)
