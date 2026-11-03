# Estudo: exclusão real de cliente e dos seus dados

> Só leitura do código e do esquema do banco **local** (catálogo de tabelas). Nada foi implementado; nenhum dado de produção foi consultado. Não é parecer jurídico: os pontos de LGPD abaixo pedem validação com quem cuida disso na empresa.

## 1. Situação atual

### 1.1 O que existe
- **Arquivar** contato (`contacts.archived_at`), com a regra de contato protegido (`is_protected`). O contato arquivado some das listas e, com "só cadastrados" ligado, deixa de casar na ingestão. **Nada é apagado.** Conversas, mensagens, notas, tarefas e oportunidades continuam no banco.
- **Não existe exclusão real** (já listada como pendência em `docs/RELATORIO_WHATSAPP_PESSOAL.md` e `docs/RELATORIO_CONVERSAS_PACOTE.md`).

### 1.2 O que impede apagar hoje (por desenho)
Todas as chaves estrangeiras são `ON DELETE RESTRICT` (nenhum `CASCADE` no esquema). Mapa do que aponta para o quê (catálogo do banco local):

| Tabela-mãe | Quem aponta para ela (todas RESTRICT) |
|---|---|
| `contacts` | `contact_points`, `internal_notes`, `opportunities`, `work_tasks` |
| `contact_points` | `conversation_participants`, `message_reactions`, `messages` |
| `conversations` | `conversation_assignments`, `conversation_participants`, `conversation_pins`, `conversation_read_states`, `internal_notes`, `messages`, `opportunity_conversations`, `work_tasks` |
| `messages` | `attachments`, `message_deletions`, `message_edits`, `message_reactions`, `messages` (citação/resposta) |
| `opportunities` | `internal_notes`, `opportunity_conversations`, `opportunity_financials`, `pipeline_history`, `work_tasks` |

Duas tabelas são **append-only por gatilho** (`prevent_append_only_mutation`, bloqueia UPDATE e DELETE): `pipeline_history` e `audit_events`. Como `pipeline_history` aponta para `opportunities`, **uma oportunidade com histórico não pode ser apagada** sem tratar esse gatilho. `audit_events` não tem chave estrangeira (guarda `target_type` e `target_id`), então não bloqueia, mas também **não pode ser editada nem apagada**; ela pode conter ids e metadados de ações sobre o cliente.

### 1.3 Mídia no Storage
- Bucket privado `whatsapp-media` (limite de 50 MiB por arquivo). `attachments.storage_bucket` e `attachments.storage_key` apontam para o arquivo. Apagar a linha do banco **não apaga o arquivo**: ficaria órfão (e continuaria ocupando o plano gratuito).
- Há também anexos de **respostas rápidas** e **mídia enviada** (`outgoing_media`); precisam ser considerados.

### 1.4 Outros lugares onde o cliente existe
- **Evolution/WhatsApp**: a Evolution guarda mensagens e contatos no próprio Postgres da VPS. Excluir no ImobFlux **não** apaga lá (nem no celular do corretor).
- **Backups** do banco e do Storage (o backup guarda o dado "excluído" até expirar).
- **Web Push**: o aviso usa só o nome do contato na hora; não guarda dado do cliente (a tabela `push_subscriptions` é do aparelho).
- **Logs** da Vercel: o app não registra texto de mensagem; registra identificadores. Retenção é do plano.

## 2. Arquivar x excluir

| | Arquivar (existe) | Excluir de verdade (não existe) |
|---|---|---|
| Reversível | Sim | Não (só por backup) |
| Some da lista e da ingestão | Sim | Sim |
| Mantém histórico para a empresa (disputa, SLA, relatórios) | Sim | Não |
| Atende pedido do titular "apague meus dados" | Não, por si só | Sim, se feito completo |
| Mensagem nova do mesmo número | Com contato arquivado, conforme o modo de ingestão | Cria contato novo, sem histórico |
| Risco | Baixo | Alto: perda definitiva, relatórios mudam |

Recomendação de produto: **arquivar continua sendo o padrão do dia a dia**; excluir vira ação rara, só do proprietário, com confirmação forte.

## 3. LGPD (pontos a validar, não parecer)
- O titular pode pedir eliminação dos dados tratados com base em consentimento ou quando deixam de ser necessários; há exceções (cumprimento de obrigação legal, exercício regular de direitos, **guarda para defesa em disputa**). Em corretagem, contratos/propostas e conversas de negociação costumam ter prazos de guarda. **Decisão jurídica do Mário/escritório**: por quanto tempo guardar antes de poder excluir.
- **Anonimizar** é uma alternativa à exclusão: manter a linha (para contagem e histórico comercial agregado) trocando nome, telefone, texto e mídia por valores neutros. Costuma ser aceito como eliminação quando irreversível.
- Registrar **quem excluiu, quando e por quê** (sem guardar o conteúdo apagado).

## 4. Opções de implementação

### Opção A — Exclusão em cascata controlada (RPC `delete_contact_cascade`)
Uma função `SECURITY DEFINER`, só do proprietário, que apaga em ordem segura, numa transação: reações → edições/exclusões de mensagem → anexos → mensagens → participantes/leitura/fixadas/atribuições → notas/tarefas → vínculos oportunidade-conversa → financeiro → oportunidades → conversas → pontos de contato → contato. O gatilho append-only de `pipeline_history` precisa de exceção controlada (ex.: variável de sessão que só a função define) ou a oportunidade é **anonimizada** em vez de apagada.
- Mídia: a RPC devolve a lista de `storage_key`; o servidor apaga os arquivos pela API do Storage (com chave de serviço) **depois** do commit e confere o resultado; falha deixa registro para repetir (tabela de pendências de limpeza).
- Auditoria: grava um `audit_events` de exclusão com `target_id` e contagens (sem conteúdo).
- Prós: exclusão completa. Contras: função grande e arriscada; pgTAP pesado; precisa de rollback (que **não** recupera dados apagados: só o backup recupera).

### Opção B — Anonimização (recomendada como primeira entrega)
Trocar nome por "Contato removido", apagar `contact_points` de telefone/e-mail (ou trocar por valor aleatório), esvaziar `body` das mensagens e notas, apagar anexos do Storage e deixar as linhas (para não quebrar chaves estrangeiras, contagens, SLA e relatórios).
- Prós: não enfrenta o `RESTRICT` nem o append-only; irreversível para o conteúdo; menos código; mantém métricas.
- Contras: ainda existem linhas "vazias"; precisa limpar também `audit_events.metadata` se houver dado pessoal (não pode editar: por isso é preciso **não** gravar dado pessoal ali — conferir o que já grava).

### Opção C — Exclusão em duas fases
Fase 1: arquivar + "agendar exclusão" para daqui a N dias (lixeira, reversível). Fase 2: um trabalho agendado (cron) executa a Opção A ou B. Dá tempo para desfazer erro e cumpre prazo de guarda.

### Migration compatível e rollback
- Compatível: só **adiciona** (função(ões), tabela de pendências de limpeza, coluna `deleted_at`/`anonymized_at`). Nada existente é alterado, então o app atual continua funcionando antes e depois da Trava A.
- Rollback (`docs/rollback/…`): remove as funções/tabela/colunas novas. **Não desfaz exclusões já feitas.** Por isso: backup obrigatório antes de usar a função em produção e uma tela de confirmação com o nome do cliente digitado.

## 5. O que fazer com os anexos
1. Apagar do Storage pela API (nunca só a linha). 2. Registrar pendência se o Storage falhar e repetir. 3. Conferir órfãos com um relatório periódico (objeto sem linha em `attachments`). 4. Backups: documentar que a cópia expira conforme a retenção (ver `docs/PLANO_BACKUP_VPS.md`).

## 6. Auditoria
Guardar: quem (membro), quando, qual contato (id, nunca nome/telefone), o tipo de ação (arquivar, anonimizar, excluir), contagens (mensagens, anexos, oportunidades) e o resultado (sucesso/falha do Storage). Como `audit_events` é append-only, **não colocar dado pessoal** em `metadata`.

## 7. Recomendação
1. **Fase 1 (pequena, segura)**: anonimizar contato (Opção B) + limpeza de mídia + auditoria, só proprietário, com confirmação digitada.
2. **Fase 2 (depois do uso real)**: lixeira com prazo (Opção C) e, se o jurídico exigir, exclusão física (Opção A).
3. Não implementar exclusão em cascata antes de decidir o prazo de guarda.

## 8. Riscos
Perda irreversível; apagar o cliente errado (contatos duplicados, ver `docs/ESTUDO_LID.md`); métricas e SLA mudam; Storage com arquivo órfão; esquecer a Evolution e os backups (o dado "sai" do app, mas continua existindo); gatilho append-only impedindo a transação (falha inteira, sem estrago, mas a ação não conclui).

## 9. Esforço estimado
| Etapa | Esforço |
|---|---|
| Fase 1 (anonimizar + mídia + auditoria + tela + pgTAP + rollback) | 2 a 3 dias |
| Lixeira com prazo + cron | +1,5 dia |
| Exclusão física em cascata | +2 a 3 dias, com revisão de segurança |

## 10. Decisões que o Mário precisa tomar
1. Por quanto tempo guardar conversa/negociação antes de permitir excluir (prazo jurídico)?
2. Anonimizar basta ou o pedido do titular exige apagar as linhas?
3. Quem pode excluir: só o proprietário? Atendente nunca?
4. Aceita lixeira de N dias (qual N: 7, 15, 30)?
5. Como tratar a Evolution (VPS) e o celular: apenas avisar o corretor para apagar lá, ou criar rotina para limpar a Evolution (exige acessar a VPS)?
6. Há contratos/propostas anexados que **não** podem ser apagados?
