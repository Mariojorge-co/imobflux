# Relatório — Correções pós-teste das mensagens (branch local `fix/mensagens-pos-teste`)

> Estado: **pronto e testado localmente; NADA foi publicado** (sem push, deploy nem migration em produção). Parte da `main`
> (`fd1163b`). A `feat/pacote-noite` **não entra** neste pacote e continua parada. Aguarda o seu **"autorizo"**: primeiro a
> **Trava A** (uma migration: `006300`), depois, separadamente, a **Trava B** (app) e **um clique seu** em Configurações > WhatsApp
> (ver "Depois da publicação").

## Como foi feito o diagnóstico (Parte 0) e o que ficou provado

**Fontes e limites**
- **Logs da Vercel**: indisponíveis para o horário do teste. O plano atual só guarda cerca de **30 minutos** de log de execução
  (`vercel logs` recusa janelas maiores: *"The hobby plan does not retain runtime logs for the requested time range"*). Por isso a
  causa de cada item foi buscada **no banco de produção (somente leitura, sem texto de mensagem)** e **no código**, e o app agora
  deixa **log de diagnóstico sem conteúdo** para o reteste (abaixo).
- **Banco de produção**: consultas `SELECT` só de metadados (ids truncados, tipos, status, tamanhos). Nenhum texto de mensagem,
  nome ou número foi lido ou impresso. Uma tentativa de baixar uma cópia dos dados foi (corretamente) bloqueada e **não foi feita**.

**Evidências coletadas (conversa de teste "Mensagens para você", 16/10 entre 10:56 e 11:11)**

| Fato | Onde se vê | O que prova |
|---|---|---|
| Mensagens do CRM têm `external_message_id` de 22 caracteres (`3EB0…`) e as do celular de 20 (`3A…`) | `messages` | O `key.id` do envio **foi gravado certo**: o problema não é o id. |
| A resposta do CRM (10:56:31) tem `reply_to_*` e trecho; a resposta do celular "teste 2" (10:56:47, origem whatsapp) **não tem nada** | `messages` | **A**: a citação vinda do celular não foi extraída/ligada. |
| Edição pelo CRM gravou `message_edits(source=crm)` às 10:58 e `edit_count=1`; **nenhuma** linha `source=whatsapp` em 30 h | `message_edits` | **B** (o app marcou "editada" assim que a Evolution respondeu 2xx) e **C** (nunca chegou edição do celular). |
| Exclusão para todos pelo CRM gravou `message_deletions(source=crm)` às 11:04; nenhuma `source=whatsapp` | `message_deletions` | **D**: o app marcou apagada pela resposta 2xx; o WhatsApp nunca confirmou. |
| 👍 de **membro** às 11:06 numa mensagem; ❤️ de **conta** (celular) às 11:07 em outra; **nenhum eco** da reação do CRM | `message_reactions` | **E**: a reação do ImobFlux não gerou eco; **F**: o modelo trata "membro do CRM" e "celular da conta" como **pessoas diferentes**. |
| A conversa guarda o JID com **13 dígitos** (`55 82 9 9…`) e o número da conta pareada tem **12 dígitos** (`55 82 9…`, mesma linha sem o 9 inserido) | `conversations.external_thread_id` × `channel_connections.external_phone_normalized` | O JID real do chat no WhatsApp é o de 12 dígitos; o ImobFlux usa o de 13. |
| O webhook da conexão assina **só** `MESSAGES_UPSERT`, `MESSAGES_SET` e `CONNECTION_UPDATE` | `lib/whatsapp/evolution-instance.ts` | A Evolution **nunca avisa** edição e exclusão feitas no celular nem confirma as do ImobFlux. |

## Causa raiz de cada item

| Item | Causa raiz | Certeza |
|---|---|---|
| **A** — resposta do celular sem citação | Em nenhuma resposta do celular o app extraiu o `contextInfo`. O leitor só procurava `contextInfo` dentro de alguns tipos de mensagem (texto estendido e mídia) e **não** no nível do evento (`data.contextInfo`, onde a Evolution v2 também o coloca) nem em mensagens embrulhadas (`deviceSentMessage`, efêmeras, visualização única), que é como o celular da própria conta as entrega. | **Hipótese** forte (sem o payload real não dá para provar). Mitigada de forma ampla + log de forma para fechar a dúvida. |
| **B / D** — "editada" / "apagada" no ImobFlux mas não no celular | Editar e apagar para todos mandam a chave da mensagem com `remoteJid` = JID guardado na conversa (13 dígitos). O WhatsApp conhece o chat pelo JID de 12 dígitos; a Evolution aceita o pedido (2xx) e o WhatsApp **ignora** uma chave de chat que não existe. O envio de texto funcionava porque manda só o número e a Evolution descobre o JID. Além disso o app marcava "editada"/"apagada" já no 2xx, **sem confirmação**. | **Muito provável** (a diferença 13 × 12 dígitos está nos dados). Vale para **qualquer** conversa criada pelo ImobFlux com contato de JID sem o 9, não só o "consigo mesmo". |
| **B'** — o celular "não oferece editar" a mensagem enviada pelo ImobFlux | Não confirmado. Pode ser limitação do WhatsApp para mensagens enviadas por dispositivo vinculado ou consequência da chave errada. | **Sem evidência**: ficou como ponto do reteste; a tela já não promete (mostra "aguardando confirmação do WhatsApp"). |
| **C** — edição no celular não aparece no ImobFlux | O webhook não assinava `MESSAGES_EDITED` nem `MESSAGES_DELETE` (ver tabela). Além disso o leitor só entendia o formato `protocolMessage` direto/`editedMessage` simples. | **Confirmada** (assinatura) + leitor ampliado. |
| **E** — 👍 do ImobFlux não chega ao celular | Mesma chave com JID errado do `sendReaction`. | **Muito provável**. |
| **F** — reação duplicada ("duas pessoas") | A reação do **membro** (CRM) e a da **conta** (celular) eram linhas diferentes; a do celular nunca substituía a do CRM e o clique não "enxergava" a reação da conta. A "janela de eco" de 2 min só cobria um caso. | **Confirmada** pelo modelo de dados e reproduzida em teste. |
| **G** — menu cortado embaixo | O menu era `position:absolute` dentro da lista de mensagens (com rolagem e corte). | **Confirmada** no código; reproduzida em teste. |
| **H** — "onde edito/apago a nota?" | O cartão "Notas internas" do painel **não tinha botões**; na conversa os botões eram só ícones de 13 px. | **Confirmada**. |

## O que foi corrigido

1. **JID real nas ações (B, D, E)** — antes de editar, apagar para todos ou reagir, o app confirma o JID real do chat com `POST /chat/whatsappNumbers/{instância}` (cache de 10 min; grupo e `@lid` não são consultados; se a consulta falhar, usa o JID guardado) e usa a chave certa (`remoteJid`, `id`, `fromMe`). *Arquivo*: `lib/supabase/gateway-actions.ts`.
2. **Honestidade de estado (B, D)** — o ImobFlux só muda a mensagem **depois** de a Evolution aceitar; falha da Evolution **não** altera nada e mostra o motivo, com **"Tentar de novo"** (no diálogo de apagar; na edição o texto fica na caixa). Depois do aceite a mensagem mostra **"· aguardando confirmação do WhatsApp"** até o evento de volta chegar (edição/exclusão da mesma mensagem), quando a marca some. Banco: coluna `messages.wa_pending_action`.
3. **Webhook assina edição e exclusão (C)** — `MESSAGES_EDITED` e `MESSAGES_DELETE` passaram a fazer parte da assinatura; em **Configurações > WhatsApp** há o cartão **"Edição e exclusão feitas no celular"** (estado e botão **"Ativar avisos de edição e exclusão"**, que reaplica o webhook **sem** QR e sem mexer no número).
4. **Leitor do webhook tolerante (A, C)** — nome do evento em qualquer caixa (`MESSAGES_EDITED`, `messages-edited`…), camadas embrulhadas (`deviceSentMessage`, `ephemeralMessage`, visualização única, `editedMessage`), `contextInfo` em qualquer tipo de mensagem **e** no nível do evento, citação de mídia (imagem, vídeo, documento, áudio, figurinha), trecho da original vindo do evento quando ela não está no banco, reação com `@lid` + telefone alternativo. O desconhecido é **ignorado sem erro** e nunca vira mensagem nova.
5. **Reação única da conta (F)** — a nossa conta é **uma** pessoa: reagir pelo ImobFlux ou pelo celular é a **mesma** reação; a nova **substitui** a anterior; remover (pelo ImobFlux ou pelo celular) tira a reação, sem fantasma; clicar na reação da conta alterna (a leitura marca como "minha"). A migration também **limpa duplicatas** já gravadas (mantém a do membro, que tem autoria; em produção hoje não há nenhuma).
6. **Menu sem corte (G)** — o menu e o seletor de emoji abrem num **portal** com detecção de colisão: viram para cima quando falta espaço embaixo, rolam por dentro se a janela for muito baixa e nunca saem das laterais (1440, janela baixa e 390).
7. **Notas internas (H)** — botões **escritos** "Editar" e "Apagar" na própria nota e no **cartão do painel do cliente** (autor: ambos; dono: Apagar em qualquer nota), 44 px no toque, **confirmação em diálogo** ao apagar; a nota nunca vai ao WhatsApp (testado).
8. **Diagnóstico sem conteúdo (Parte 0.3)** — linhas de log com **só a forma** do payload (nomes das chaves e tipos, nunca valores) para edição, exclusão, reação, citação e o que foi ignorado, mais o status HTTP e o formato da resposta das chamadas à Evolution (ver o mini roteiro).

## Migration (1, só local, aditiva, com pgTAP e rollback)

`20260802006300_message_actions_post_test` — coluna nula `messages.wa_pending_action`; `CREATE OR REPLACE` de `commit_message_edit`, `private.apply_message_deletion`, `begin_message_reaction`, `commit_message_reaction`, `ingest_whatsapp_reaction` e `get_conversation_messages` (mesmas assinaturas e permissões; a leitura **só acrescenta** o campo `wa_pending_action`; "minha" passa a incluir a reação da conta) e limpeza das reações duplicadas. **Compatível com o app que está em produção** (o app antigo ignora o campo novo). pgTAP: `message_actions_post_test` (26 testes) e os testes antigos de reação ajustados à regra nova; rollback testado: `docs/rollback/20260802006300_rollback.sql` (devolve as definições anteriores e remove a coluna).

> **Numeração**: esta migration usa `006300`. As migrations do Pacote Noite (`006300`–`006500`) **precisam ser renumeradas** para `006400`–`006600` quando a `feat/pacote-noite` for rebaseada (ver o fim deste documento).

## Limites conhecidos (não escondidos)

- **Confirmação do WhatsApp depende da Evolution**: se a Evolution v2.3.7 não emitir `MESSAGES_EDITED`/`MESSAGES_DELETE` para o que o próprio ImobFlux fez, a marca "aguardando confirmação do WhatsApp" **fica** (é o estado honesto: aceito pela Evolution, sem retorno). O reteste dirá.
- **Item B'** (celular não oferece editar mensagem enviada pelo ImobFlux): pode ser limite do WhatsApp para dispositivo vinculado. A tela não promete.
- **Formato real dos eventos de edição/exclusão/citação**: os testes usam fixtures montadas a partir do contrato do Baileys/Evolution (os logs reais expiraram). O reteste com o log de forma permite trocá-las por payloads reais anonimizados.
- **Cache do JID** (10 min): se o contato trocar de formato de número, a primeira ação depois pode usar o JID antigo por até 10 min (raríssimo).
- **Reação de outro membro**: como a conta é uma só, a reação de um membro **substitui** a de outro membro (é o que o WhatsApp faz).

## Testes

| Camada | Resultado |
|---|---|
| Lint e tipos | limpos |
| Unitários (Node 22 e Node 24) | **602 testes** passando nos dois (novos: `webhook-pos-teste` 30, `menu-flutuante` 5, JID real 3, eventos do webhook e ações do dono 7; ajustados 2 testes antigos de assinatura do webhook) |
| Build com variáveis falsas de CI | ok (`next build`) |
| pgTAP (`supabase test db`) | **44 arquivos, 1.369 testes** passando (novo: `message_actions_post_test` 26; ajustados 3 testes antigos de reação à regra de "uma reação por conta") |
| Navegador — **suíte nova** `correcoes-mensagens` (JID real, pendente/confirmado, edição/exclusão/citação/reação do celular, menu em 3 tamanhos, cartão dos avisos do WhatsApp, notas) | **10/10** |
| Navegador — **regressão completa** (auth-flow, collaboration-hotfix, conversations, demo-mode, functional-hotfix, grupos-e-propria, inbox-realtime, mensagens-pacote, prazos, quick-replies, send-files, send-queue, sprint23-*, sprint24-blocob-polish, team-management) | **todas passando**: auth-flow 17, collaboration-hotfix 4, conversations 13, demo-mode 1, functional-hotfix 3, grupos-e-propria 7, inbox-realtime 3, mensagens-pacote 14, prazos 7, quick-replies 8, send-files 11, send-queue 2, sprint23-conversations-evolution 7, sprint23-hotfix 5, sprint24-blocob-polish 14, team-management 3 (rodadas uma por vez; a rodada foi feita antes do último commit, que só mexeu na assinatura do webhook e na tela Configurações > WhatsApp, cobertos pelos unitários e pela suíte nova) |
| Fake Evolution | passou a responder `POST /chat/whatsappNumbers` (JID real configurável) |

## Depois da publicação (ordem)

1. **Trava A** (banco): backup → `migration list` (só `006300` pendente) → dry-run → "autorizo" → `db push` → validação somente leitura → apagar backup.
2. **Trava B** (app): checklist → merge `--ff-only` → push → CI → Vercel Ready → smoke test somente leitura.
3. **Você**: em **Configurações > WhatsApp**, clique em **"Ativar avisos de edição e exclusão"** (o selo deve virar **Ativos**). Isso só atualiza a assinatura de eventos na Evolution; não pede QR nem desconecta o número.

## MINI ROTEIRO DE RETESTE (5 minutos — gera a evidência que faltou)

Faça na conversa consigo mesmo, **logo depois do clique acima** e **avise assim que terminar** (os logs da Vercel só duram ~30 min; eu leio as linhas `[evolution-action]`, `[webhook-shape]` e `[webhook-event]`, que **não têm texto de mensagem**):

1. No ImobFlux, envie `r1`. Menu da mensagem (agora abre inteiro, sem rolar) → **Editar** → `r2` → Enter. **Celular**: a mensagem mudou? Anote. No ImobFlux: aparece "editada · aguardando confirmação do WhatsApp"; em ~30 s some?
2. No ImobFlux, envie `r3` e use **Apagar para todos** → confirmar. **Celular**: sumiu?
3. No ImobFlux, reaja com 👍 a uma mensagem. **Celular**: apareceu a reação?
4. No **celular**, reaja com ❤️ à mesma mensagem: no ImobFlux fica **uma só** reação (❤️), sem duplicar.
5. No **celular**, envie `r4` e **edite** para `r5`: no ImobFlux a mensagem muda e fica "editada"?
6. No **celular**, **responda** (deslizar) a `r2`: no ImobFlux aparece o cartão de citação?
7. No **celular**, **apague para todos** o `r5`: no ImobFlux fica "apagada"?
8. Nota interna: no ImobFlux crie uma nota; abra **Dados do cliente** (ícone no cabeçalho): no cartão da nota estão **Editar** e **Apagar**.

## ROTEIRO DE TESTE REAL — itens ainda não testados (com outra pessoa ou outro chip)

- **9. Apagar a mensagem do cliente**: peça para o cliente apagar uma mensagem dele para todos → no ImobFlux fica "Esta mensagem foi apagada" (e, agora, depende de `MESSAGES_DELETE` ativo).
- **10. Reação do cliente**: o outro chip reage a uma mensagem sua → aparece com o nome dele, separada da sua; ele remove → some.
- **14. Encaminhar**: menu → Encaminhar → escolha uma conversa → confirme; a mensagem chega no outro chat; repita com um arquivo.
- **15. Áudio de voz**: microfone → gravar 5 s → ouvir → enviar: chega como mensagem de voz tocável; cancelar no meio não envia; negar a permissão do microfone mostra o aviso.
- **6ª fixação**: fixe 5 conversas e tente a 6ª: o app avisa o limite de 5.

## Como rebasear a `feat/pacote-noite` na nova `main` (depois que este pacote for publicado)

```bash
git checkout feat/pacote-noite
git rebase main
```

Conflitos esperados e como resolver:
- **Migrations**: as do Noite usam `20260802006300`, `006400` e `006500` (e `docs/rollback/*`). Renomeie **nesta ordem** (evita colisão) com `git mv`: `…006500_global_search.sql`→`…006600_global_search.sql`, `…006400_quick_reply_attachments.sql`→`…006500_…`, `…006300_today_overview.sql`→`…006400_today_overview.sql`; renomeie os `docs/rollback/2026080200630{0,4,5}_rollback.sql` do mesmo jeito e ajuste as menções nos relatórios do Noite (`RELATORIO_PACOTE_NOITE.md`, `ROADMAP`, `STATUS`).
- **`components/conversations/message-bubble.tsx`**: o Noite usa a *folha de baixo* (`BottomSheet`) em tela compacta; este pacote usa o `FloatingMenu`. Mantenha **as duas**: `FloatingMenu` no desktop e `BottomSheet` quando `useIsCompact()`; `data-testid="message-menu"` nos dois. As reações "mine" agora incluem a conta.
- **`components/conversations/messages-panel.tsx`**, **`client-context-panel.tsx`**, **`note-bubble.tsx`**: mantenha os dois conjuntos de mudanças (Noite: duas telas/⋯/folhas; este pacote: notas com Editar/Apagar e `wa_pending_action`).
- **`tests/mensagens-pacote.spec.ts`**: o Noite pode ter ajustes de seletor; mantenha a versão deste pacote (menu em portal) e confira o do Noite (`celular.spec.ts`, `atalhos.spec.ts`) que abrem o menu.
- **pgTAP de segurança** (`auth_bootstrap`, `contact_operations`, `owner_rls`): esta migration não cria funções novas, então as contagens de `SECURITY DEFINER` do Noite (96/119) continuam as mesmas depois do rebase.
- Depois: `npx supabase db reset`, `npx supabase test db`, lint, tipos, unitários (Node 22 e 24), build e a regressão de navegador; só então a Trava A/B do Noite.
