# Relatório — Pacote Noite Geral (branch local `feat/pacote-noite`)

> Estado: **pronto e testado localmente; NADA foi publicado.** Sem push, sem deploy, sem migration em produção. A branch tem 11 commits
> sobre a `main` (`fd1163b`). Aguarda o seu **"autorizo"**: primeiro a **Trava A** (migrations `006300`, `006400`, `006500`), depois,
> separadamente, a **Trava B** (app).

## O que o pacote entrega

| # | Parte | O que mudou para quem usa |
|---|-------|---------------------------|
| 1 | **Atalhos** | **Esc em camadas**: cada Esc fecha uma coisa por vez (menu da mensagem → emojis → painel de respostas → busca → citação → gravação → edição → lista "/" → por último a própria conversa, voltando à lista com o foco no cartão). **Alt+↑/↓** troca de conversa. **?** abre a ajuda de atalhos (botão de teclado no topo). **Rascunho por conversa**: o que você digitou fica ao trocar de conversa e volta. |
| 2 | **Celular e tablet** | Menu hambúrguer até 1024 px; conversa em **duas telas** (lista ↔ conversa) com **voltar pelo histórico** (o botão do aparelho e o da tela fazem o mesmo; a lista volta onde estava); menu **⋯** no cabeçalho em folha de toque; menus de mensagem em **folha** (toque e **toque prolongado**); áreas de toque de **44 px**; teclado do celular não cobre a caixa. Sem rolagem horizontal em nenhuma tela (390/768/1440). |
| 3 | **Painel Hoje** (`/hoje`, primeiro item do menu) | Contadores do dia (recebidas, enviadas, conversas novas, tarefas concluídas); **clientes aguardando resposta** (chip do prazo); **follow-ups para fazer** (aguardando cliente já no 1º/2º/3º nível); **tarefas de hoje e atrasadas**; **novas sem atendimento**. Proprietário vê a equipe e filtra por responsável / "sem responsável"; atendente vê só o que é dele. Linguagem neutra, sem fotos de imóvel. |
| 4 | **Respostas rápidas com anexo** | Até **5 arquivos de até 25 MB** por resposta (mesmas regras de tipo/conteúdo do envio normal). Ao usar a resposta, o **texto entra na caixa (editável)** e os **arquivos entram na bandeja de envio** com o "x" de cada um; **nada é enviado sozinho**. Variáveis (`{{nome}}` etc.) continuam. Clipe com a quantidade na lista, no painel e no menu "/". Mesmas permissões: dono mexe em tudo, atendente só no que criou. |
| 5 | **Avisos de mensagem nova** | Contador no título da aba `(3) …`; **som opcional** (liga/desliga + volume + testar); **aviso do sistema** só com a aba fora de foco e com opção **"esconder nome e texto"**; clique no aviso abre a conversa. Preferências **pessoais** em `/preferencias`. |
| 6 | **Busca global** (lupa no topo ou tecla **/**) | Procura em **mensagens, legendas, nome e telefone** de todas as conversas que a pessoa enxerga; destaca o termo no trecho; abre a conversa **rolando até a mensagem achada** (mesmo antiga); paginada ("Mostrar mais"). |
| 7 | **Modo escuro** | **Claro / Escuro / Automático** (botão no topo e `/preferencias`); escolha pessoal; sem piscar ao carregar; contraste **WCAG AA** auditado automaticamente em todas as telas, nos dois temas, em 390 e 1440 px. |
| 8 | **Estudo Google Contatos** | [ESTUDO_GOOGLE_CONTATOS.md](ESTUDO_GOOGLE_CONTATOS.md) — só documento; caminhos A/B/C e decisões para você. |
| 9 | **Estudo financiamento** | [ESTUDO_ACOMPANHAMENTO_FINANCIAMENTO.md](ESTUDO_ACOMPANHAMENTO_FINANCIAMENTO.md) — só documento; etapas, checklists, dados, fases e perguntas para você. |

## Migrations (3, só locais, aditivas, com rollback testado em `docs/rollback/`)

**Ordem de aplicação (Trava A): `006300` → `006400` → `006500`.** São independentes entre si e **compatíveis com o app que está em produção**
(só criam objetos novos; nenhuma função ou tabela existente muda de comportamento).

| Migration | Conteúdo | Rollback |
|-----------|----------|----------|
| `20260802006300_today_overview` | `get_today_overview` — uma função de **leitura** (INVOKER, STABLE): conversas com prazo + responsáveis + "já respondida" + contadores do dia. Reaproveita `private.sla_applies`. pgTAP: 20 testes. | `20260802006300_rollback.sql` (drop da função) |
| `20260802006400_quick_reply_attachments` | Tabela `quick_reply_attachments` (RLS, sem escrita direta, **sem cascata**) + `get_quick_reply_attachments`, `add_quick_reply_attachment`, `remove_quick_reply_attachment`. Uma constraint única `(workspace_id, id)` em `quick_replies` para a chave composta. Arquivos no bucket privado `whatsapp-media` já existente, em `<workspace>/quick-replies/<resposta>/`. pgTAP: 27 testes. | `20260802006400_rollback.sql` (apaga os registros de anexo; **os arquivos ficam no Storage**, inacessíveis, e podem ser apagados pelo painel) |
| `20260802006500_global_search` | `create extension pg_trgm` (schema `extensions`), índice trigram **parcial** em `messages.text_content`, `search_global` (INVOKER) e o auxiliar `private.search_message_candidates` (DEFINER, só devolve **ids**). pgTAP: 20 testes. | `20260802006500_rollback.sql` (função, auxiliar e índice; a extensão fica) |

**Cuidados para a Trava A**: (1) a `006500` cria um índice na tabela `messages` **sem** `CONCURRENTLY` (trava a tabela por instantes; hoje são ~266 mensagens, então é irrelevante, mas deve ser aplicada fora de pico); (2) a `006500` ativa `pg_trgm` — extensão padrão do Supabase, o `db push` já tem permissão para isso; (3) o app novo precisa das três funções: **migrations antes do app**, como combinado; (4) se for preciso desfazer, reverter o **app antes** e então rodar os rollbacks na ordem inversa (`006500` → `006400` → `006300`). O app novo **tolera** banco sem a função de anexos (as respostas aparecem só com texto).

## Decisões tomadas (já que não havia como perguntar durante a noite)

1. **Preferências de aviso e tema são por pessoa e por navegador** (guardadas no navegador, com o id do membro na chave), não no banco: evita migration e dado extra. Consequência: mudar de aparelho exige configurar de novo.
2. **"Silenciada" = prazo pausado ou desativado, ou conversa arquivada.** Não existe "silenciar" como recurso; usei o que o sistema já tem. Grupo **não liberado** (só do dono) **nunca** avisa.
3. **Hoje para o atendente** mostra as conversas e tarefas **dele** e também as **novas sem responsável** (para ele poder assumir). Proprietário vê tudo e filtra.
4. **Follow-up "devido"** = aguardando cliente que já passou do **1º nível** configurado em Prazos (usa o mesmo cálculo único do app).
5. **Anexos da resposta rápida**: ao usar, os arquivos são **baixados e reenviados pelo caminho normal de envio** (assim valem as mesmas validações, a mesma fila e o mesmo limite de 10 por vez). Ordem de saída: **arquivos primeiro, depois o texto** (a regra já existente da fila).
6. **Busca global**: mínimo de **2 letras**; no máximo **500 mensagens + 100 contatos** por consulta (mostra "Mais de 500"); **mensagens escondidas ou apagadas não aparecem**; contato protegido some para o atendente (RLS).
7. **Tecla `/` abre a busca** só fora de campos de texto (dentro da caixa de mensagem continua sendo o atalho de respostas rápidas). `Ctrl+K`, `Ctrl+F` e afins continuam do navegador.
8. **Contraste**: escurecidos os tons de texto dos chips de prazo e o texto secundário; a hora nas bolhas enviadas passou de 60% para 80% de opacidade (estava abaixo de 4,5:1 no escuro).

## Desempenho da busca global (medido)

Banco local com **300 mil mensagens** sintéticas num workspace: termo comum (500+ achados) **1,2 s**; termo raro **0,3 s**; sem resultado **7 ms**; nome de contato **9 ms**; 2 letras ("de") **1,4 s**; segunda página **45 ms**. A **primeira versão levava 70–140 s**: a RLS era avaliada em cada linha antes do filtro de texto. Corrigido escolhendo os candidatos pelo índice trigram num auxiliar DEFINER que devolve **só ids** e relendo o conteúdo como a própria pessoa (a RLS corta o que ela não pode ver). A produção tem ~266 mensagens: o custo real hoje é desprezível; o desenho aguenta o crescimento.

## Limites conhecidos

- **Avisos**: só funcionam com o ImobFlux **aberto em alguma aba** (não há push com o navegador fechado). Alguns navegadores de celular só mostram aviso do sistema para app instalado (PWA); o **contador no título** e o **som** funcionam sempre. Navegadores podem bloquear o som até você clicar na página uma vez.
- **Preferências por navegador** (decisão 1).
- **Busca global**: acentos contam (busca "joao" não acha "João"); busca textual simples, sem sinônimos. Resultados limitados a 500 mensagens por consulta.
- **Hoje**: os chips de prazo são calculados no carregamento da página (não ficam mudando sozinhos de minuto em minuto); recarregue para atualizar.
- **Anexos da resposta**: o arquivo é baixado no navegador antes de entrar na bandeja; em rede lenta os itens aparecem "enviando" por alguns segundos. Limite de 5 arquivos por resposta e 10 na bandeja.
- **Rollback da `006400`** não apaga os arquivos do Storage (ver acima).
- **Teste real ainda não feito**: o ambiente de testes simula a Evolution; o roteiro abaixo cobre o que só dá para confirmar no aparelho.

## Testes

| Camada | Resultado |
|--------|-----------|
| Lint (`eslint .`) e tipos (`tsc --noEmit`) | limpos |
| Unitários (Playwright, `*.unit.spec.ts`) | **593 testes** passando em **Node 22 e Node 24** (novos: hoje 9, notificações 12, busca global 5, atalhos, tema) |
| Build (`next build`, variáveis falsas de CI) | ok; rotas novas: `/hoje`, `/preferencias` |
| pgTAP (`supabase test db`, banco local do projeto) | **46 arquivos, 1.410 testes** passando (novos: today_overview 20, quick_reply_attachments 27, global_search 20; contagens de `SECURITY DEFINER` dos testes de segurança atualizadas de 94→96 e 116→119 porque entraram 2 funções públicas e 1 privada de escrita/candidatos) |
| Navegador — **regressão completa das suítes antigas** | auth-flow 17, collaboration-hotfix 4, conversations 13, demo-mode 1, functional-hotfix 3, grupos-e-propria 7, inbox-realtime 3, mensagens-pacote 14, prazos 7, quick-replies 8, send-files 11, send-queue 2, sprint23-conversations-evolution 7, sprint23-hotfix 5, sprint24-blocob-polish 14, team-management 3 — **todas passando** |
| Navegador — suítes **novas** | atalhos 12, celular 12, tema 7, tema-novas-telas 4, hoje 5, notificações 5, respostas-anexos 6, busca-global 8 — **todas passando** |
| Contraste AA automático | 0 violações em claro/escuro × 390/1440 nas telas existentes **e** nas novas (busca aberta, formulário com anexo, painel e bandeja, conversa com mensagens, Hoje, Preferências) |
| Capturas (390/1440, claro/escuro) | salvas **fora do repositório** em `%TEMP%\capturas-noite` (`dark-*`, `novas-*`, `layout-celular-*`) |

**Instabilidade registrada (não escondida)**: na primeira rodada completa, o 7º teste de `auth-flow` ("mantém a sessão válida") estourou o tempo ao abrir `/configuracoes` — era a **compilação a frio** do servidor de desenvolvimento logo após sincronizar a pasta; na repetição passou **17/17**. Mesmo comportamento de "primeiro teste após sincronizar" já visto antes; no CI (build de produção) não ocorre. Duas falhas reais foram achadas **pelos próprios testes** e corrigidas antes do relatório: (a) a hora das bolhas enviadas no tema escuro (3,75:1) e (b) diferença de hidratação em Preferências quando a permissão de aviso já estava concedida.

## ROTEIRO DE TESTE REAL (só depois da publicação) — celular em 390 px e computador

Preparação: use o seu número com uma conversa de teste (ou um segundo chip). Abra o ImobFlux **no celular** (navegador, largura ~390 px) e **no computador**; o WhatsApp no celular. Marque cada passo.

**No celular (390 px)**
1. **Menu e telas**: toque no menu (☰), confira o item **Hoje** no topo. Abra **Conversas**: só a lista aparece. Toque numa conversa: só a conversa aparece. Use o **botão voltar do aparelho**: volta à lista **no mesmo ponto de rolagem**.
2. **Menu ⋯** do cabeçalho: abre uma folha de baixo para cima com as ações; fechar com toque fora.
3. **Toque prolongado** numa mensagem: abre a folha (responder, reagir, encaminhar…). Todos os botões têm tamanho confortável.
4. **Teclado**: toque na caixa de mensagem — o teclado sobe **sem cobrir** a caixa nem o botão enviar.
5. **Escuro**: toque no ícone de tema no topo até ficar **Escuro**; recarregue — não pisca claro. Percorra Hoje, Conversas, Kanban, Contatos, Tarefas: tudo legível.
6. **Busca global**: toque na lupa do topo, digite uma palavra de uma conversa antiga; toque no resultado: abre a conversa **rolando até a mensagem**, destacada.
7. **Resposta rápida com anexo** (crie antes no computador, passo 15): na conversa, ⚡ **Respostas rápidas** → escolha a resposta: o texto entra na caixa e o(s) arquivo(s) na bandeja; **nada foi enviado**. Remova um arquivo no "x", edite o texto e envie: no WhatsApp chegam o arquivo e depois o texto.
8. **Hoje**: confira contadores e as listas; toque num cliente: abre a conversa.

**No computador**
9. **Esc em camadas**: abra o menu de uma mensagem e o seletor de emojis; Esc fecha um de cada vez. Abra a busca na conversa (lupa) → Esc fecha a busca; Esc de novo fecha a conversa e o foco volta ao cartão na lista.
10. **Alt+↑ / Alt+↓** trocam de conversa. **?** abre a ajuda de atalhos.
11. **Rascunho**: digite algo na conversa A, vá para B, volte para A: o texto está lá.
12. **Avisos**: em **Preferências → Avisos de mensagem nova**, ligue **Som** (teste o volume) e **Aviso do sistema** (aceite a permissão do navegador). Deixe o ImobFlux em **outra aba** e peça para alguém (ou o outro chip) mandar mensagem: o título da aba mostra **(1)**, toca o som, aparece o aviso; **clique no aviso**: abre a conversa. Volte à aba: o contador zera. Marque **Esconder nome e texto** e repita: o aviso diz só "Você recebeu uma nova mensagem".
13. **Não deve avisar**: mensagem **enviada por você** (pelo ImobFlux ou pelo celular), **edição** de mensagem, **reação**, conversa **arquivada** ou com **prazo pausado**, grupo não liberado.
14. **Busca global** com a tecla **/** (fora da caixa de texto): digite nome, telefone e uma frase; teste "Mostrar mais".
15. **Resposta rápida com anexo**: *Configurações → Respostas rápidas → Nova resposta*: título, texto com `{{nome}}`, **Adicionar arquivos** (um PDF e uma foto). Salve; o clipe 📎 2 aparece. Teste recusar um `.exe` e passar de 5 arquivos (avisa). Como **atendente**: você usa a resposta do dono mas **não** edita os arquivos dela; edita só as suas.
16. **Hoje como proprietário**: use o filtro por responsável. Como **atendente**: sem filtro e só o que é seu.
17. **Tema automático**: coloque o tema em **Automático** e troque o tema do sistema operacional: o ImobFlux acompanha.

Se algum passo falhar, anote o número e o que apareceu.

## Plano de publicação (aguarda o seu "autorizo")

1. **Trava A (banco)**: backup → `migration list` (só `006300`, `006400`, `006500` pendentes) → dry-run → parar e pedir "autorizo" → `db push` → validação **somente leitura** (3 funções novas + 1 auxiliar, 1 tabela com RLS, índice trigram, 266 mensagens intactas, permissões) → apagar backup.
2. **Trava B (app)**: checklist completo (lint, tipos, unitários Node 22/24, build com variáveis falsas, suítes relevantes e regressão antiga) → merge `--ff-only` → push → CI (`gh`, dois jobs, Node 22) → Vercel Ready → smoke test somente leitura (`/login` 200; rotas protegidas 307, incluindo `/hoje`). **Não tocar nas variáveis de ambiente.**
3. **Rollback**: app primeiro; depois `006500` → `006400` → `006300` em `docs/rollback/`.
