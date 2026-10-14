# Relatório: pacote de ajustes da tela de Conversas (branch `fix/conversas-pacote`)

Feito **só no ambiente local**, sem push, sem tocar na `main` e **sem aplicar nada em produção**. A migration nova só foi aplicada em
bancos locais descartáveis.

> **Parado aguardando a sua autorização expressa** para o passo de produção (backup, dry-run, push da migration, merge, push, deploy).

## (a) Causa da lentidão ao trocar de conversa, com números

**Medição.** Banco local com volume parecido com um escritório ocupado: 230 conversas e 19.230 mensagens (20 conversas com 600
mensagens). Duas medições: (1) a sequência de consultas da página, uma a uma, com e sem latência de rede simulada; (2) o clique no
Chrome (do clique até as mensagens da conversa aparecerem), 12 cliques.

| O que se mediu | Antes | Depois |
|---|---|---|
| Consultas da troca de conversa, sem rede (mediana) | 1.331 ms, 14 idas ao banco, 8 níveis em sequência | **140 ms**, 10 idas, 3 níveis |
| O mesmo com 100 ms de latência por ida e volta | 2.240 ms | **483 ms** |
| Clique até a conversa aparecer, no navegador (mediana / máximo) | 1.566 ms / 1.999 ms | **~375 a 450 ms / 0,76 a 2,07 s** (3 execuções; com a página já assentada, 16 cliques seguidos ficaram entre 330 e 500 ms; o pior caso é o clique nos 2 primeiros segundos depois de carregar, enquanto a lista confirma o Realtime) |
| Tela mostra algo ao clicar | tela travada até terminar | esqueleto do painel na hora, lista continua na tela |

Em produção a conta é parecida: **o que pesa é o número de idas e voltas em sequência** (cada uma custa a latência entre a Vercel e o
Supabase). Com ~8 níveis em sequência, 5 s corresponde a ~600 ms por nível, o que é plausível para uma ida e volta com autenticação.

**Gargalos, por ordem de impacto:**
1. **A lista inteira era consultada duas vezes a cada clique.** A página buscava a lista (20 itens) e, para achar o cabeçalho da conversa,
   chamava de novo a lista com 100 itens. Essa consulta calcula todas as conversas do escritório: ~0,7 s cada com 230 conversas (e
   cresce junto com o número de conversas).
2. **Idas e voltas em sequência:** `getUser` do proxy, `getUser` da página, e depois **três consultas seguidas** só para saber quem é o
   usuário (usuário → vínculo → espaço de trabalho), mais uma rodada de dados e outra rodada (etapas do funil em duas consultas
   seguidas). 8 níveis.
3. **A lista era remontada a cada clique** (ela morava dentro da página, não no layout).
4. **A cada 2 s**, a conversa aberta disparava duas ações do servidor (mensagens e notas), mantendo a fila de ações do navegador
   ocupada e disputando com a troca de conversa.
5. **Enviar mensagem** pedia ao servidor para renderizar de novo a rota inteira (lista incluída) dentro da resposta do envio
   (`revalidatePath`): era uma parte dos ~2 s do envio.
6. **Abrir uma conversa não lida** fazia a lista inteira ser recarregada por uma ação do servidor (efeito colateral do Realtime da
   leitura), que atrasava o próximo clique.
7. Sem prefetch e sem estado de carregamento.

**Índices (EXPLAIN local).** As consultas de mensagens por conversa e a lista **já usam índice** (`idx_messages_conversation_cursor`,
`idx_messages_incoming_unread`). O custo restante é a avaliação das funções de acesso por linha (RLS) e a própria lista ser O(número de
conversas). **Nenhum índice novo é necessário** e por isso não há migration de índice.

## (b) O que mudou

### Parte 1: trocar de conversa
- **Lista persistente no layout** (`app/(app)/conversas/layout.tsx` + `ConversationsShell`): carregada uma vez, por streaming; trocar de
  conversa só renderiza o painel. A conversa selecionada vem da URL.
- **Uma consulta para o cabeçalho** (`get_conversation_item`, migration): a mesma linha da lista, só desta conversa (inclusive não lida
  e SLA), sem projetar as outras.
- **Tudo que é independente sai junto**, inclusive em paralelo com a verificação de sessão (os dados continuam protegidos pela RLS;
  se a sessão falhar a página redireciona). Só as oportunidades dependem do contexto e continuam depois.
- **Acesso do usuário em 1 consulta** (era 3 em sequência), com as mesmas regras (usuário ativo, vínculo ativo OWNER/ATTENDANT,
  espaço de trabalho ativo) e cache por requisição (layout e página dividem o resultado).
- **Esqueleto na hora** (`[conversationId]/loading.tsx`) e **prefetch** ao passar o mouse, focar ou tocar no cartão.
- **Verificação a cada 15 s** (antes 2 s) enquanto o Realtime está conectado; sem Realtime continua a cada 2 s.
- **Sem `revalidatePath` no envio** (a tela já atualiza sozinha) e **sem recarregar a lista por mudança de leitura**: o contador
  "Não lidas" é ajustado na hora no cliente.
- As mensagens recentes já vinham em páginas de 50 (o resto sob demanda, "Carregar anteriores").

**Envio otimista (item 5).** A bolha aparece na hora como "Enviando…" (medido: ~50 ms), a caixa é limpa e a bolha vira a mensagem gravada
quando o servidor responde. Se falhar, a bolha provisória sai, a mensagem gravada aparece como **"Não enviada"** (agora há marcação de
estado na bolha), o texto volta para a caixa e o motivo aparece com código curto. **Eco do webhook:** a tela esconde a linha de origem
WhatsApp que repete uma mensagem enviada pelo CRM (mesmo texto, mesmo instante, janela de 90 s). Não dá para deduplicar pelo `key.id`
na tela porque a lista de mensagens não traz o identificador externo; o banco já deduplica pelo `key.id` quando o eco chega depois da
confirmação, e o caso de corrida (eco antes) fica coberto pela regra de tela. Nada é apagado do banco.

### Parte 2: contador de espera
- **Regra única** em `lib/conversations/sla-display.ts` (`describeConversationSla`), usada pela lista, pelo cabeçalho e por Prioridades; o
  Kanban recebe o mesmo efeito pelo banco. O contador continua nos dois sentidos ("Cliente aguardando há X" nos tons verde/âmbar/
  vermelho e "Aguardando cliente há X" cinza).
- **"Encerrar/resolver" = arquivar.** Não existe outra ação de fechar: o botão de arquivar do cabeçalho já faz isso (`archived_at`) e
  tira a conversa da lista principal. **Decisão tomada (me corrija se não for o que você quer):** conversa **arquivada fica sem chip em
  nenhum lugar** (lista de arquivadas, cabeçalho, Prioridades, Kanban, contadores de atrasadas), como você sugeriu.
- **Reabertura (migration):** mensagem do **cliente** numa conversa arquivada a reabre (individual e grupo), com evento de auditoria do
  sistema (`conversation.reopened`) e o contador volta. Mensagem **nossa** (enviada pelo celular) não reabre; histórico importado também
  não. Antes isso **não** acontecia (a conversa arquivada continuava arquivada).
- **Última mensagem válida:** resposta que **falhou** não conta como resposta (a conversa continua "cliente aguardando"), histórico
  importado não conta, bolha provisória não conta. A prévia da lista continua mostrando a última mensagem de verdade.
- Kanban: card sem SLA quando a conversa vinculada está arquivada ou só tem mensagem que falhou.

### Parte 3: mídia e espaço
- **Figurinha** (webp com nome `figurinha` ou rótulo "Figurinha", sem migration): até 140 px, sem bolha, sem legenda, só o horário.
- **Foto e vídeo:** altura máxima 280 px (desktop) e 220 px (celular), proporção preservada, espaço reservado até carregar (a rolagem não
  pula); **clique abre ampliado** (Esc, clique fora e botão fechar); vídeo ganhou "Ampliar". PDF: visualização reduzida
  (60% da altura, máx. 480 px). Áudio e documento já tinham tamanho razoável e não mudaram.
- **Espaço:** "Responsáveis / Atribuir a" foi para o cabeçalho (compacto); cabeçalho e caixa de digitação mais baixos; a caixa começa
  com 1 linha e cresce até ~5; a rolagem abre no final e **continua no final enquanto a mídia carrega** (corrigido no E2E).
  Desktop 1440×900: cabeçalho **57 px** (era uma linha de cabeçalho + uma de responsáveis), caixa de digitação **103 px** (era ~150),
  área de mensagens **676 px de 900** (75%). Celular 390×844: cabeçalho **105 px**, área de mensagens **560 px de 844**.

## (c) Roteiro de teste em produção (depois da publicação)
1. Abrir Conversas e clicar em 5 conversas seguidas: o painel deve abrir em menos de 1 s percebido, com o esqueleto aparecendo na hora
   e a lista parada no lugar.
2. Passar o mouse sobre uma conversa e clicar: deve abrir ainda mais rápido (prefetch).
3. Enviar uma mensagem para o contato de teste: a bolha "Enviando…" aparece na hora e vira a mensagem; o celular recebe; **não** pode
   aparecer uma segunda bolha igual quando o eco chegar.
4. Enviar com a Evolution recusando não é fácil de forçar em produção: basta conferir que a mensagem enviada com sucesso não fica "Não
   enviada".
5. Contador: conversa aberta com a última do cliente mostra "Cliente aguardando há X" (cor por tempo); responder muda para "Aguardando
   cliente há X". **Arquivar** a conversa: o chip some da lista de arquivadas, do cabeçalho e de Prioridades. Pedir ao contato de
   teste que escreva de novo: a conversa volta sozinha para a lista com "Cliente aguardando".
6. Mídia: pedir ao contato de teste uma figurinha, uma foto vertical e um vídeo: figurinha pequena sem bolha; foto/vídeo limitados;
   clicar abre ampliado; Esc fecha.
7. Celular: abrir uma conversa e conferir a altura da área de mensagens e que a rolagem fica no final.

## (d) Riscos, decisões e dúvidas
- **Migration** `20260802005100_conversas_pacote.sql` (só funções, nada apagado): `get_conversation_item` (nova), `get_conversations_inbox`
  (campos `sla_*`), `get_kanban_board`, as duas funções de ingestão (reabertura), `ingest_whatsapp_history_batch` (histórico não reabre) e
  `queue_outgoing_text_message` (veja o próximo item). **Ordem de publicação: migration primeiro, app depois** (o app novo chama
  `get_conversation_item` e lê `sla_*`; sem a migration a tela de conversa não abre). Rollback testado:
  `docs/rollback/20260802005100_rollback.sql`.
- **Descoberta importante no E2E (corrigida): o envio não pode ler `channel_connections` com a chave de serviço do app** (ela não tem
  `SELECT` nessa tabela; só o OWNER lê pelo usuário). A primeira versão da correção do envio (publicada em `c335377`) lê a instância
  assim e, no banco real, **cai na variável `EVOLUTION_INSTANCE_NAME`**; se ela não existir na Vercel, o erro "falta a instância" volta.
  Agora a instância é decidida **dentro do banco**, na função que enfileira a mensagem (`queue_outgoing_text_message` devolve
  `instance_name`), e o app só interpreta. **Isso significa que o envio em produção só fica independente da variável depois desta
  migration.** Enquanto isso, o atalho continua sendo `EVOLUTION_INSTANCE_NAME` na Vercel.
- **Reabrir ao receber mensagem do cliente** parte da decisão "arquivar = encerrar". Se você usa arquivar para esconder contatos que
  não quer ver, eles vão reaparecer quando escreverem de novo (como no WhatsApp). Diga se prefere outro comportamento.
- **Não rodei as suítes de navegador antigas** (`test:auth`, `tests/*.spec.ts` que dependem de ambiente descartável de autenticação):
  elas assumem a estrutura antiga (lista dentro da página, polling a cada 2 s). Vale rodá-las em ambiente descartável antes de
  publicar. O que foi verificado no navegador é o E2E novo (34 verificações) descrito abaixo.
- A leitura de **outro aparelho/aba** da mesma pessoa (marcar como lida) deixa de recarregar a lista sozinha; ela sincroniza na próxima
  mensagem/atualização. Troca por menos carga.
- A lista continua O(número de conversas) no banco (~0,7 s com 230 conversas): agora roda uma vez por carga/atualização, não por clique.
  Quando o volume crescer, o item **M2** (custo do `get_conversations_inbox`) deve ser atacado.
- O "máximo" de tempo do clique é o primeiro clique após carregar a página (a frio).
- `@lid`, exclusão real de contato e Evolution/VPS seguem como pendências do relatório do WhatsApp pessoal.

## Testes
| Verificação | Resultado |
|---|---|
| pgTAP, banco **novo e limpo**, todas as migrations do zero | **33 arquivos, 1.008 testes, PASS** (46 são do arquivo novo `conversations_pacote`) |
| Unitários (Node 24 e Node 22) | **427 passando** nas duas versões (eram 401) |
| Lint, tipos | sem erros (Node 24 e 22) |
| Build com as variáveis falsas do CI | ok |
| E2E no navegador (app compilado + Supabase local + Evolution falsa) | **34/34** |
| Rollback da migration (suíte anterior depois dele) | a suíte anterior (da `main`, 32 arquivos, 962 testes) **passa** depois do rollback |

O E2E cobre: figurinha, foto vertical/horizontal, ampliar/fechar (Esc e fora), espaço (desktop e celular), caixa que cresce, envio
otimista, formato v2 e instância do banco, eco do webhook sem bolha duplicada, falha com motivo e texto de volta, reenvio sem duplicar,
chips nos dois sentidos, arquivar sem chip, reabertura por mensagem do cliente (lista e Prioridades) e auditoria.

## Commits
Veja `git log main..fix/conversas-pacote`.
