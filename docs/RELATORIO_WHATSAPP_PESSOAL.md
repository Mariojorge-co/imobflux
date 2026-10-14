# Relatório: WhatsApp com número pessoal (branch `feat/whatsapp-pessoal`)

Feito **só no ambiente local** (Supabase local isolado), em branch própria, **sem push, sem tocar na `main`, sem aplicar nada
em produção**. Medidas aprovadas: 2 (histórico configurável), 3 (grupos/transmissão/canais) e 4 (modo "só cadastrados", como
chave e não permanente). Método: teste de banco (pgTAP) escrito antes (vermelho), depois a migration (verde).

> **Parado aguardando a sua autorização expressa para o passo de produção.**

## Correção de uma informação do relatório anterior
Eu tinha dito que contatos `@lid` e identificadores longos eram "descartados". **Estava errado**: a normalização de telefone
aceita 12 a 15 dígitos como número internacional, então um `@lid` (15 dígitos) hoje **cria um contato com telefone falso**
(ex.: `+218943875198110`), e uma lista de transmissão com 12 dígitos também passaria por telefone. A medida 3 fecha o caso das
listas/canais; o `@lid` fica como pendência (abaixo). Com o modo "só cadastrados" ligado, um `@lid` nunca casa com um contato e
é ignorado (testado).

## Decisões
- **Histórico zero, como configurar (sua pergunta):** escolhi a opção mais simples e segura, **uma chave por conexão**
  (`history_window_days`, 0 a 15, padrão 15) **mais** um seletor na tela Configurações > WhatsApp, visível **antes** do QR code.
  A migration já grava **0** na conexão de produção que existe hoje (nunca pareada: `configured`, sem histórico), de forma
  explícita e documentada no cabeçalho da migration, **junto com o modo "só cadastrados" LIGADO** (decisão do dono, para não
  depender de lembrar) e grupos desligados. Qualquer outra conexão continua com 15. Depois do pareamento a janela fica
  trancada (é no pareamento que o WhatsApp envia o histórico).
- **Modo "só cadastrados" (`ingest_only_known_contacts`):** padrão da coluna FALSE (qualquer outro uso preserva o comportamento
  atual, leads novos criam contato). A migration liga TRUE **apenas** na conexão existente ainda não pareada (mesma condição do
  histórico 0: `configured`, sem pareamento e sem histórico). O dono desliga pela tela quando quiser. Teste de banco cobre as
  três situações (nunca pareada recebe os padrões; a que já importou histórico e as já pareadas não são tocadas).
- **O que conta como "cadastrado":** número que existe em Contatos e **não está arquivado**. Contato arquivado volta a ser
  desconhecido (arquivar passa a ser uma forma de silenciar um número enquanto o modo está ligado). Ponto de contato sem
  contato (ex-participante de grupo) é desconhecido.
- **Normalização:** reaproveita `normalize_brazilian_phone` e acrescenta as variantes do 9º dígito dos celulares brasileiros
  (cadastrado com 9, WhatsApp entrega sem, e o inverso) e o número internacional sem `+` (o jid não traz `+`). Fixos não ganham
  variante. A variante só vale **com o modo ligado**; com o modo desligado a identidade continua exatamente como antes.
- **Contador "N ignoradas":** `ignored_counts` (jsonb) com 3 chaves por motivo (`group`, `unknown_contact`, `invalid_phone`),
  só números pequenos, sem conteúdo nem telefone. Lista de transmissão/canal/Status não são contados (seria uma escrita por
  Status de cada contato).
- **Webhook nunca quebra:** descartes respondem **200** com `{status: ignored, reason}`; mídia só é registrada/baixada quando a
  mensagem foi gravada (grupo desligado ou desconhecido nunca baixa arquivo).
- **Auditoria:** `whatsapp.ingest_settings_changed` (só o que mudou: chave, de, para; sem dados de clientes), só o dono altera;
  repetir o mesmo valor não gera evento.
- **Achado de UX corrigido no E2E:** o checkbox só mudava depois da resposta do servidor; agora atualiza na hora e desfaz se
  o servidor recusar.

## Migration nova (uma só) e rollback
**Lista exata:** `supabase/migrations/20260802005000_whatsapp_personal_filters.sql` (a única; ordenada depois da 004900).
Conteúdo: 4 colunas novas em `channel_connections` (com constraints), 1 `update` da conexão nunca pareada para janela 0,
`private.phone_match_candidates`, `private.count_ignored_whatsapp_message`, gatilho do histórico (não marca "importando" com
janela 0), `register_whatsapp_channel` (devolve a janela), `ingest_whatsapp_group_text_message`,
`ingest_whatsapp_text_message`, `ingest_whatsapp_history_batch` e `update_whatsapp_ingest_settings` (OWNER). Só adiciona
colunas e cria/substitui funções; **nenhum dado é apagado**. As funções existentes foram regeradas a partir das definições
vigentes com remendos verificados (cada trecho casa exatamente uma vez).

**Rollback testado:** `docs/rollback/20260802005000_rollback.sql` (fora de `supabase/migrations`, em transação) devolve as 3
funções de entrada, o registro e o gatilho ao estado anterior e remove as 3 funções novas. As **colunas ficam** (inofensivas;
apagar perderia a configuração; há bloco comentado para removê-las). Prova: banco novo com todas as migrations, rollback
aplicado, **suíte antiga (da `main`, 31 arquivos, 884 testes) passa**. Se considerada revertida:
`supabase migration repair --status reverted 20260802005000`.

## Commits (todos locais na `feat/whatsapp-pessoal`)
1. `e0b8607` feat(banco): chaves de entrada do WhatsApp pessoal (migration, pgTAP, rollback, ajustes de testes antigos)
2. `8635d10` feat(banco): registro da conexão devolve a janela de histórico
3. `d05b851` feat(whatsapp): filtros no app (parser, Evolution, importador, ação, tela, rótulo de auditoria, tipos)
4. `0fbc7ac` fix(whatsapp): controles atualizam na hora e desfazem se o servidor recusar
5. (este relatório e status/roadmap)

Testes antigos alterados de propósito: 7 arquivos pgTAP que ingerem grupos agora ligam `ingest_groups` na própria conexão de
teste (o padrão passou a ser desligado), e 3 contagens fixas de funções `SECURITY DEFINER` subiram em 1 (61→62 e 76→77).

## Resultado dos testes
| Verificação | Resultado |
|---|---|
| pgTAP, banco **novo e limpo**, todas as migrations do zero | **32 arquivos, 962 testes, PASS** (78 são do arquivo novo `whatsapp_personal_filters`) |
| Testes unitários | **377 passando** (eram 351; +26) |
| `lint`, `typecheck`, `build` | sem erros |
| E2E no navegador (app compilado + Supabase local, `next start`) | **28/28**: tela antes do QR, grupo ignorado, transmissão e Status ignorados, desconhecido ignorado (recebido e enviado por mim), cadastrado aceito (inclusive sem o 9º dígito), histórico janela 0 descartado, "N ignoradas" na tela, sem aviso falso de importação, auditoria, celular sem rolagem lateral |
| Rollback | suíte antiga passa depois dele (884) |

## Ordem de publicação sugerida (nada disso foi feito)
1. Backup de produção; `migration list --linked` (esperado: só a `005000` pendente); `db push --linked --dry-run`.
2. `db push --linked`; validação somente leitura: função nova existe com `search_path` vazio, `anon` e `service_role` sem
   EXECUTE em `update_whatsapp_ingest_settings`, contagens iguais, conexão de produção com `history_window_days = 0`,
   `ingest_groups = false`, `ingest_only_known_contacts = false`.
3. Merge (`--ff-only` da `feat/whatsapp-pessoal` na `main`, que hoje está 1 commit à frente do remoto com a documentação) e push;
   acompanhar o deploy da Vercel.
4. Em produção, **antes de escanear o QR code**: abrir Configurações > WhatsApp e conferir que o modo de teste já está ligado
   (a migration liga), grupos desligados e histórico em "Não importar nenhum histórico"; **cadastrar em Contatos o número de
   teste** e só então clicar em "Conectar WhatsApp". Suspender/remover o atendente de teste (para ninguém mais enxergar conversas).
5. Observação: o app antigo (main atual) continua funcionando com o banco novo, mas o app novo **depende** da migration (a
   tela de filtros e a ação chamam `update_whatsapp_ingest_settings`); migrations primeiro, app depois.

## Pendências registradas
- **`@lid` (perda/ruído de mensagens):** o WhatsApp novo entrega alguns contatos como `<15 dígitos>@lid`, sem telefone real.
  Com o modo desligado isso cria contato com telefone falso (sem como responder); com o modo ligado é ignorado. **Sugestão:**
  a Evolution costuma enviar o telefone real em campos alternativos do payload (por exemplo `remoteJidAlt`/`senderPn`, a
  confirmar na versão instalada): usar esse campo quando existir e, sem ele, ignorar e contar como "identificador sem
  telefone" em vez de criar contato. Exige conferir um payload real.
- Medidas 6 (exclusão real de contato/conversa e bloqueio de número) e 7 (copia de mensagens na Evolution/VPS): ficam para
  depois, como combinado. Lembrete: mensagens também ficam no Postgres da Evolution na VPS.
- Mensagens de lista de transmissão/Status não são contadas (só descartadas).
- Os valores que a migration gravou na conexão existente ficam nas colunas mesmo após o rollback (sem efeito sem as funções novas).
- A janela de histórico é por conexão; um próximo pareamento (nova conexão) volta ao padrão 15 se nada for escolhido na tela.
