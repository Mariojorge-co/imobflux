# Relatório — Pacote: envio de arquivos, fila de envio, prazos configuráveis, grupos e ajustes

Branch `feat/pacote-arquivos-prazos` (a partir da `main` em `f6e7e30`). **Nada foi enviado, mesclado, publicado nem aplicado em produção.** As 4 migrations novas (`20260802005300` a `20260802005600`) só rodaram em banco local descartável. Ordem de publicação: **migrations primeiro (Trava A), app depois (Trava B)**.

## O que foi feito, por parte

**Parte 0 — mapeamento (somente leitura).** Achados que explicam o relato do dono:
- Os limites estavam fixos no código (`lib/conversations/sla.ts`): "Cliente aguardando" verde < 10 min, amarelo < 15, laranja < 30, vermelho < 24 h, vermelho grave depois; "Aguardando cliente" recente < 3 h, ≤ 24 h, ≤ 48 h e follow-up acima disso.
- O painel "Aguardando cliente / Follow-up" de Prioridades só incluía conversas com `minutesWaiting >= 24*60` (por isso a conversa de ~20 h não aparecia) **e** só olhava as 50 conversas mais recentes (`getConversationsList({limit: 50})`). O texto "Não há conversas paradas há 24 horas" era fixo.
- Grupos: `ingest_groups` (padrão desligado) decide se grupos entram; grupo nasce `owner_only`; o dono libera com `set_group_team_visibility` (auditado); atendente só vê o liberado e só o que veio depois; remetente protegido fica oculto (migration 003600). "Tudo" já listava grupos.
- Conversa consigo mesmo: o webhook tratava como individual comum; no modo "só cadastrados" o próprio número era ignorado (`unknown_contact`).

**A1 — Vídeo.** Mesmo limite da foto (maior lado 220 px desktop / 180 px celular), proporção preservada; miniatura com ícone de play e o clique abre o lightbox (que toca). Constantes e teste atualizados.

**A2 — Auditoria.** Migration `005300`: `get_audit_events` aceita as categorias `quick_reply`, `sla` e `message` (alteração retrocompatível: só amplia a lista). Rótulos em português para respostas rápidas, pausa/desativação/reativação de prazo, mudança de limites, envio de arquivo e liberação/restrição de grupo; categorias "Respostas rápidas", "Prazos" e "Mensagens" no filtro. Nenhum evento novo cai em "Outros".

**B — Caixa não bloqueia ao enviar.** `lib/conversations/send-queue.ts`: fila sequencial por conversa. Ao enviar, a bolha aparece como "enviando…", a caixa é limpa e liberada na hora e dá para digitar e enviar outra. Cada envio tem a própria chave de idempotência. Os envios de uma conversa saem **um de cada vez, na ordem**; a falha de um não trava os seguintes: a bolha vira "não enviada" com o motivo e "Tentar de novo" (nova mensagem, nova chave). **Nunca reenvia sozinho.** Sem bolha duplicada: a provisória é substituída uma a uma pela versão gravada (inclusive a falha gravada, que herda o motivo) e o eco do webhook é reconhecido (por id externo no banco e, na tela, por texto/instante).

**C — Envio de arquivos.** Clipe (no celular abre câmera/galeria/arquivos), arrastar e soltar sobre a conversa (área destacada; soltar fora dela não faz o navegador abrir o arquivo) e Ctrl+V. Até 10 por vez, 25 MB cada. Pré-visualização com miniatura/ícone, nome, tamanho, barra de progresso, cancelar/remover, legenda opcional (imagem, vídeo, documento) e, para imagem, "enviar como documento (sem compressão)". Upload **direto do navegador para o Storage privado** por URL assinada de um único caminho (não passa pela função da Vercel). O servidor revalida **por conteúdo (bytes mágicos)**, tamanho real e permissão, bloqueia executáveis/scripts (inclusive disfarçados) e só então enfileira e envia pela Evolution com URL assinada de 10 min. Mesmo componente das mídias recebidas, estados enviando/enviada/falhou com motivos distintos e "tentar de novo". Usa a mesma fila da Parte B (arquivos primeiro, na ordem da bandeja, depois o texto da caixa). Varredura de uploads órfãos pronta (`npm run sweep:uploads`, simulação por padrão).

**D — Prazos.** Migration `005500`. Limites por workspace (Configurações > Prazos, só o dono): "Cliente aguardando" (verde/amarelo/laranja/vermelho; padrão = valores atuais 10/15/30 min e 24 h) e follow-up em três níveis (padrão 6 h, 24 h, 72 h), validados no app e no banco. Botão no cabeçalho de cada conversa individual com três estados: ativo, **pausar até o cliente falar de novo** (volta sozinho quando chega mensagem do cliente depois da pausa) e **desativar (permanente)**; quem tem acesso à conversa controla; tudo auditado. **Uma única regra no banco** (`private.sla_applies`) alimenta lista, cabeçalho, Kanban e Prioridades; `calculateSLA` é a única função de cálculo no app. Prioridades agora lê **todas** as conversas com prazo (`get_sla_conversations`), usa o 1º nível de follow-up como corte, agrupa por urgência, exclui grupos, conversa consigo mesmo, arquivadas e pausadas/desativadas, e o texto vazio acompanha o limite ("Nenhuma conversa parada há mais de 6 h"). Nenhuma mensagem automática é enviada ao cliente.

**E — Grupos.** Leitura de grupos segue sob `ingest_groups` (desligada por padrão; o teste confirma que com ela desligada nada é gravado). Dono vê todos em "Tudo", com marca neutra "Grupo" e indicador de não lida, sem chip de prazo. Controle "Liberar para a equipe / Restringir ao dono" no cabeçalho do grupo (agora visível também no celular) e visão geral em **Configurações > Grupos**. Contato protegido continua oculto mesmo em grupo liberado; sem retroativo. **Bug encontrado e corrigido:** toda conversa de grupo aparecia como "Grupo WhatsApp" na lista (o assunto vindo do banco era descartado); agora aparece o nome do grupo.

**F — Conversa consigo mesmo.** Migration `005600`: no modo "só cadastrados" o número da própria conexão conta como conhecido; a mensagem entra **uma vez** (dedupe por id externo), cria no máximo um contato "Mensagens para você" e qualquer outro número desconhecido continua ignorado. Nunca tem prazo nem controle de prazo. Testado com payloads simulados (fromMe com remoteJid igual ao número), com o envio pela tela e com o eco.

## Migrations (todas locais, com rollback testado em `docs/rollback/`)

| Migration | Conteúdo | Tipo |
|---|---|---|
| `20260802005300_audit_new_categories` | `get_audit_events` aceita 3 categorias novas | recria 1 função (assinatura igual; só amplia) |
| `20260802005400_outgoing_media` | `queue_outgoing_media_message`, `record_outgoing_media_sent`, `list_orphan_outbound_uploads` | 3 funções novas |
| `20260802005500_sla_settings_and_pause` | 2 colunas com padrão em `conversations`; tabela `workspace_sla_settings` (RLS, sem linhas); 6 funções novas; recria `get_conversations_inbox`, `get_conversation_item`, `get_kanban_board` (mesmas assinaturas e campos; só acrescenta campos e deixa `sla_*` nulo quando não há prazo) | aditiva + 3 recriações retrocompatíveis |
| `20260802005600_self_conversation_ingest` | `ingest_whatsapp_text_message` reconhece o próprio número | recria 1 função (assinatura e retorno iguais) |

**Prova de compatibilidade com o app atual (`f6e7e30`)** — feita em banco local descartável:
1. **Comparação de esquema** (`pg_dump`, banco até a 005200 × com as 4 novas): nenhum objeto removido; as únicas linhas alteradas são as recriações listadas acima (a lista de categorias de `get_audit_events`; as duas linhas de `sla_*` e o acréscimo de campos no JSON das listas; o trecho do próprio número em `ingest_whatsapp_text_message`). Todo o resto são adições (1 tabela, 2 colunas com padrão, 9 funções, 1 policy, 1 gatilho).
2. **Rollbacks em ordem inversa** (5600 → 5500 → 5400 → 5300): o esquema volta **idêntico** ao da 005200 (diff vazio).
3. **Suíte pgTAP do app atual (`f6e7e30`, 34 arquivos, 1062 testes)**: contra o banco com os rollbacks aplicados passa 100%; contra o banco **novo** passa tudo, exceto 4 asserções de **inventário** (contagem de funções `SECURITY DEFINER` 69→75 e 84→92 em três arquivos, e tabelas com `set_updated_at` 14→15), que enumeram as novidades e foram atualizadas na branch.
4. **Suítes de navegador do app atual contra o banco novo**: ver "Testes" abaixo.

## Contrato da Evolution v2.3.7 (confirmado no código-fonte oficial, sem enviar nada)
Fonte: `EvolutionAPI/evolution-api` tag `2.3.7` (`sendMessage.dto.ts`, `sendMessage.router.ts`, `message.schema.ts`, `whatsapp.baileys.service.ts`).
- Rota: `POST /message/sendMedia/{instance}` (as rotas `sendWhatsAppAudio` e `sendPtv` existem para nota de voz/vídeo redondo; **não usadas**).
- Corpo (`SendMediaDto`, schema exige `number` e `mediatype`): `number`, `mediatype` ∈ `image | video | audio | document`, `mimetype?`, `fileName?`, `caption?`, `media` (**URL ou base64**), mais opções (`delay`, `quoted`…). Resposta com `key.id` (guardado como id externo).
- A Evolution **baixa o arquivo pela URL** (`axios` para imagem; Baileys para os demais): por isso a URL assinada precisa ser alcançável pela internet e durar o suficiente (10 min).
- **Imagem enviada como `image` é sempre recomprimida em JPEG** pela Evolution (força `image/jpeg`); por isso o "enviar como documento (sem compressão)" usa `mediatype: "document"` com o mimetype original.
- `fileName` é obrigatório na prática para `document` (a Evolution tenta extrair da URL e falha se não casar); o app sempre envia.

**O que só um envio real prova** (a Evolution e o WhatsApp são simulados nos testes): (1) que o servidor da Evolution de produção alcança a URL assinada do Supabase e baixa 24 MB dentro do tempo; (2) como o WhatsApp exibe documento/vídeo/áudio (ícone, nome, legenda); (3) se o áudio chega como arquivo de áudio (é o que `mediatype: audio` faz) e não como nota de voz; (4) HEIC/HEIF; (5) o tempo de resposta do `sendMedia` com arquivo grande frente ao `maxDuration` de 60 s da Vercel; (6) a ordem real do eco (`fromMe`) em relação à resposta HTTP.

## Decisões que tomei
1. **Bucket:** reaproveitei o bucket privado `whatsapp-media` (mesmo modelo de privacidade da mídia recebida, mesma rota autorizada `/api/attachments/[id]`, limite de 25 MB já configurado). Mantive **sem policies de usuário** em `storage.objects`: o navegador nunca lê nem grava direto; só recebe do servidor uma URL de upload assinada para **um** caminho `<workspace>/<conversa>/out/<uuid>` depois de o servidor confirmar o acesso à conversa. A função de banco ainda exige que a chave do arquivo esteja dentro do workspace e da conversa da mensagem. Testado: token de um caminho não grava em outro, leitura pública/anônima falha.
2. **Upload ao escolher o arquivo** (não ao enviar), para o envio ser rápido; o botão Enviar espera os uploads. Arquivos saem antes do texto da caixa, cada arquivo é uma mensagem (legenda por arquivo); áudio sem legenda.
3. **Tipos:** lista de permitidos por extensão **e** conteúdo. Além dos executáveis/scripts pedidos, bloqueei também `html`, `htm`, `svg`, macros (`docm`, `xlsm`, `pptm`), `iso`, `dmg`, instaladores e linguagens de script (`py`, `php`…). `json`, `xml`, `md`, `log`, `csv`, `txt` entram como texto.
4. **Legenda** limitada a 1024 caracteres; **rótulo** da mensagem sem legenda igual ao do recebimento ("📷 Imagem", "🎬 Vídeo", "🎧 Áudio", "📄 Documento: nome") para o eco ser reconhecido.
5. **Tentar de novo de arquivo** copia o arquivo no Storage para um caminho novo (um arquivo só pode estar em uma mensagem). "Imagem como documento" é lembrada pelo rótulo.
6. **Falha de texto não devolve mais o texto à caixa** (pedido da Parte B): a bolha fica "não enviada" com "Tentar de novo".
7. **A fila é do navegador** (por conversa, durante a sessão). Se a aba for fechada com envios ainda na fila (ainda não despachados), eles se perdem; nunca são reenviados sozinhos.
8. **Follow-up:** os níveis antigos (3 h/24 h/48 h) foram substituídos pelos três pedidos (6/24/72 h) com tons amarelo/laranja/vermelho; "urgente" (contagem no Kanban) continua só para a equipe devendo resposta.
9. **Pausa/desativação:** quem tem acesso à conversa pode (dono e atendente); só o dono edita limites. Grupo e conversa consigo mesmo recusam a mudança (não há prazo para controlar).
10. **Prioridades** passou a ler até 500 conversas por uma função própria (antes: só as 50 mais recentes).
11. **Grupos:** não mudei o mecanismo de privacidade; só a interface (rótulos, celular, visão geral) e o nome do grupo. A visão geral lê até 500 grupos.
12. **Conversa consigo mesmo:** cria um contato "Mensagens para você" uma única vez (necessário para existir a conversa). Esse contato aparece em Contatos.
13. **`maxDuration = 60`** na página da conversa (o envio de arquivo espera a Evolution baixar e entregar o arquivo). Depende do plano da Vercel permitir 60 s.
14. **Contagens de inventário do pgTAP** foram atualizadas (75 funções definer públicas, 92 no total, 15 tabelas com `updated_at`).

## Testes (checklist completo do STATUS_PROJETO.md)
- **Lint, tipos e unitários**: limpos em **Node 24 e Node 22**; 522 testes unitários (novos: fila de envio, bolhas/eco, validação de arquivos por conteúdo, ações de envio com Storage/Evolution simulados, contrato do `sendMedia`, prazos/limites/pausa, rótulos de auditoria). **Build** de produção com as variáveis falsas do CI: ok (rotas novas `/configuracoes/prazos` e `/configuracoes/grupos`).
- **pgTAP completo**: 39 arquivos, **1196 testes** passam (novos: `audit_new_categories` 9, `outgoing_media` 35, `sla_settings` 59, `self_conversation_ingest` 13, `groups_visibility` 18; cada um visto vermelho antes de verde). 4 contagens de inventário atualizadas.
- **Suítes de navegador (cópia descartável, Supabase local, Evolution simulada)**: todas as suítes passam: 113 testes na execução completa; 3 deles precisaram ser tratados: dois testes antigos dependiam das regras que esta entrega muda de propósito (Prioridades com corte fixo de 24 h/50 conversas e os níveis antigos de follow-up) e foram atualizados; o terceiro (paginação do histórico) é instável no ambiente e passou na repetição. Novos E2E: fila de envio (2), envio de arquivos (11), prazos (7), grupos e conversa consigo mesmo (7).
- **App atual (`f6e7e30`) contra o banco novo** (as 4 migrations aplicadas): todas as suítes de navegador do app atual passam (80 + 13 do arquivo `conversations`, repetido porque o teste "OWNER carrega inbox…" é instável **também no banco antigo**, 1 falha em 2 execuções sem as migrations novas). Os testes pgTAP do app atual passam 100% contra o banco com rollback e, contra o banco novo, só falham as 4 contagens de inventário.
- **Verificação visual** em 1440 px e 390 px: bandeja de arquivos, menu de prazo, bolha "enviando…", Configurações > Prazos, Configurações > Grupos e Prioridades (ajustes feitos: grupos legíveis no celular e bandeja limitada a 35% da altura).
- **Rollbacks** das 4 migrations aplicados em ordem inversa: esquema volta idêntico ao da 005200.


## Roteiro de teste real em produção (depois da publicação)
1. **Foto** pelo clipe: miniatura, legenda, enviar; chega no WhatsApp do cliente; bolha vira "enviada". Repetir arrastando e colando (Ctrl+V).
2. **PDF** com legenda; **.rar pequeno**; **vídeo curto**; conferir como aparecem no WhatsApp.
3. **Arquivo de 24 MB** (deve enviar; observar o tempo) e **um de 26 MB** (deve ser recusado na hora com a mensagem de 25 MB).
4. **Um .exe** (e um `.jpg` que na verdade é programa) devem ser bloqueados.
5. **3 mensagens seguidas, rápido:** caixa livre, ordem correta no WhatsApp, sem bolha duplicada; desligar a internet no meio de uma e ver só ela ficar "não enviada" + "Tentar de novo".
6. **Prazo:** pausar uma conversa (some a tarja e sai de Prioridades), pedir ao cliente (ou outro número) uma mensagem e ver o prazo voltar; desativar (permanente) e reativar.
7. **Configurações > Prazos:** mudar os limites, ver a cor da lista e o painel de Prioridades acompanharem; restaurar padrões.
8. **Grupos:** ligar a leitura em Configurações > WhatsApp só se o dono quiser; ver os grupos em Conversas e em Configurações > Grupos; liberar um para a equipe e conferir com o atendente (só o que vier depois; contato protegido oculto); restringir de novo.
9. **Conversa consigo mesmo:** mandar um arquivo para o próprio número ("Mensagens para você") e ver entrar uma vez, sem tarja de prazo.

## Riscos e pendências
- **Migrations antes do app:** o app novo chama as funções novas (`queue_outgoing_media_message`, `get_sla_*`, `set_conversation_sla_mode`…) e lê campos novos; publicar o app antes das migrations quebra envio de arquivo, Prioridades e Configurações > Prazos.
- **Eco de arquivo antes da confirmação:** se a Evolution entregar o eco (`fromMe`) antes de o servidor gravar o id externo, o banco pode ter uma segunda linha da mesma mensagem; a tela esconde esse eco (mesmo rótulo e anexo). Só o envio real mostra a frequência disso.
- **Tempo do envio de arquivo grande** em plano Vercel com limite menor que 60 s; e a Evolution precisa alcançar a URL assinada.
- **Nota de voz** não é enviada como voz (fora do escopo); gravação por microfone, envio em grupo, envio em massa e anexos em respostas rápidas **não foram feitos**, como pedido.
- **Uploads órfãos** ficam no Storage até a varredura (`npm run sweep:uploads -- --apply`); sem agendamento automático (pendência).
- Recebimento de **mídias grandes** continua como antes (não alterado).
- Atalho de prazo: grupos/`@lid` e a leitura de grupos seguem como estavam (desligada por padrão).

## Trava A (banco) — executada em 2026-10-15 (migrations 20260802005300 a 005600)

Autorizada pelo dono, só o banco; o app **não** foi publicado (Trava B pendente, separada).

**Verificações antes de aplicar**
1. As 5 funções recriadas (`get_audit_events`, `get_conversations_inbox`, `get_conversation_item`, `get_kanban_board`, `ingest_whatsapp_text_message`) têm assinatura e retorno `jsonb` **idênticos** antes e depois (005200 × final). A comparação de esquema mostra só 10 linhas alteradas: a lista de categorias do filtro de auditoria (amplia); as duas linhas de `sla_*` em lista e cabeçalho (agora nulas em grupo, conversa consigo mesmo e prazo pausado/desativado) e o acréscimo de campos no JSON; o trecho do próprio número em `ingest_whatsapp_text_message`. O app atual ignora os campos novos e já trata `sla_*` nulo. Única diferença visível para o app atual: grupos deixam de mostrar a tarja de prazo (regra pedida).
2. Bucket `whatsapp-media` em produção (somente leitura): **privado**, `file_size_limit = 26214400` (25 MB), sem restrição de tipo MIME (o tipo é decidido pelo servidor, por extensão e conteúdo), **0 policies** em `storage.objects`. No código: (a) o caminho é `<workspace>/<conversa>/out/<uuid>` gerado no servidor, nunca o nome do arquivo; (b) a URL de upload é assinada para um único caminho (a de outro caminho é recusada, testado) e expira pelo padrão do Supabase (2 h; não configurável nessa chamada); (c) arquivo reprovado na validação (tipo por conteúdo, tamanho, executável) é apagado do Storage na hora (`remove`), e o descarte pela bandeja também. Uma legenda acima de 1024 caracteres é recusada antes de inspecionar e deixa o arquivo para a varredura de órfãos.
3. As 4 migrations não têm nenhum INSERT/UPDATE/DELETE fora de função; as tabelas novas nascem vazias com RLS ligado.

**Produção**
1. Backup (esquema 412 KB + dados 144 KB, fora do repositório); `migration list`: só as 4 pendentes; `db push --dry-run` listou só elas; `db push --linked` aplicou sem erro (52 → 56 de 56, sem pendências).
2. Validação somente leitura:
   - Funções novas: definer com `search_path=""` (exceto `get_sla_conversations`, invoker, de propósito); `authenticated` executa as de uso do app; `list_orphan_outbound_uploads` e `record_outgoing_media_sent` só `service_role`; `anon` nunca.
   - `workspace_sla_settings`: RLS ligada, 1 policy de leitura, `anon` sem leitura, `authenticated` sem INSERT, **0 linhas**. Colunas novas em `conversations`: `sla_mode` (`'active'`, não nulo) e `sla_paused_at`; 0 conversas fora do modo ativo.
   - Contagens das 14 tabelas existentes medidas imediatamente antes e depois do push: **idênticas**.
   - Esquema de produção antes × depois (dump): só as 10 linhas alteradas acima (sem remoções fora delas) e o restante adições.
   - Telas do app atual lidas como o dono em transação somente leitura (sem login, sem escrita): Conversas (5 itens, campos antigos e novos), cabeçalho da conversa, Kanban (6 etapas) e Prioridades (painel e 4 conversas com prazo) respondem sem erro.
3. Backup apagado (sem cópias restantes). `EVOLUTION_INSTANCE_NAME` na Vercel mantida (não tocada).
