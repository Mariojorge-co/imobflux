# Relatório — Pacote Reação de cliente (nono dígito e @lid)

> Branch local `fix/reacao-cliente`, a partir da `origin/main` `60c0f00` (a `main` local estava igual). **Não houve push, merge, deploy nem migration em produção.** A migration só foi aplicada no banco local de uma cópia descartável. Nada foi lido nem alterado em produção, na Evolution, na VPS, na Vercel ou no WhatsApp neste pacote. Números, nomes e textos de teste são fictícios.

## 1. Causa (confirmada na investigação anterior)
Em `public.ingest_whatsapp_reaction` (migration `20260802006300`), quando a reação **não** é da nossa conta, o telefone do reator era comparado por **igualdade exata** com `contact_points.normalized_value`. O JID da conversa chega com **12 dígitos** (sem o nono dígito) e o contato está cadastrado com **13**. Nunca casava: `unknown_reactor` em 10 de 10 reações de clientes. Com `@lid` sem telefone útil o resultado era o mesmo. As reações do Mário nunca comparam telefone (`from_me`), por isso funcionavam.

## 2. A correção
**Migration `supabase/migrations/20260802006900_reaction_client_resolve.sql`**: `CREATE OR REPLACE` da mesma função (mesma assinatura, permissões e campos de resposta; retrocompatível, o app anterior funciona com o banco migrado). Para a reação de cliente:
1. **(a)** conversa **individual**: o reator é o contato da própria conversa da mensagem reagida (primeiro participante ativo). Resolve também o `@lid` sem telefone;
2. **(b)** senão (grupo ou conversa sem participante): pelo telefone com e sem o nono dígito (`private.phone_match_candidates`), escolhendo o contato **mais antigo** se houver mais de um;
3. **(c)** só então `unknown_reactor`.

Preservado: reação da nossa conta (celular e eco), remoção por texto vazio, uma reação por contato e por mensagem, mensagem apagada ignorada, mensagem de outro workspace ignorada (`unknown_message`). Reação em **grupo** continua ignorada pelo webhook (`@g.us`); no banco, uma mensagem de grupo só casa por telefone.

**Rollback**: `docs/rollback/20260802006900_rollback.sql` devolve a função à definição da `006300`. Nenhuma tabela, coluna ou permissão muda; as reações já gravadas permanecem. Validado localmente: aplicado o rollback o teste novo volta a falhar (13 de 21), reaplicada a migration volta a passar.

**Mudança em um teste antigo** (`message_actions.test.sql`, 1 linha): "quem não é contato conhecido é ignorado" esperava `unknown_reactor` para um telefone desconhecido reagindo numa conversa individual. Pela regra pedida (a), isso agora vira reação do contato da conversa (`success`). O caso "reator desconhecido é ignorado" continua coberto, em grupo, no teste novo.

**Log seguro** (`app/api/webhooks/whatsapp/route.ts`, `lib/conversations/webhook-shape.ts`): quando uma reação de cliente é aplicada como `ignored`, o webhook registra `[webhook-event] reaction ignorada reason=… from_me=… sufixo_conversa=lid|s.whatsapp.net|g.us|outro|ausente sufixo_reator=… digitos_reator=N alt_presente=sim|nao`. Nunca o número, o nome nem o emoji.

## 3. Auditoria (somente leitura): outros pontos que comparam telefone/JID por igualdade exata
Nada abaixo foi corrigido neste pacote.

| # | Onde | O que acontece | Risco | Recomendação |
|---|---|---|---|---|
| 1 | `ingest_whatsapp_text_message` (`20260802005600`, linhas ~90 e ~209): contato achado por `normalized_value = telefone normalizado`; conversa achada por `external_thread_id = JID` | Com **"só cadastrados" ligado** há tolerância ao nono dígito (`phone_match_candidates`). Com a chave **desligada** (lançamento), igualdade exata: contato duplicado (12 x 13) e conversas separadas para `@lid` x telefone | **Alto no lançamento**, nulo hoje | Antes de desligar a chave: aplicar `phone_match_candidates` no caminho normal e tratar `remoteJidAlt` (item B13, `ESTUDO_LID.md`) |
| 2 | `ingest_whatsapp_group_text_message` (`20260802005100`, ~841): remetente do grupo por `normalized_value = telefone` | Membro de grupo com 12 x 13 dígitos vira contato duplicado; `@lid` vira "telefone" de 15 dígitos | Médio (grupos só entram com `ingest_groups` ligado) | Mesma correção do item 1, mais `participantAlt` |
| 3 | Importação de histórico (`20260802005100`, ~1006-1028) | Usa a mesma ingestão por JID: herda os itens 1 e 2 | Médio | Resolvido junto com o item 1 |
| 4 | Cadastro/edição de contato (`create_contact`/`update_contact`, índice único `uq_contact_points_normalized_identity`) | O mesmo telefone com e sem o 9 convive como dois contatos; o aviso `contact_phone_duplicate` só pega igualdade exata | Médio: duplicados criados à mão e conversa "provisória" de 12 dígitos ao lado do contato de 13 | Detectar duplicado por variante do 9 no cadastro e oferecer "usar o existente" (B15, mesclar) |
| 5 | Conversa por `external_thread_id` exato (todas as ingestões) | O mesmo cliente por `@lid` e por telefone vira duas conversas | Alto no lançamento | Tabela de identidades (`ESTUDO_LID.md`, opção A+B) |
| 6 | Edição, exclusão, "citação" e eco (`ingest_whatsapp_message_edit/delete`, `find_message_by_external`) | Procuram pelo **id da mensagem** do WhatsApp, não pelo telefone | Baixo | Nenhuma |
| 7 | Envio (`lib/supabase/gateway.ts`, `gateway-actions.ts`): reação/edição/exclusão usam o JID guardado da conversa; `@lid` não envia (`INVALID_RECIPIENT`) | Contato `@lid` sem telefone não recebe resposta do CRM | Médio | Mesma tabela de identidades; consultar `remoteJidAlt` ao criar a conversa |
| 8 | Busca global (`20260802006700`) e SLA (`20260802005500`) | Busca por dígitos com `LIKE` e SLA com candidatos: já tolerantes | Baixo | Nenhuma |
| 9 | Atribuição, tarefas, Hoje | Usam ids, não telefone | Nenhum | Nenhuma |
| 10 | Webhook (`lib/conversations/webhook.ts:426`): `@lid` troca o telefone por `remoteJidAlt`/`senderPn` só **na reação**; nas mensagens de texto/mídia o `@lid` segue bruto | Ver itens 1, 5 e 7 | Alto no lançamento | Ler `remoteJidAlt` em todos os tipos (B13) |

## 4. Testes
- **pgTAP novo** `supabase/tests/database/reaction_client_resolve.test.sql` (21 asserções): JID de 12 dígitos com contato de 13; o inverso (contato de 12, reator com 13); trocar o emoji (uma reação por contato); remover com texto vazio; `@lid` sem telefone em conversa individual; reator de outra conversa não se mistura; contato duplicado com o mesmo telefone (vale o mais antigo); mensagem de outro workspace ignorada; grupo com reator desconhecido segue ignorado; mensagem apagada ignorada; reação do celular da conta e eco inalterados.
- **Red → green**: sem a migration, **13 de 21 falham** (as 8 que passam são justamente os comportamentos que não devem mudar). Com a migration, **21 de 21 passam**. Com o rollback aplicado voltam as 13 falhas; reaplicada a migration, voltam a passar.
- **pgTAP completo** no banco local limpo da cópia descartável (`db reset` + `test db`): **49 arquivos, 1498 testes, PASS**.
- **Unitário novo** `tests/reaction-diagnostics.unit.spec.ts` (5 testes): classe do sufixo, dígitos, `remoteJidAlt`, nunca número, nome nem emoji. Total de unitários: **725 passando em Node 22 e em Node 24**.
- **Navegador novo** `tests/reacao-cliente.spec.ts` (3 testes, usando o helper de webhook): o cliente reage à **foto** (👍) e ao **texto** (❤️) com o contato cadastrado com 13 dígitos e o JID de 12; os emojis aparecem sob as bolhas; trocar para 🔥 substitui; remover (texto vazio) limpa as duas; `@lid` com `remoteJidAlt` e `@lid` sem telefone chegam ao contato da conversa; reação de grupo continua ignorada e nada é gravado. 3 de 3 passam.
- **Regressão de navegador relacionada**, uma suíte por vez na cópia descartável: `mensagens-pacote` 14, `correcoes-mensagens` 14, `conversations` 13, `sprint23-conversations-evolution` 7, `correcoes-4` 8: **todas passando, 0 falhas**.
- Lint e tipos sem erro; build com variáveis fake de CI ok, sem avisos.
- **Não rodado**: a regressão completa dos 42 arquivos (só as suítes de mensagens e reações, como pedido) e a suíte isolada de autenticação. O teste de navegador novo não foi executado "antes" da migration (o vermelho está no pgTAP).

## 5. Arquivos alterados
`supabase/migrations/20260802006900_reaction_client_resolve.sql` (novo), `docs/rollback/20260802006900_rollback.sql` (novo), `supabase/tests/database/reaction_client_resolve.test.sql` (novo), `supabase/tests/database/message_actions.test.sql` (1 linha), `app/api/webhooks/whatsapp/route.ts` e `lib/conversations/webhook-shape.ts` (log seguro), `tests/reacao-cliente.spec.ts` e `tests/reaction-diagnostics.unit.spec.ts` (novos), `docs/RELATORIO_REACAO_CLIENTE.md`, `docs/ROADMAP.md`, `docs/STATUS_PROJETO.md`, `docs/CHECKLIST_LANCAMENTO.md`.

## 6. Checklist da Trava A (banco) — só com o "autorizo"
1. Confirmar `main` e `origin/main` iguais, árvore limpa; backup do banco do Supabase de produção (como nas Travas A anteriores) e anotar o horário.
2. `npx --yes supabase@2.111.0 migration list --linked`: a última aplicada deve ser a `20260802006800`; a `006900` aparece só como local.
3. `npx --yes supabase@2.111.0 db push --linked --dry-run`: deve listar **somente** a `20260802006900`.
4. `npx --yes supabase@2.111.0 db push --linked` (aplicar).
5. Validação **somente leitura**: `migration list --linked` mostra a `006900` nos dois lados; `select pg_get_functiondef('public.ingest_whatsapp_reaction(text,text,text,boolean,text)'::regprocedure)` contém `phone_match_candidates`; `select count(*) from public.message_reactions` inalterado; nenhuma chamada da função.
6. A Trava B só depois: merge fast-forward e push, CI (os dois jobs), Vercel Ready, smoke somente leitura. O app antigo e o novo funcionam com o banco migrado.
7. Reversão: `begin; \i docs/rollback/20260802006900_rollback.sql; commit;` e `migration repair --status reverted 20260802006900`.
8. Evitar a janela de 00:00 a 00:30 em Maceió enquanto o flake de `today_overview.test.sql` não estiver corrigido (branch `fix/today-overview-teste`).

## 7. Mini reteste do Mário com a outra pessoa (depois da publicação)
**As 10 reações de teste anteriores se perderam**: foram descartadas na época e a Evolution não as reenvia. A pessoa precisa **reagir de novo**.
1. Abrir a conversa com essa pessoa no ImobFlux.
2. A pessoa reage com 👍 à **foto** que você enviou: o 👍 aparece sob a foto.
3. A pessoa reage com ❤️ a um **texto** seu: o ❤️ aparece sob o texto.
4. A pessoa **troca** o emoji de um deles (por exemplo 🔥): o novo substitui o antigo.
5. A pessoa **remove** a reação: some no ImobFlux.
6. Você reage a uma mensagem dela (pelo app e pelo celular): continua funcionando como antes.
7. Se algo falhar, a linha `reaction ignorada … sufixo_reator=… digitos_reator=… alt_presente=…` nos logs da Vercel (últimos 30 minutos) dirá o motivo sem expor dados.

## 8. Observações
- O "mais antigo" na regra (b) usa `contact_points.created_at`.
- A regra (a) assume que em conversa individual só o contato dela reage; o WhatsApp só entrega reações desse contato ou da própria conta.
- Memória livre durante o trabalho ficou entre 0,6 e 2,5 GB; as suítes de navegador só foram iniciadas com mais de 2 GB livres. Nenhum processo foi encerrado fora dos servidores de teste da porta 3055.
