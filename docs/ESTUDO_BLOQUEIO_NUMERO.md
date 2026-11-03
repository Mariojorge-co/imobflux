# Estudo: bloquear um número

> Só leitura do código. Nada foi implementado, nenhuma chamada à Evolution foi feita e nenhum dado de produção foi consultado. O que depende da versão da Evolution instalada na VPS está marcado como **a confirmar**.

## 1. Situação atual
- **Não existe o conceito de "bloqueado"** no app nem no banco (busca por `bloquear`/`blocked` só acha textos sem relação).
- O que existe de parecido são filtros de ingestão por conexão (`channel_connections`): `ingest_groups` (grupos), `ingest_only_known_contacts` ("só números cadastrados") e `history_window_days`. Mensagens filtradas **não gravam nada** e só incrementam um contador agregado (`ignored_counts`: `group`, `unknown_contact`, `invalid_phone`), sem conteúdo nem número.
- Fluxo da mensagem: Evolution → `POST /api/webhooks/whatsapp` (valida o segredo, lê o formato) → RPC `ingest_whatsapp_text_message` (`service_role`) → contato/conversa/mensagem → aviso Web Push (`after()`).
- **Arquivar contato** esconde o contato, mas, fora do modo "só cadastrados", a mensagem nova do mesmo número **reaparece** (a ingestão procura o ponto de contato pelo número; veja `docs/ESTUDO_EXCLUSAO_CLIENTE.md`).

## 2. Duas coisas diferentes
| | Bloquear no ImobFlux | Bloquear também no WhatsApp |
|---|---|---|
| O que faz | O ImobFlux ignora o que chega desse número | O WhatsApp impede o número de mandar/ver (e o corretor não recebe nada) |
| Quem percebe | Só quem usa o CRM; o cliente não sabe | O cliente (some foto/visto por último, mensagens não chegam) |
| Reversível | Sim, na hora | Sim, mas o histórico do intervalo se perde |
| Efeito no celular do corretor | Nenhum | **O número fica bloqueado no celular dele** (mesma conta) |

### 2.1 Bloquear no ImobFlux (recomendado)
Desenho mínimo, **compatível** (só adiciona):
1. Tabela `blocked_numbers (workspace_id, normalized_value, created_by, created_at, reason?)` ou coluna `contacts.blocked_at` (mais simples, mas cobre só números que já são contato). Recomendo a tabela, porque permite bloquear um número que ainda não é contato.
2. Na RPC de ingestão, depois de normalizar o número: se está bloqueado, `return ignored/blocked` e contar `blocked` em `ignored_counts` (exige permitir o novo motivo em `count_ignored_whatsapp_message`). Aplicar também ao nono dígito (`phone_match_candidates`) e, quando existir, ao `@lid` já resolvido (`docs/ESTUDO_LID.md`).
3. Webhook: nenhuma mudança além de repassar a resposta `ignored` (já é o padrão). O que o webhook responde à Evolution **continua 200**.
4. Mensagens **enviadas pelo corretor** (`fromMe`) para número bloqueado: decidir (ver decisões).

### 2.2 Bloquear também no WhatsApp via Evolution
A Evolution v2 tem a chamada de bloqueio de contato (`POST /message/updateBlockStatus/{instância}` com `{ number, status: "block" | "unblock" }`). **A confirmar** a rota e o formato na versão instalada na VPS antes de qualquer promessa. Pontos de atenção:
- Exige a chamada partir do servidor com a chave da Evolution (a mesma já usada para envio); **falha não pode impedir o bloqueio local** (bloqueia no ImobFlux primeiro; o bloqueio no WhatsApp é "melhor esforço" com aviso se falhar).
- Se o número do ImobFlux for também o WhatsApp pessoal do corretor (caso atual do projeto, "WhatsApp pessoal"), **bloquear no WhatsApp bloqueia no celular dele também**. Precisa ser uma escolha explícita e separada.
- Desbloquear: simétrico, mas o WhatsApp não entrega retroativamente o que foi enviado durante o bloqueio.

## 3. Efeito sobre conversas existentes
Opções (a decisão é do Mário):
- **Congelar**: a conversa e o histórico ficam visíveis (somente leitura), sem entrar em Hoje/Prioridades nem em SLA, sem avisos. Reversível.
- **Arquivar a conversa** ao bloquear: some das listas; ao desbloquear, volta pela ação de desarquivar.
- **Manter ativa** (só ignora o que chegar depois). É o mais simples, mas deixa SLA correndo em uma conversa que ninguém vai responder.
Em qualquer caso: **não apagar nada** ao bloquear.

## 4. Efeito no webhook e nos avisos
- **Webhook**: continua respondendo 200 com `ignored` (nada de erro para a Evolution; evita reenvios). Mensagem ignorada não chama `after()`, então **nenhum Web Push** sai.
- **Avisos já existentes**: `get_push_targets` já descarta conversa arquivada. Se a conversa bloqueada for apenas "congelada" e não arquivada, é preciso incluir o filtro de bloqueado nessa função (mudança na seleção de destinatários, que hoje está congelada por decisão).
- **SLA/Hoje/Prioridades**: precisam do mesmo filtro para não cobrar resposta de quem foi bloqueado.
- **Envio pelo CRM** a número bloqueado: recomendo **recusar** com mensagem clara ("número bloqueado; desbloqueie para responder"), pois a Evolution enviaria normalmente se só o ImobFlux bloqueou.

## 5. Opções e recomendação
| Opção | Esforço | Risco | Observação |
|---|---|---|---|
| A. Só ImobFlux: tabela + filtro na ingestão + tela de lista de bloqueados + recusa de envio | 1,5 a 2 dias | Baixo (RPC crítica alterada, mas aditivo) | **Recomendada primeiro** |
| B. A + congelar/arquivar conversa existente + filtros em Hoje/SLA/avisos | +1 dia | Médio | Faz o bloqueio "sentir" completo |
| C. B + bloqueio no WhatsApp via Evolution | +0,5 a 1 dia | Médio (depende da Evolution; afeta o celular) | Só depois de testar a rota na VPS |

## 6. Riscos
- **Bloquear número errado** (nono dígito, contatos duplicados): aplicar a tolerância 12/13 dígitos e mostrar o contato antes de confirmar.
- **Mudar a RPC de ingestão** (caminho de toda mensagem): pgTAP vermelho→verde, rollback e Trava A com backup.
- Contador `ignored_counts` ganha um motivo novo (a função hoje valida a lista fechada).
- Bloqueio no WhatsApp afetando o celular pessoal; rota da Evolution inexistente/diferente na versão instalada.

## 7. Decisões que o Mário precisa tomar
1. Bloqueio só no ImobFlux primeiro (recomendado) ou já com WhatsApp?
2. O que acontece com a conversa existente: congelar, arquivar ou manter?
3. Mensagem enviada **por você, pelo celular** para um número bloqueado: grava ou ignora também?
4. Quem pode bloquear/desbloquear: só o proprietário ou também atendente (com registro na auditoria)?
5. Bloquear por contato (vinculado) ou por número solto (inclusive de quem ainda não é contato)?
6. Aceita que o bloqueio no WhatsApp também bloqueie no celular pessoal do corretor?
