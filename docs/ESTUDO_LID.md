# Estudo: identificador `@lid` do WhatsApp

> Só leitura do código e dos documentos. Nada foi implementado, nenhum dado de produção foi consultado. O que depende de ver o tráfego real da Evolution está marcado como **a confirmar**.

## 1. O que é o `@lid`
O WhatsApp está trocando o endereço "telefone" (`5582988880000@s.whatsapp.net`) por um identificador opaco por conta (`218943875198110@lid`, "Linked ID"), para esconder o telefone em alguns contextos (principalmente grupos e comunidades, e cada vez mais conversas individuais). O mesmo contato pode aparecer com **dois endereços**: o `@lid` e o telefone. Nas mensagens que chegam com `@lid`, a Evolution costuma mandar o telefone em chaves alternativas: `key.remoteJidAlt` (conversa individual) ou `key.senderPn` (remetente em grupo), junto com `addressingMode: "lid"`. Isso já foi visto no tráfego real do ImobFlux (reação, `docs/RELATORIO_CORRECOES_2.md`). **A confirmar**: com que frequência as mensagens de texto/mídia individuais chegam assim hoje, e se `remoteJidAlt` vem sempre.

## 2. Situação atual no código

| Ponto | O que acontece com `@lid` hoje | Onde |
|---|---|---|
| Webhook, mensagem nova | `remoteJid` é repassado como está para a RPC `ingest_whatsapp_text_message` (`p_remote_jid`). **`remoteJidAlt`/`senderPn` não são lidos** nas mensagens de texto/mídia. | `app/api/webhooks/whatsapp/route.ts`, `lib/conversations/webhook.ts` |
| Webhook, reação | **Já usa** `remoteJidAlt`/`senderPn` para achar o telefone (único lugar). | `lib/conversations/webhook.ts` (`parseSpecialMessage`) |
| Ingestão no banco | `normalize_brazilian_phone(split_part(jid,'@',1))` aceita 12 a 15 dígitos como "internacional": um `@lid` de 15 dígitos **vira um contato com telefone falso** (ex.: `+218943875198110`). Com "só cadastrados" ligado, não casa com ninguém e é **ignorado** (contado em `unknown_contact`). | `20260802005600_self_conversation_ingest.sql`, `20260802003500_harden_brazilian_phone_length.sql`; admitido em `docs/RELATORIO_WHATSAPP_PESSOAL.md` |
| Conversa | Chave `(conexão, external_thread_id)` com o JID bruto. O mesmo cliente por `@lid` e por telefone vira **duas conversas**. | `conversations.external_thread_id` |
| Envio | `formatPhoneForEvolution` devolve `null` para `@lid` → erro `INVALID_RECIPIENT` ("o número desta conversa não serve para envio"). Ou seja, **a conversa nasce, mas não dá para responder**. | `lib/supabase/gateway.ts` |
| Ações (editar/apagar/reagir) | `@lid` não é consultado em `whatsappNumbers`; usa o JID guardado. | `lib/supabase/gateway-actions.ts` |
| Avisos (Web Push) | Funcionam por conversa; um contato duplicado gera aviso duplicado em conversas distintas. | `get_push_targets` |

### 2.1 Duplicação e perda de histórico
- Cliente conversa pela primeira vez por `@s.whatsapp.net` e depois a Evolution passa a entregar por `@lid` (ou o contrário): nascem **dois contatos e duas conversas**. O histórico, as notas, as tarefas e as oportunidades ficam no primeiro; as mensagens novas caem no segundo, sem vínculo. É a "perda de histórico" na prática (os dados existem, mas separados).
- O contato falso `+<15 dígitos>` aparece na lista de Contatos sem telefone real; não dá para responder; o atendente não sabe quem é, a não ser pelo nome do perfil (`pushName`).

### 2.2 JID de 13 x 12 dígitos (nono dígito)
Celulares brasileiros antigos têm 12 dígitos (`55 DD XXXXXXXX`) e os novos 13 (`55 DD 9XXXXXXXX`). O WhatsApp às vezes guarda o JID do jeito antigo mesmo para um número que hoje tem 9 dígitos.
- No modo normal, a busca do contato é por **igualdade exata** do número normalizado (`contact_points.normalized_value = v_normalized_phone`). Um contato cadastrado com 13 dígitos e uma mensagem que chega com JID de 12 (ou o contrário) **não casam** e criam um segundo contato.
- No modo "só cadastrados" já existe tolerância: `private.phone_match_candidates` (com/sem o 9) é usada na ingestão. Essa tolerância **não está** no caminho normal.
- No envio, `resolveChatJid` pergunta à Evolution (`/chat/whatsappNumbers`) qual é o JID real e usa o que ela devolve; isso resolve o envio, mas não unifica contatos.

## 3. Como unificar com segurança

### Opção A — Resolver o telefone na entrada (recomendada como primeiro passo)
1. No leitor do webhook, para `remoteJid` terminado em `@lid`, usar `remoteJidAlt` (ou `senderPn`) como identidade de telefone quando existir, e **guardar o `@lid` como alias** (nova tabela/coluna `contact_aliases`/`external_identities`).
2. Na RPC de ingestão: nunca normalizar o número de um `@lid` como telefone; se não houver telefone alternativo, **não criar contato com telefone falso**: criar o contato provisório "sem telefone" ligado ao `@lid` (ponto de contato do tipo `whatsapp_lid`) ou ignorar e contar (decisão do Mário).
3. Aplicar a tolerância do nono dígito (`phone_match_candidates`) também no caminho normal, escolhendo o contato existente mais antigo.
- Prós: corrige a causa (identidade) e o contato falso; poucas mudanças no front.
- Contras: exige migration (alias/ponto de contato) e mudar uma RPC crítica da ingestão (pgTAP forte; a RPC está no caminho de toda mensagem).

### Opção B — Mapa de identidades (`@lid` ⇄ telefone) aprendido com o tráfego
Guardar cada par visto (`remoteJid` + `remoteJidAlt`) numa tabela e, ao chegar só o `@lid`, consultar o mapa. Cobre o caso em que o telefone só aparece em algumas mensagens. É a Opção A com memória; recomendada junto com ela.

### Opção C — Consultar a Evolution (`/chat/whatsappNumbers`, `/chat/findContacts`)
Pedir à Evolution o telefone de um `@lid`. **A confirmar** se a versão instalada na VPS resolve `@lid` → telefone (o código atual deliberadamente não consulta `@lid`). Mais acoplada e mais lenta; só como reforço.

### Opção D — Não fazer nada além de "só cadastrados"
Com `ingest_only_known_contacts` ligado, o `@lid` é ignorado (sem dado falso). Serve enquanto o número está em testes; **não serve** quando for desligado no lançamento (ver `docs/PROCEDIMENTO_LANCAMENTO_INGESTAO.md`).

### Unificar o que já existe (migração de dados)
Depois da Opção A, uma rotina **manual e revisada** (nunca automática): lista de pares de contatos prováveis duplicados (mesmo nome de perfil + um deles com telefone falso de 14–15 dígitos ou nono dígito diferente), tela de "Mesclar contatos" com confirmação, que move conversas/mensagens/notas/tarefas/oportunidades para o contato principal e arquiva o outro. Mesclar conversas exige cuidado com a ordem das mensagens e com `external_thread_id` (precisa manter os dois JIDs como identidades da mesma conversa).

## 4. Recomendação
Fazer **A + B** em um pacote só, em duas etapas: (1) leitura de `remoteJidAlt`/`senderPn` e fim do contato com telefone falso (a parte de menor risco e maior valor, inclui o nono dígito no caminho normal); (2) alias de identidade e a tela de mesclar. Antes de implementar, **coletar amostras reais** (somente a *forma* do evento, sem texto: a rotina `[webhook-shape]` já existe) por alguns dias para ver `remoteJidAlt` em mensagens individuais.

## 5. Riscos
- **Mesclar errado** dois clientes diferentes (mesmo nome de perfil): por isso a mescla é manual e reversível só por backup; sugerir "desfazer" é caro.
- **Mudar a RPC de ingestão** afeta todo o recebimento: precisa pgTAP vermelho→verde, rollback e Trava A com backup.
- Contatos `@lid` sem telefone nunca poderão receber mensagem enviada pelo CRM (`INVALID_RECIPIENT`) até existir telefone ou a Evolution aceitar o `@lid` como destino (**a confirmar**; o WhatsApp aceita `@lid` como destino em versões novas do Baileys).
- O comportamento do WhatsApp muda sem aviso; o leitor deve continuar tolerante e logar só a forma.

## 6. Esforço estimado
| Etapa | Esforço |
|---|---|
| Coleta de amostras (sem código novo, só observar `[webhook-shape]`) | 0,5 dia de espera + leitura |
| A (leitura de `remoteJidAlt`, sem contato falso, nono dígito no caminho normal) + testes + migration + rollback | 1,5 a 2 dias |
| B (tabela de identidades + preenchimento) | 1 dia |
| Tela de duplicados / mesclar contatos | 2 a 3 dias |

## 7. Decisões que o Mário precisa tomar
1. Mensagem recebida por `@lid` **sem** telefone alternativo: criar contato provisório sem telefone (aparece em Contatos como "Contato sem número") **ou** ignorar e contar?
2. Aceitar a mescla de contatos duplicados como recurso do app (com confirmação), ou só um relatório para conferir à mão?
3. O que fazer com os contatos de telefone falso que já existirem em produção (arquivar, mesclar quando houver telefone, ou deixar)? Isto exige olhar o banco de produção, o que este estudo **não** fez.
4. Autoriza uma janela de coleta de amostras reais antes de implementar?
