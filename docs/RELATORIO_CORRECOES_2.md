# Relatório — Correções 2 (pós-reteste) — branch local `fix/mensagens-pos-reteste`

> Estado: **pronto e testado localmente; NADA publicado.** Parte da `main` (`5c7c1ba`). **Sem migration**: para publicar basta a
> **Trava B** (app). Depois dela, **um clique do dono** em Configurações > WhatsApp (o cartão vai mostrar "Desativados" porque
> passou a faltar o evento `MESSAGES_UPDATE`; clique em **"Ativar avisos de edição e exclusão"**).

## Evidência dos logs (capturados às 19:13 de 16/10, antes de expirar; recorte em `%TEMP%\logs-reteste\all.jsonl`, fora do repositório)

Linhas relevantes do período do reteste (só formas, sem valores):

| Hora (UTC) | Linha | O que mostra |
|---|---|---|
| 22:03:10 | `[evolution-action] whatsappNumbers http=200 found=true stored_digits=13 real_digits=12 changed=true` | **Confirmado**: o JID guardado (13) difere do real (12) e a correção o troca antes de editar. |
| 22:03:11 / 22:05:01 | `updateMessage http=200`, `deleteMessageForEveryone http=201 … has_key_id=true` | A Evolution aceita; agora com a chave certa o celular reflete (você confirmou). |
| 22:05:56–22:06:18 | `sendReaction http=201` ×3 | Reação do ImobFlux enviada (chegou no celular). |
| 22:06:08 | `[webhook-shape] … kind=reaction shape={key:{remoteJid,remoteJidAlt,fromMe,id,participant,addressingMode},message:{reactionMessage:{key,text,senderTimestampMs:{low,high,unsigned}}},…}` | Formato **real** da reação (identidade `@lid` + `remoteJidAlt`); é reconhecido. |
| 22:07:54 | `[webhook-shape] … kind=quoted shape={key:{…},message:{conversation},contextInfo:{mentionedJid,groupMentions,statusAttributions,stanzaId,participant,quotedMessage:{conversation},quotedType},messageType,…}` + `[webhook-event] citação ligada resolved=true from_me=true` | **Causa do item A confirmada**: a citação do celular vem em `data.contextInfo` (nível do evento), com a mensagem só `conversation`. |
| 22:03:47 | `[webhook-shape] … kind=ignored-non_text_message_ignored shape={…message:{secretEncryptedMessage:{targetMessageKey:{remoteJid,fromMe,id},encPayload:{0..23},encIv:{0..11},secretEncType:n}}…}` | 36 s depois do `updateMessage`: o **eco da edição** chega como `messages.upsert` com uma mensagem **cifrada** (`secretEncryptedMessage`). O app a ignora porque não tem como ler o texto. |
| **22:06:18 → 22:07:54** e **depois de 22:07:55** | **nenhuma linha** (nem `webhook-shape`, nem `ignorado event=…`) | Nos intervalos em que você editou (5) e apagou (7) no celular, **nenhum evento chegou ao webhook**. |

## Causa raiz dos itens 5 e 7 (edição e exclusão feitas no CELULAR)

Classificação pedida: **(a) a Evolution não enviou nada ao webhook** — comprovado pelos logs: `MESSAGES_EDITED`/`MESSAGES_DELETE`
não aparecem (nem como evento ignorado); só chegaram upserts (reação, citação e o eco cifrado da edição do ImobFlux). Isso **não é**
(b) formato desconhecido (qualquer evento desconhecido teria deixado `[webhook-event] ignorado` ou `[webhook-shape]`) **nem** (c)
desencontro de chave (não houve evento para casar).

O que **não** dá para provar com estes logs: *por que* a Evolution não enviou. Duas possibilidades, que o app agora ajuda a separar:
1. **O webhook da conexão ainda não assina os eventos** (o clique do dono pode ter sido anterior à janela de 30 min dos logs, então não há
   `[evolution-action] webhook/set …` para conferir) — o cartão em Configurações > WhatsApp mostra "Ativos/Desativados".
2. **A Evolution v2.3.7 não emite esses eventos para o que o celular faz** e o WhatsApp novo entrega edição **cifrada**
   (`secretEncryptedMessage`, como no eco acima), que só o Baileys/Evolution consegue abrir. Se for isso, o app **não tem como ler o novo
   texto** com o que a Evolution entrega hoje — seria preciso uma versão da Evolution/Baileys que decifre, ou outro caminho (limite, abaixo).

O que foi feito sem inventar: (1) o app passa a assinar **também `MESSAGES_UPDATE`** (alguns builds entregam edição/exclusão por ele) e o
leitor entende `messages.update` com `protocolMessage`/`editedMessage` e com status de apagada (recibos de entrega/leitura são ignorados em
silêncio); (2) **log de forma de todo evento** relevante (`[webhook-event] recebido event=… type=… resultado=… from_me=…`, e a forma
completa dos de edição/exclusão/reação/citação/ignorados), para o reteste curto abaixo fechar a dúvida na primeira tentativa.

## O que foi corrigido

1. **Marca "aguardando confirmação do WhatsApp" eterna (1b)** — nova regra: depois que a Evolution aceita, a bolha mostra **"· enviada ao WhatsApp"
   por no máximo 60 s** (conta a partir da hora da edição/exclusão) e depois fica normal ("editada"/"apagada"). Se o evento de volta chegar antes, a
   marca sai na hora. **Bolhas antigas** (19:02 e 19:04 e quaisquer outras com a pendência gravada) **deixam de mostrar a marca**, sem escrever
   nada no banco de produção. Falha/recusa da Evolution continua virando erro com "Tentar de novo". Sem migration.
2. **Nota interna ilegível no tema claro (N)** — causa: o app **não tem tema escuro** na `main`, mas as classes `dark:` do Tailwind seguiam o
   modo escuro do **sistema/navegador**; com o sistema escuro o texto da nota ficava **claro sobre fundo claro** (contraste medido **1,02:1**, reproduzido
   em teste). Correção: `@custom-variant dark` passa a valer só com a classe `.dark` (que nada aplica nesta versão) e `color-scheme: light` na raiz. O
   cabeçalho "Nota interna · Só a equipe vê", o autor, a hora e os botões Editar/Apagar (na nota e no cartão do painel) ficam ≥ 4,5:1; a hora da nota
   passou a usar `amber-900`. O tema escuro **de verdade** continua na `feat/pacote-noite` (usa a mesma linha `@custom-variant`, sem conflito).
3. **Outros componentes com cores fixas (item 4)** — o mesmo defeito atingia **23 usos de `dark:`** em 10 arquivos (chips de prazo âmbar, "comercial/privada"
   do cabeçalho, "Salvo" das configurações, destaque da busca, aviso da nota, avisos da página Prioridades…): todos ficavam com texto claro sobre fundo
   claro com o sistema em modo escuro. A correção global acima cobre todos; nada mais precisou ser tocado.
4. **Citação "Equipe" (pedido extra)** — mensagem da **nossa conta enviada pelo celular** não tem membro identificado; o cartão de citação (e o
   "Respondendo a…") agora mostra **"Você"** para o dono e "Equipe (celular)" para os demais; mensagens enviadas pelo ImobFlux continuam com o nome de
   quem enviou. Sem migration (ajuste na tela).
5. **Edição/exclusão do celular** — leitor ampliado (`messages.update`), logs de forma e a assinatura `MESSAGES_UPDATE` (ver a causa raiz). Fixtures dos testes
   **trocadas/complementadas por formas reais anonimizadas** dos logs (citação em `data.contextInfo`, reação `@lid` com `remoteJidAlt`, `secretEncryptedMessage`).

## Limites (sem esconder)

- **Edição do celular pode ser impossível de ler**: se o WhatsApp entrega a edição cifrada (`secretEncryptedMessage`) e a Evolution não a decifra, o ImobFlux
  não recebe o texto novo. Nesse caso a alternativa é uma versão da Evolution/Baileys que decifre, ou o dono reeditar/conferir manualmente. O reteste dirá.
- **Exclusão do celular**: depende de a Evolution emitir `MESSAGES_DELETE` (ou `protocolMessage REVOKE` no upsert). Os logs novos mostram qual chega.
- A marca "enviada ao WhatsApp" é **informativa** (60 s); ela não prova que o celular refletiu — só que a Evolution aceitou.

## Testes

| Camada | Resultado |
|---|---|
| Lint, tipos | limpos |
| Unitários Node 22 / 24 | **608 testes** passando nos dois (novos: formas reais de produção, `messages.update`, eventos do webhook) |
| Build (variáveis fake de CI) | ok (`next build`, variáveis falsas de CI) |
| pgTAP | não houve mudança de banco (44 arquivos continuam os mesmos) |
| Navegador — suíte `correcoes-mensagens` | **13/13** (novos: marca some em 60 s e bolhas antigas sem marca; citação "Você"; nota com contraste AA com o navegador em modo escuro — **vermelho antes** (1,02:1), verde depois) |
| Regressão das suítes antigas e de mensagens | **todas passando**, uma por vez: auth-flow 17, collaboration-hotfix 4, conversations 13, demo-mode 1, functional-hotfix 3, grupos-e-propria 7, inbox-realtime 3, mensagens-pacote 14, prazos 7, quick-replies 8, send-files 11, send-queue 2, sprint23-conversations-evolution 7, sprint23-hotfix 5, sprint24-blocob-polish 14, team-management 3 |

## MINI RETESTE (3 minutos) — depois da Trava B e do clique em "Ativar avisos…"

Na conversa consigo mesmo, **avise ao terminar** (eu leio os logs em até 30 min; agora com `[webhook-event] recebido …` para todo evento):
1. No **celular**, envie `s1`, **edite** para `s2`. No ImobFlux: mudou e ficou "editada"? (Se não mudar, **não é erro seu**: os logs mostram se a edição chegou cifrada.)
2. No **celular**, envie `s3` e **apague para todos**. No ImobFlux: ficou "apagada"?
3. No ImobFlux edite uma mensagem sua: a marca "· enviada ao WhatsApp" aparece e **some em ~1 min**; as bolhas antigas (19:02/19:04) **não** têm mais marca.
4. Crie uma nota interna: texto escuro sobre fundo claro (mesmo com o sistema em modo escuro), com Editar/Apagar visíveis. Responda (no celular) a uma mensagem enviada pelo celular: a citação mostra **"Você"**.
