# Relatório: envio de mensagens pelo ImobFlux (branch `fix/envio-whatsapp`)

Feito **só no ambiente local**, sem push, sem tocar na `main`, **sem migrations** e **sem escrita em produção**. Nenhuma chamada à
Evolution real: os testes simulam as respostas.

> **Parado aguardando a sua autorização expressa** para o merge, o push e o deploy. A verificação **real** do contrato v2 só
> acontece com um envio de teste em produção para o seu contato de teste (veja o roteiro no fim).

## Causa do erro em produção
O envio chamava o gateway com o nome da instância **sempre vazio** e dependia da variável de ambiente `EVOLUTION_INSTANCE_NAME`,
que o fluxo novo de QR code não usa mais (ele cria a instância `imobflux-<workspace>`). Sem a variável, o gateway devolvia
`MISSING_INSTANCE`, que a tela traduzia como "WhatsApp ainda não está conectado", mesmo com a conexão `active` no banco. O envio
não consultava o status da conexão em nenhum momento.

## O que mudou

### A. Instância pelo banco ([lib/conversations/send-instance.ts](../lib/conversations/send-instance.ts))
- A instância vem de `channel_connections.external_account_id`. O id da conexão é o que a RPC `queue_outgoing_text_message`
  devolve (ela já verificou, com a sessão do usuário, que ele pode ver a conversa): **nada vem do navegador**.
- Ordem: conexão da própria conversa se estiver `active`; senão a conexão `active` do workspace (a conversa pode ter nascido numa
  conexão substituída); sem nenhuma ativa → `WHATSAPP_DISCONNECTED` e **nada é enviado**.
- `EVOLUTION_INSTANCE_NAME` virou só reserva, usada **apenas** quando o banco não pôde ser consultado. Conexão inexistente ou
  desativada nunca é "mascarada" pela reserva.
- **Decisão sobre o acesso:** a tabela de conexões só é legível pelo OWNER (RLS), mas o ATTENDANT também envia mensagens. Por isso a
  leitura usa o cliente administrativo, restrita a 4 campos (`id, workspace_id, status, external_account_id`) e ao id vindo da RPC.
  Sem migration não há RPC de leitura própria; essa é a opção mais simples que não abre a tabela ao ATTENDANT.
- Não existe outro caminho de envio: **não há envio de mídia pelo CRM** (só recepção), então não há `sendMedia` a conferir.

### B. Erros honestos e distintos ([lib/conversations/gateway-outcome.ts](../lib/conversations/gateway-outcome.ts))
| Situação | Código | O que o usuário lê (resumo) |
|---|---|---|
| Sem instância configurada | `NO_INSTANCE` | Falta a instância deste ambiente; conecte em Configurações > WhatsApp ou avise o técnico |
| Servidor da Evolution não configurado | `GATEWAY_NOT_CONFIGURED` | A integração não está configurada neste ambiente |
| Conexão inexistente/desativada | `WHATSAPP_DISCONNECTED` | O WhatsApp está desconectado; conecte e tente de novo |
| Evolution recusou (4xx/5xx) | `EVOLUTION_REJECTED` | Recusou o envio, com o código curto (ex.: `HTTP_400`); 401/403 avisam "chave de acesso recusada" |
| Tempo esgotado | `GATEWAY_TIMEOUT` | Demorou demais; **a mensagem pode ter saído, confira no celular antes de tentar de novo** |
| Falha de rede | `GATEWAY_NETWORK` | Falha de rede; não foi enviada |
| Destino inválido (grupo, lista, `@lid`) | `INVALID_RECIPIENT` | O número desta conversa não serve para envio |
| 200 sem id / resposta ilegível | `GATEWAY_ERROR` | Resposta inesperada; pode ter sido enviada, confira no celular |
- Frases fixas: **nunca** o corpo da resposta da Evolution, o texto da mensagem, o número do cliente, o endereço do servidor ou a
  chave. O log de falha leva só `{ code, gateway, messageId }`. Os testes verificam que nada disso aparece em resposta, log ou
  chamadas de reconciliação.
- A mensagem enfileirada fica `failed` (RPC existente). **O motivo não é gravado no banco**: a tabela `messages` não tem coluna para
  isso e você pediu nenhuma migration. O motivo vai ao usuário na hora e ao log (só o código). Se quiser o motivo persistido e
  visível depois na conversa, é uma migration pequena (coluna `failure_code`); ficou como proposta.
- **Reenviar sem duplicar:** a tela mantinha a mesma chave de idempotência depois da falha, e a repetição da chave devolve
  "falhou antes" sem enviar. Agora, depois de qualquer falha, o **próximo clique** do usuário usa uma chave nova (mensagem nova),
  e a que falhou permanece `failed` e nunca é reenviada sozinha. O servidor continua recusando repetir a mesma chave de uma
  mensagem que falhou (testado). Cuidado conhecido: depois de `timeout` a mensagem **pode** ter saído; a frase pede para conferir
  no celular antes de reenviar.

### C. Contrato `sendText` v2 ([lib/supabase/gateway.ts](../lib/supabase/gateway.ts))
- Corpo mudou de `{ number, textMessage: { text } }` (v1) para **`{ number, text }`** (v2). Resposta: `key.id` (aceita também o
  envelope `data.key.id`) é gravado em `messages.external_message_id` pela reconciliação.
- **Destino a partir do JID:** o envio passa o `external_thread_id` da conversa. Antes, os dígitos do JID entravam na regra de
  telefone digitado e um JID internacional de 10/11 dígitos (ex.: EUA) **ganhava um 55 indevido** e iria para outro número. Agora o JID
  é usado como veio (preserva o celular antigo de 12 dígitos sem o 9º dígito), com sufixo de dispositivo (`:12`) removido; grupo,
  transmissão, canal e `@lid` não são destino individual. O telefone digitado mantém as regras antigas (DDI 55, 10/11 dígitos).
- **Status de entrega (`MESSAGES_UPDATE`):** **não existe** hoje (o webhook assina só `MESSAGES_UPSERT`, `MESSAGES_SET` e
  `CONNECTION_UPDATE`). O identificador externo agora é gravado corretamente, então o casamento futuro fica possível.

## Testes (sem chamar a Evolution real)
- 24 testes novos em [tests/send-whatsapp.unit.spec.ts](../tests/send-whatsapp.unit.spec.ts): resolução da instância (ativa, substituída,
  inexistente, desativada, reserva), `sendMessageAction` ponta a ponta com a Evolution simulada por `fetch` (200/201 com id, 400, 401,
  500, timeout, rede, 200 sem id, destino inválido, reenvio, corrida com o eco), contrato do gateway e normalização do destino.
- Ajustados de propósito: 5 testes antigos que fixavam o corpo v1 e as frases/códigos antigos; o e2e de integração agora espera `text`.
- Resultado: unitários **401 passando** (eram 377), lint e tipos sem erros, **build ok**.

## Riscos e limites (leia antes do envio real)
1. **O contrato v2 não foi verificado contra a Evolution real.** Pelo meu conhecimento do v2.3.7 o corpo certo é `{ number, text }`,
   mas só o envio de teste confirma. Se a Evolution recusar, a tela mostrará `EVOLUTION_REJECTED` com o código (ex.: `HTTP_400`) e o log
   da VPS mostra o campo reclamado. O script `docker/evolution/scripts/test-phase1-validation.ps1` ainda usa o corpo antigo (não
   alterei: é validação local e não faz parte do app).
2. **Corrida com o eco do webhook (possível mensagem duplicada na tela).** Quando o app envia, a Evolution também entrega pelo webhook
   a mesma mensagem como "enviada por mim" (`fromMe`). Se o eco chegar **antes** da reconciliação, a ingestão cria uma segunda
   linha com o mesmo identificador externo e a reconciliação da mensagem do CRM bate no índice único (`23505`). Agora a ação trata isso:
   marca a mensagem do CRM como enviada **sem** o identificador (não fica presa na fila), mas a conversa pode mostrar **duas bolhas**
   iguais. A correção definitiva exige migration na ingestão (o eco "adotar" a mensagem enfileirada). Não fiz porque você pediu
   nenhuma migration; fica como proposta, e só vale decidir depois de ver se acontece no teste real.
3. Envio para **grupo** continua sem suporte (devolve "número inválido para envio"); grupos estão desligados por padrão.
4. `EVOLUTION_INSTANCE_NAME` na Vercel deixa de ser necessária (pode continuar como reserva).

## Roteiro do envio real de teste (depois da sua autorização de publicação)
1. Publicar (merge ff-only, push, deploy); eu faço só o smoke test de leitura.
2. Você envia **uma** mensagem curta pela conversa do seu contato de teste.
3. Esperado: bolha como enviada e a mensagem chega no celular dele. Se aparecerem **duas** bolhas iguais, é a corrida do item 2.
4. Se falhar, a frase na tela traz o motivo; e na VPS: `docker compose logs --since 10m evolution-api | grep -iE "sendText|Bad Request"`
   (cole só as linhas, sem chave).
