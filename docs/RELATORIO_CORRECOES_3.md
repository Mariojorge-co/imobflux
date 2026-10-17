# Relatório — Correções 3 (edição do celular, duplo clique e foco) — branch local `fix/mensagens-3`

> Estado: **pronto e testado localmente; NADA publicado.** Parte da `main` (`b8d7b8d`). **Sem migration**: para publicar basta a
> **Trava B** (app). Não é preciso reaplicar o webhook de novo (os eventos já foram ativados no reteste).

## 1. Evidência dos logs (capturados às 20:21 de 16/10; recorte em `%TEMP%\logs-reteste2\recorte.txt`, fora do repositório)

| Hora (UTC) | Linha (só formas) | O que mostra |
|---|---|---|
| 23:06:26 | `[evolution-action] webhook/set … reaplicados` | O clique em "Ativar avisos…" **funcionou** (e a conexão agora assina também `MESSAGES_UPDATE`). |
| **23:07:36** | `event=messages.upsert type=secretEncryptedMessage from_me=true` — `message:{secretEncryptedMessage:{targetMessageKey:{remoteJid,fromMe,id},encPayload:{24 bytes},encIv:{12 bytes},secretEncType:n}}` | **A edição no celular (s1→s2) chega CIFRADA**, sem nenhum texto. O app a ignorava. |
| 23:09:23 | o mesmo formato, `from_me=false` | A edição **feita pelo cliente** também chega cifrada: seria perdida do mesmo jeito. |
| 23:09:57 | `event=messages.edited … shape={key:{remoteJid,fromMe,id},type:s}` (ignorado) | A Evolution manda `messages.edited` com **só a chave e um tipo — sem o texto novo**. |
| 23:09:57 | `event=messages.delete … shape={remoteJid,remoteJidAlt,fromMe,id,participant,addressingMode,status}` + `revoke aplicado status=success` | A exclusão chega em formato **plano** e é aplicada (por isso a exclusão por outra pessoa funcionou). |
| 23:09:24 e outras | `event=messages.update … shape={keyId,remoteJid,fromMe,status,instanceId,messageId}` | `messages.update` são **só recibos** (status): ignorados em silêncio. |

## 2. Causa raiz da edição no celular (item 5) — classificação

É o caso **(a), com um detalhe novo**: a Evolution **mandou** os eventos (não é "não chegou nada"), e o leitor **reconheceu** o evento, mas
**nenhum deles carrega o texto novo**: o upsert traz a edição **cifrada** (`secretEncryptedMessage`, `secretEncType` = edição de mensagem) e o
`messages.edited` traz só `{key, type}`. O leitor ignorava os dois ("não é texto") e por isso o ImobFlux nunca mudou. Não é desencontro de
chave (b): o alvo (`targetMessageKey.id` / `key.id`) é a mensagem certa.

**Saída implementada (sem mexer na Evolution em produção):** os dois eventos viram um **"sinal de edição"** (`edit_signal`) com o id da mensagem
editada. O webhook então **pergunta à Evolution o texto atual** daquela mensagem — `POST /chat/findMessages/{instância}` (**somente leitura**) —
e, se vier texto, aplica como edição do WhatsApp (marca "editada", guarda o texto anterior no histórico do dono, sem duplicar bolha). Tenta até
3 vezes com 1,2 s de intervalo (a Evolution pode demorar a gravar). Aceita as formas de resposta `{messages:{records}}`, `{records}` e lista, e
a edição aninhada (`protocolMessage.editedMessage`). Se a Evolution ainda não tem o texto, nada muda e a resposta é 200; o log registra
`[webhook-event] edit_signal consulta status=… forma=…` (só nomes de chaves) para sabermos o que a Evolution devolveu.

**O que NÃO está provado (e o reteste responde):** se a Evolution v2.3.7 **já guarda o texto editado** quando o aviso chega. A consulta funciona se
ela o guarda; se não guardar (ela só guarda a mensagem cifrada), o log mostrará `status=sem_texto` e a edição do celular continuará sem refletir.

**Alternativas, caso a consulta não traga o texto (propostas, nada feito em produção):**
1. **Decifrar nós mesmos**: a edição é cifrada com o segredo da mensagem original (`messageContextInfo.messageSecret`), que **chega** no webhook da
   mensagem original. Dá para guardá-lo e decifrar `encPayload`/`encIv` no servidor. É o caminho "certo" sem depender da Evolution, mas exige
   implementar o protocolo de derivação de chave do WhatsApp com **teste contra payloads reais** — por isso não foi feito às cegas.
2. **Atualizar a Evolution/Baileys** para uma versão que decifre edições e envie o texto no `messages.edited`.
3. **Limite assumido**: documentar que edições feitas no celular não refletem e orientar a conferir a mensagem.

**Conversa com OUTRA pessoa**: o mesmo código vale para a edição do cliente (o log mostra o mesmo formato com `from_me=false`); o mini reteste abaixo cobre isso.

## 3. Duplo clique para responder (desktop) e deslizar (toque)

- **Duplo clique em qualquer lugar da bolha** = Responder (cartão de citação acima da caixa), igual ao menu. A seleção de palavra do duplo clique é
  **limpa** (`getSelection().removeAllRanges()`); selecionar arrastando o mouse continua normal.
- **Não dispara** em: link, botão (menu, reações, tentar de novo…), campo de texto, mídia/anexo (marcados com `data-no-reply`), menu aberto,
  mensagem **apagada**, mensagem ainda "enviando", **edição em andamento**, **gravação de áudio em andamento** e **nota interna** (nota não tem resposta).
- **Celular/tablet: deslizar a bolha para a direita** (sem duplo toque, que conflita com o zoom): a bolha acompanha o dedo, aparece o ícone de
  resposta, vibração leve se o aparelho tiver; dispara com ≥ 56 px, bem horizontal e em menos de 0,9 s. A rolagem vertical continua do navegador
  (`touch-action: pan-y`; movimento vertical ou para a esquerda cancela). Testado com toques reais (CDP) em 390 px.
- **Acessibilidade**: o menu "Responder" continua. **Ajuda de atalhos ("?")**: ela só existe na `feat/pacote-noite` (parada); ao rebasear, acrescentar à
  lista `SHORTCUTS` de `components/global-shortcuts.tsx` a linha `Duplo clique na mensagem — Responder (no celular: deslize para a direita)`.

## 4. Foco direto no campo ao responder

Ao responder (menu, duplo clique ou deslize): se a pessoa estava na aba **Nota interna**, volta para **Mensagem**; o cursor vai **direto ao
campo** (sem clicar), com o **rascunho mantido e o cursor no fim**; no celular o foco usa `preventScroll` para o teclado subir sem empurrar a
rolagem. Testes: `document.activeElement` é o campo, dá para digitar na hora, Enter envia com a citação.

## 5. Limites

- A edição do celular só reflete se a Evolution **tiver o texto** (ver §2). Sem isso, as alternativas 1–3.
- O deslize usa eventos de toque do navegador: aparelhos/navegadores que tratem o gesto de "voltar" na borda esquerda não interferem (o deslize é
  para a **direita**, a partir da bolha).
- O duplo clique não se aplica em tela de toque (usa o deslize).

## 6. Testes

| Camada | Resultado |
|---|---|
| Lint, tipos | limpos |
| Unitários Node 22 / 24 | **619 testes** passando nos dois (novos: sinal de edição, formas reais, rota com `findMessages`, gesto de deslizar) |
| Build (variáveis fake de CI) | ok (`next build`) |
| pgTAP | sem mudança de banco |
| Navegador — `responder-gesto` (duplo clique, seleção, foco, rascunho, aba Nota, exceções, deslizar/rolar no celular) | **7/7** |
| Navegador — `correcoes-mensagens` (inclui a edição cifrada/sinal com fake-evolution `findMessages`) | **14/14** |
| Regressão das suítes antigas e de mensagens | **todas passando**, uma por vez: auth-flow 17, collaboration-hotfix 4, conversations 13, demo-mode 1, functional-hotfix 3, grupos-e-propria 7, inbox-realtime 3, mensagens-pacote 14, prazos 7, quick-replies 8, send-files 11, send-queue 2, sprint23-conversations-evolution 7, sprint23-hotfix 5, sprint24-blocob-polish 14, team-management 3. **Instabilidade registrada**: na rodada completa o teste 5 de `sprint23-conversations-evolution` ("Criação de Próxima Ação") estourou 5 s esperando o texto da tarefa aparecer; na repetição isolada passou 7/7 (compilação a frio/tempo de resposta do servidor de desenvolvimento; não mexe em nada deste pacote) |

## 7. MINI RETESTE (4 minutos) — depois da Trava B

Na conversa consigo mesmo **e** com outra pessoa/chip (avise ao terminar; eu leio os logs em até 30 min):
1. **Você, no celular**: envie `t1`, edite para `t2`. No ImobFlux: virou `t2` e "editada"? (Se não: o log `edit_signal consulta … sem_texto` confirma que a Evolution não guarda o texto.)
2. **Outra pessoa**: ela envia `u1` e edita para `u2`. No ImobFlux: `u2` "editada"?
3. **Duplo clique** numa mensagem (computador): abre a citação, **cursor no campo**, sem texto selecionado; digite e Enter envia com a citação.
4. Duplo clique num **anexo**, num **botão** e numa mensagem **apagada**: nada acontece.
5. **Celular**: deslize uma bolha para a direita: aparece o ícone e abre a citação, teclado pronto para digitar; rolar para cima/baixo continua normal.
