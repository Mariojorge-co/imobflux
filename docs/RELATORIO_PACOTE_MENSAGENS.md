# Relatório — Pacote de Mensagens (branch `feat/pacote-mensagens`)

> Estado: **pronto em ambiente local, nada em produção.** Migrations `005700` a `006200` só existem no banco local. A publicação segue o fluxo de duas travas (Trava A = banco, Trava B = app) e depende do "autorizo" do responsável.

## O que o pacote entrega

| # | Função | Como funciona |
|---|--------|---------------|
| 1 | **Responder** | Menu da bolha (ao passar o mouse; sempre visível em tela de toque) → "Responder". Cartão "Respondendo a…" acima da caixa, com X e Esc. A Evolution recebe `quoted` (`key` + `message`); a bolha mostra a citação; clicar nela rola até a original e a destaca (carrega mensagens antigas se preciso). Citações **recebidas** do cliente também aparecem. Vale para texto e para arquivo + legenda (mesma fila de envio). |
| 2 | **Editar** | Só mensagem de **texto enviada pelo ImobFlux**, até **15 min**; atendente só nas próprias, dono em qualquer uma enviada pelo CRM (validado no banco, `begin_message_edit`). Duas fases: o banco valida → a Evolution edita (`POST /chat/updateMessage`) → só então o servidor grava (`commit_message_edit`). Marca "editada"; o texto anterior fica em `message_edits` (só o dono lê; tela "Ver histórico" do dono). Falha da Evolution mantém o original e mostra o motivo. Edição feita no celular chega pelo webhook e atualiza. |
| 3 | **Apagar** | **A) Para mim** = esconde só no ImobFlux, para **toda a equipe**; confirmação "Isso esconde a mensagem no ImobFlux. Ela continua no WhatsApp."; não mexe no WhatsApp; só o **dono** restaura (botão de mensagens escondidas no cabeçalho). **B) Para todos** = `DELETE /chat/deleteMessageForEveryone`, só mensagem nossa, até **48 h**, autor ou dono; bolha vira "Esta mensagem foi apagada"; o texto original vai para `message_deletions` (só o dono lê; "Ver original"); arquivos continuam acessíveis só a quem a RLS já permite. Exclusão feita no celular chega pelo webhook. Tudo auditado (sem o texto). |
| 4 | **Encaminhar** | Menu → seletor com busca (nome/telefone), multi-seleção de **até 5** conversas individuais, confirmação com a quantidade e **aviso de risco de bloqueio** (a partir de 2). Texto e arquivo (o arquivo salvo é **copiado** no Storage, sem baixar de novo). Cada destino entra na **fila da própria conversa**; a falha de um não cancela os outros e o resumo mostra quem falhou. Marca "Encaminhada". A visibilidade (RLS) é validada no banco. |
| 5 | **Reações** | 6 emojis rápidos + "mais"; clicar no mesmo emoji remove; outro emoji troca a sua. Enviadas por `POST /message/sendReaction`. Reações do cliente chegam pelo webhook e aparecem sob a bolha. O eco "enviada por mim" da Evolution é ignorado (migration `006200`) para não duplicar. Só conversa individual. |
| 6 | **Enter na legenda** | A legenda do arquivo virou `textarea`: **Enter envia**, **Shift+Enter quebra a linha** (Enter durante composição de acento não envia). Testado com clipe, arrastar e Ctrl+V. |
| 7 | **Áudio de voz** | Botão de microfone: grava (tempo na tela), cancela, **ouve antes** de enviar e envia como **mensagem de voz (PTT)** por `POST /message/sendWhatsAppAudio` (a Evolution converte para ogg/opus). Upload direto ao Storage + fila de envio. Limite de **10 min / 25 MB**. Permissão negada → mensagem amigável. Sem transcrição. |
| 8 | **Não lida e fixar** | "Marcar como não lida" já existia (volta o indicador; abrir limpa; não altera o prazo). **Fixar é pessoal** (tabela `conversation_pins` com RLS por usuário), até **5** por pessoa, ícone discreto de pin na lista e botão no cabeçalho. |
| 9 | **Busca na conversa** | Lupa no cabeçalho: busca texto (inclui legendas e notas internas), destaca, mostra "N de M", setas mais antigo/mais recente, carrega o histórico até achar. `search_conversation_messages` roda **como o usuário** (RLS), escapa `%` `_` `\`, limita a 500, ignora escondidas e apagadas. |
| 10 | **Nota interna** | Aba "Nota interna" na caixa; a nota aparece **no meio da conversa**, em amarelo claro com cadeado e "Só a equipe vê". **Nunca** passa pela Evolution (rota própria `save_internal_note`; testes provam: nenhum `fetch`, nenhuma RPC de envio, nenhuma mensagem criada, atividade da conversa inalterada). O autor edita/apaga a própria; o dono apaga qualquer (`update_internal_note` / `archive_internal_note`, auditado). Não conta no prazo, não entra em encaminhar nem em exportações; conta na busca. |

## Migrations (todas só locais, em sequência, cada uma com rollback em `docs/rollback/`)

| Migration | Conteúdo |
|-----------|----------|
| `20260802005700_message_actions_schema` | Colunas novas em `messages` (citação, edição, exclusão, ocultação, encaminhada) + tabelas `message_edits`, `message_deletions`, `message_reactions` (RLS; sem escrita direta). |
| `20260802005800_message_actions_rpcs` | `begin_/commit_message_edit`, `begin_/commit_message_revoke`, `hide_message`, `restore_hidden_message`, `begin_/commit_message_reaction`, `get_message_for_forward`, `mark_message_forwarded`, `set_message_reply`, `set_incoming_message_reply`, `ingest_whatsapp_message_edit/delete/reaction`. |
| `20260802005900_conversation_pins` | `conversation_pins` + `set_conversation_pin` (limite 5, RLS por usuário). |
| `20260802006000_message_read_model` | `get_conversation_messages`, `get_conversations_inbox`, `get_conversation_item` com os campos novos; escondidas fora; fixadas primeiro. |
| `20260802006100_conversation_search_and_notes` | `search_conversation_messages`, `update_internal_note`, `archive_internal_note`, `list_conversation_notes` + `REVOKE` explícito de `service_role` em `link_opportunity_conversation` (o padrão do ambiente decidia). |
| `20260802006200_reaction_echo_dedupe` | `ingest_whatsapp_reaction` ignora o eco das reações enviadas pelo ImobFlux. |

Segurança: `SECURITY DEFINER` com `search_path = ''`; `service_role`/`anon` sem execute nas funções de usuário; `commit_*` e `ingest_*` só `service_role`; permissões validadas no banco, não só na tela.

## O que a Evolution realmente suporta (v2.3.7, conferido no código oficial)

- **Responder**: `sendText`/`sendMedia` aceitam `quoted: { key: { id, remoteJid, fromMe }, message: { conversation } }`.
- **Editar**: `POST /chat/updateMessage/{instância}` `{ number, key, text }`. A Evolution só edita texto (ou legenda de imagem/vídeo). A janela de 15 min é do WhatsApp; a Evolution não a aplica direito, por isso o app valida.
- **Apagar para todos**: `DELETE /chat/deleteMessageForEveryone/{instância}` com **corpo plano** `{ id, remoteJid, fromMe }`.
- **Reagir**: `POST /message/sendReaction/{instância}` `{ key, reaction }`; `reaction: ""` remove.
- **Voz**: `POST /message/sendWhatsAppAudio/{instância}` `{ number, audio, encoding: true }` → ogg/opus (PTT).
- **Eventos de entrada**: edição, exclusão e reação chegam como `messages.upsert` com `protocolMessage` / `reactionMessage` (e também `messages.edited` / `messages.delete`). **O formato exato desses payloads só foi confirmado pelo código, não por um celular real.** O parser aceita as variantes conhecidas e ignora o desconhecido sem erro; o roteiro abaixo confirma no mundo real.

## Limites do WhatsApp que o app respeita (e mostra ao usuário)

- Editar: até 15 min, só texto, só mensagem nossa.
- Apagar para todos: até ~48 h (o WhatsApp pode permitir mais ou menos; se recusar, o app mostra o motivo e não apaga localmente).
- Reações e encaminhamento em massa: enviar a mesma mensagem a várias pessoas de uma vez pode levar a bloqueio do número → limite de 5 destinos e aviso.
- Grupos: o ImobFlux ainda não **envia** a grupos (já era assim); logo reagir/encaminhar para grupo não existe.
- "Apagar para mim" do ImobFlux **não** é o "apagar para mim" do WhatsApp: é uma ocultação interna, para toda a equipe.

## Decisões tomadas

1. "Apagar para mim" = esconder só no ImobFlux para toda a equipe; dono restaura; WhatsApp intacto.
2. Editar/apagar para todos: atendente só nas próprias; dono em qualquer uma enviada pelo CRM; regra no banco (duas fases).
3. Encaminhar: uma ou várias conversas existentes (até 5), com busca e confirmação.
4. Reações com emoji incluídas; Enter na legenda corrigido.
5. Fixar é pessoal (não da equipe).
6. Nota interna fica no meio da conversa, mas **fora** da lista de mensagens (prazo, rascunho e envio nunca a veem).
7. Original de mensagem editada/apagada: guardado em tabelas que só o dono lê; a tela do dono mostra "Ver histórico"/"Ver original".

## Pendências e limitações conhecidas

- **Formato real dos eventos de edição/exclusão/reação** precisa ser confirmado com celular real (roteiro abaixo, passos 6, 9, 10 e 12). Se a Evolution entregar outra forma, o ajuste é só em `lib/conversations/webhook.ts` (`parseSpecialMessage`).
- Reações recebidas aparecem em até ~15 s sem recarregar (a tabela de reações não está no Realtime; a conversa confere a cada 15 s). Edição/exclusão/mensagem nova são imediatas.
- Editar **legenda** de arquivo não é suportado (a tela não oferece; o banco recusa).
- Citação de mensagem que não existe no ImobFlux (anterior à conexão) mostra só o trecho que veio no evento.
- Fixar não é compartilhado entre pessoas (decisão).
- Visualizações de "mensagens escondidas" e "histórico" são só do dono.

## Testes

- **pgTAP**: suíte completa verde (43 arquivos, 1343 testes), incluindo `message_actions` (82), `message_read_model` (35), `conversation_search_and_notes` (24) e `message_reaction_echo` (6): atendente não edita/apaga mensagem alheia, não encaminha para conversa inacessível, nota nunca vira mensagem, fixação isolada por usuário, busca respeita RLS e escapa curingas.
- **Unitários** (Playwright, sem navegador): regras de tela, webhook (edição/exclusão/reação/citação), contrato das chamadas à Evolution (rota, método, corpo, erros sem vazamento), ações do servidor (ordem begin → Evolution → commit; recusa não grava; nota nunca chama a Evolution), fila com citação.
- **Navegador** (`tests/mensagens-pacote.spec.ts`, Evolution simulada): uma cobertura por função, incluindo clipe/arrastar/Ctrl+V na legenda, áudio com microfone simulado, busca com 120 mensagens antigas e nota entre atendente e dono.

(Resultado final de cada suíte, versões de Node e build: ver "Checklist" no fim deste arquivo.)

## Prova de compatibilidade (as migrations entram ANTES do app, então precisam funcionar com o app antigo)

Feita no Supabase local descartável, nunca em produção:

1. **Esquema 005600 (o que está em produção) x esquema final (006200)**: só adições. Nenhuma tabela, índice, política, gatilho ou função removidos; 4 tabelas, 25 funções, 7 índices, 4 políticas e 1 gatilho novos; a tabela `messages` ganha 12 colunas e 5 restrições e **nenhuma linha antiga some**. As únicas funções existentes que mudam são `get_conversation_messages`, `get_conversations_inbox` e `get_conversation_item` (mesmas assinaturas; só ganham campos novos no JSON e deixam de listar mensagens escondidas).
2. **Rollbacks encadeados** (`006200` → `005700`, na ordem inversa) sobre o banco final: o esquema volta a ficar **idêntico** ao de 005600 (diferença só de fim de linha e do token do `pg_dump`).
3. **pgTAP do app antigo contra o banco novo**: 39 arquivos / 1196 testes do commit `8a9f50b` rodados no banco com as 6 migrations: **1192 passam**; os 4 que falham só contam funções SECURITY DEFINER / gatilhos `set_updated_at` (inventário que cresce de propósito: `auth_bootstrap` #20, `contact_operations` #7, `owner_rls` #33, `schema_integrity` #22) e já foram atualizados nesta branch.
4. **Suítes de navegador do app antigo (`8a9f50b`) contra o banco novo**: conversas (13), envio de arquivos (11), fila de envio (2), prazos (7), grupos e conversa consigo mesmo (7), respostas rápidas (8), tempo real da lista (3), sprint 23 (7 + 5), sprint 24 (14), correções funcionais (3), colaboração (4) e modo demonstração (1): **todas passaram**. Duas ocorrências instáveis, sem relação com o banco: a miniatura do vídeo em `send-files` (passou na repetição, 11/11) e a medição da caixa de mensagem em `respostas rápidas` (o teste mede a caixa antes de a página desenhá-la; já corrigido nesta branch com uma espera).
5. **Desempenho das leituras** (banco local, maior conversa com 122 mensagens, 20 chamadas): `get_conversation_messages` 108,6 ms contra 103,5 ms antes; `get_conversations_inbox` 126,7 contra 128,1; `get_conversation_item` 82,9 contra 80,1 — mesma ordem de grandeza, sem regressão. O contrário (app novo sobre o banco antigo) não funciona — por isso a ordem é sempre migrations primeiro, app depois.

## ROTEIRO DE TESTE REAL EM PRODUÇÃO (celular) — só depois da publicação

Preparação: uma conversa de teste com **o seu próprio número pessoal** (use "conversa consigo mesmo" ou um segundo chip). Abra o ImobFlux no computador e o WhatsApp no celular lado a lado. Faça os passos nesta ordem; marque o que funcionou.

1. **Responder (CRM → celular)**: no ImobFlux, passe o mouse numa mensagem recebida → menu → *Responder* → escreva "teste 1" → Enter. **No celular**, a mensagem deve chegar **citando** a original.
2. **Responder (celular → CRM)**: no celular, responda (deslizar) a mensagem do passo 1 com "teste 2". **No ImobFlux** deve aparecer a bolha com o cartão de citação. Clique na citação: a tela rola até a original.
3. **Responder com arquivo**: responda a uma mensagem enviando um PDF com legenda. No celular, o PDF chega citando a mensagem.
4. **Editar**: envie "teste 4 errado"; em até 15 min, menu → *Editar* → corrija → Enter. **No celular** a mensagem deve mudar e mostrar "editada". No ImobFlux aparece "editada".
5. **Editar fora do prazo**: espere passar de 15 min: o menu **não** deve oferecer *Editar*.
6. **Editar pelo celular**: no celular, edite uma mensagem **enviada pelo celular**; no ImobFlux ela deve mudar e mostrar "editada" (isso confirma o formato do evento de edição).
7. **Apagar para mim**: envie "teste 7"; menu → *Apagar para mim* → confirme. Ela some do ImobFlux (também para a outra pessoa da equipe) e **continua no celular**. Como dono, abra o botão de mensagens escondidas (olho cortado no cabeçalho) e *Restaurar*: ela volta.
8. **Apagar para todos**: envie "teste 8"; menu → *Apagar para todos* → confirme. No celular vira "Esta mensagem foi apagada"; no ImobFlux também. Como dono: menu → *Ver original* mostra o texto.
9. **Apagar pelo celular**: no celular, apague para todos uma mensagem sua; no ImobFlux ela deve virar "Esta mensagem foi apagada" (confirma o formato do evento de exclusão).
10. **Apagar a mensagem do cliente**: peça para o cliente (ou o outro chip) apagar uma mensagem dele: no ImobFlux deve aparecer apagada.
11. **Reagir (CRM → celular)**: menu → *Reagir* → 👍. No celular a reação aparece na mensagem. Clique de novo no 👍: some.
12. **Reagir (celular → CRM)**: no celular, reaja com ❤️ a uma mensagem; no ImobFlux o ❤️ aparece sob a bolha em até ~15 s (confirma o formato do evento de reação).
13. **Eco de reação**: depois do passo 11, confira que aparece **uma** reação, não duas.
14. **Encaminhar**: menu → *Encaminhar* → busque uma conversa → confirme. A mensagem chega no outro chat marcada como encaminhada no ImobFlux. Teste um **arquivo** também.
15. **Áudio de voz**: toque no microfone, fale 5 s, pare, ouça, envie. No celular deve chegar como **mensagem de voz** (com a onda), tocável. Teste cancelar no meio (nada é enviado) e negar a permissão do microfone no navegador (deve aparecer o aviso amigável).
16. **Legenda com Enter**: anexe uma foto pelo clipe, digite a legenda e aperte **Enter**: envia. Repita com Shift+Enter (quebra a linha) e colando uma imagem com Ctrl+V.
17. **Não lida / fixar**: marque como não lida (bolinha volta); abra a conversa (some). Fixe a conversa no pin do cabeçalho: ela vai ao topo da **sua** lista; outro usuário não vê o pin. Tente fixar a 6ª: avisa o limite.
18. **Busca**: lupa no cabeçalho → digite uma palavra de uma mensagem antiga → o resultado é destacado, setas navegam.
19. **Nota interna**: aba *Nota interna* → escreva e salve. A nota aparece em amarelo com "Só a equipe vê". **Confira no celular que nada chegou.** Edite a nota (autor) e apague (autor ou dono).

Se algum passo falhar, anote qual e envie; os passos 6, 9, 10 e 12 são os que confirmam os formatos de evento da Evolution.

## Plano de publicação (aguarda "autorizo")

1. **Trava A (banco)**: backup → `migration list` → dry-run → parar e pedir "autorizo" → `db push` das migrations `005700` a `006200` → validação somente leitura → apagar backup. As migrations são **retrocompatíveis** com o app que está em produção hoje (só adicionam colunas/tabelas/funções e recriam leituras com campos a mais).
2. **Trava B (app)**: checklist completo → merge `--ff-only` → push → CI (`gh`) e Vercel (`vercel ls`) → smoke test somente leitura.
3. Rollbacks em `docs/rollback/` na ordem inversa (`006200` → `005700`); o app novo precisa ser revertido antes ou junto.
