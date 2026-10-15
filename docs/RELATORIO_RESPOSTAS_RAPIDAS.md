# Relatório — Respostas rápidas, ajuste de imagem e visibilidade do atendente

Branch `feat/respostas-rapidas` (a partir da `main` em `08baccd`). **Nada foi enviado, mesclado nem aplicado em produção.** A migration `20260802005200_quick_replies.sql` só rodou em banco local.

## Parte 3 — Visibilidade do atendente em grupo liberado (resultado)

**Era teste desatualizado, não bug de visibilidade.**

- O teste `team-management` "atendente em grupo liberado" esperava ler a mensagem "DEMO — Grupo após o marco" no grupo `…0022`.
- Os dados de demonstração gravavam essa mensagem com remetente do ponto de contato `…0002`, que pertence ao contato `…0002`, **marcado como protegido** (`supabase/demo/team_privacy_scenarios.sql`, linha 28).
- A migration `20260802003600_hide_protected_contact_group_messages.sql` (commit `9bf69c0`, "fix(security): protege contato em grupo liberado") passou a esconder do atendente, de propósito, as mensagens de contato protegido mesmo em grupo liberado. O teste e os dados são anteriores a essa regra.
- Evidência: a política `messages_select_effective_member` exige `not private.is_protected_contact_point(sender_contact_point_id)`; com o remetente trocado para um contato não protegido, a mensagem aparece, e a mensagem do contato protegido continua oculta.
- Correção (só teste/dados de demonstração, nenhuma regra de acesso mudou): a mensagem "após o marco" agora vem de um contato comum, e foi criada uma mensagem de contato protegido, que o teste exige que **não** apareça ao atendente. Passou: `team-management` 3/3.
- Impacto de privacidade: nenhum. O comportamento do banco era o correto.

## Parte 1 — Respostas rápidas

**Banco (migration local 005200, rollback em `docs/rollback/20260802005200_rollback.sql`)**
- Tabelas `quick_reply_categories` e `quick_replies` (título ≤ 60, texto ≤ 4000, categoria ≤ 40, ativo, contador de uso, último uso). RLS: membro ativo lê só o próprio workspace; **nenhum INSERT/UPDATE/DELETE direto** (só pelas funções).
- 7 funções `SECURITY DEFINER` com `search_path` vazio, `authenticated` sim, `anon`/`service_role` não: `get_quick_replies`, `save_quick_reply_category`, `delete_quick_reply_category`, `save_quick_reply`, `delete_quick_reply`, `record_quick_reply_use`, `add_example_quick_replies`.
- Regras no banco: dono edita/apaga tudo; atendente só o que criou; apagar categoria move as respostas para "sem categoria"; contador só para membros do workspace; texto guardado exatamente como veio.
- Auditoria de criar/editar/apagar **sem título nem texto** (só identificadores e quais campos mudaram); o app também não registra o texto em log (só o código do erro).
- A migration não insere dados. "Adicionar exemplos" (5 modelos) é uma ação do usuário, só com a lista vazia.
- pgTAP `quick_replies.test.sql` (54 verificações), escrito primeiro e visto **vermelho** (função inexistente) antes de ficar **verde**. A suíte inteira passa: 34 arquivos, 1062 testes. Foram atualizadas 4 contagens existentes por causa das novas funções/tabelas (funções DEFINER 62→69 e 77→84 em três arquivos; tabelas com `set_updated_at` 12→14).

**App**
- Botão ⚡ "Respostas rápidas" na caixa de mensagem → painel (drawer à direita no desktop; "bottom sheet" no celular) com busca, chips Tudo / Mais usadas / Sem categoria, filtro por categoria, grupos que abrem/fecham, texto completo expansível, menu ⋯ conforme permissão, "+ Nova resposta" e "+ Nova categoria".
- **Usar nunca envia**: clicar insere na posição do cursor (ou no fim), com variáveis resolvidas, e devolve o foco à caixa. Uso é contado em segundo plano; falha de rede não impede a inserção.
- Atalho "/": no início ou depois de espaço; setas, Enter/Tab inserem (substituindo "/termo"), Esc fecha; "1/2", "e/ou" e URLs não acionam.
- Variáveis `{{nome}}`, `{{nome_completo}}`, `{{meu_nome}}`, `{{empresa}}`; as desconhecidas ficam literais (destacadas no painel e na pré-visualização). Ao enviar mensagem com `{{...}}`: "Há campos não preenchidos ({{imovel}}). Enviar mesmo assim?" com Cancelar / Enviar mesmo assim (não vale para nota interna).
- Caixa de mensagem: cresce até ~40% da altura da tela (rola por dentro depois) e o botão expandir leva a ~60%. Resposta longa não fica cortada.
- Gestão em **Configurações > Respostas rápidas** (`/configuracoes/respostas-rapidas`): aberta a todos os membros ativos (a página inicial de Configurações continua só do dono; o atendente chega pelo link "Gerenciar" do painel). Lista, cria, edita, apaga, categorias e pré-visualização com dados de exemplo.
- Rótulos de auditoria em português para os 7 eventos.

## Parte 2 — Imagem
Foto limitada a **220 px no maior lado no desktop e 180 px no celular**, proporção preservada; clique continua ampliando (lightbox); figurinha e vídeo não mudaram.

## Testes
- Unitários: 452 passam em **Node 24 e Node 22** (novos: 25 em `respostas-rapidas.unit.spec.ts`: variáveis, `{{...}}` ao enviar, cursor, "/" sem atrapalhar "1/2", quebras de linha/emojis, crescimento da caixa, busca/filtros, permissões, limites da imagem).
- Lint e tipos limpos em Node 24 e 22. Build de produção com variáveis falsas do CI: ok (rota nova listada).
- E2E `quick-replies.spec.ts` 8/8: exemplos na tela vazia; atendente cria; permissões de edição; dono usa e **nada é enviado**; aviso de campo não preenchido (Cancelar não envia; Enviar mesmo assim envia); atalho "/"; crescimento/expansão da caixa; categoria apagada.
- Verificação visual em 1440 px e 390 px (painel, atalho, caixa longa, gestão). Console sem erros.
- Regressão de navegador das demais suítes: ver STATUS_PROJETO.md.

## Roteiro de teste em produção (depois do deploy)
1. Conversas > abrir uma conversa: aparece "⚡ Respostas rápidas" e a caixa expande.
2. Painel vazio > "Adicionar exemplos" cria 5 modelos.
3. Clicar "Confirmar visita": o texto entra na caixa, **nada é enviado**; dá para editar.
4. Enviar com `{{imovel}}` ainda no texto: o aviso aparece; Cancelar mantém o texto.
5. Digitar "/" na caixa: lista; "1/2" não abre lista.
6. Como atendente: criar uma resposta; ver que não há ⋯ nas do dono; como dono, editar a do atendente.
7. Apagar uma categoria: as respostas ficam em "Sem categoria".
8. Foto recebida: no máximo ~220 px (desktop) / ~180 px (celular); clique amplia.

## Riscos e dúvidas
- Migration nova em produção: só aditiva (2 tabelas + 7 funções), rollback testado; a ordem é Trava A (banco) antes da Trava B (app). O app novo exige a migration.
- Eventos de auditoria de respostas rápidas aparecem na tela de Auditoria como "Outros" (o filtro por categoria é validado numa função de banco existente; não foi alterada para não ampliar o escopo).
- `{{nome}}` usa o nome do contato exibido na conversa; sem nome (só telefone), fica literal e o aviso aparece ao enviar.
- Vídeo continua com o limite antigo (220/280 px); só foto foi reduzida, como pedido.
- Incidente de ambiente (sem efeito no repositório): ao sincronizar a cópia descartável, um espelhamento sobrescreveu a configuração local do Supabase e a cópia passou a apontar para o stack local `imobflux`; o banco local de desenvolvimento foi resetado e o stack foi parado e reiniciado por cerca de 1 minuto (dados locais de teste, recriados a cada execução de testes). Corrigido; a cópia descartável voltou à sua configuração (`imobflux-suite-0007`) e a sincronização agora a preserva. Produção não foi tocada.

## Trava A (banco) — executada em 2026-10-15 (migration 20260802005200)

Autorizada pelo dono, só o banco; o app **não** foi publicado (Trava B pendente, separada).

**Pré-condições provadas em banco local descartável**
1. Aditiva e compatível com o app atual (`08baccd`): comparação de esquema (`pg_dump`, banco até a 005100 × com a 005200) mostra **apenas adições** (2 tabelas, 2 índices extras, 2 gatilhos, 2 policies, 7 funções, grants); nenhuma linha removida ou alterada em objeto existente.
2. Rollback `docs/rollback/20260802005200_rollback.sql`: aplicado sobre o banco com a 005200, o esquema voltou **idêntico** ao da 005100 (diff vazio) e a suíte pgTAP de `08baccd` passou (33 arquivos, 1008 testes).
3. A migration não insere dado fora de função (DDL puro até a linha 93; o `insert` dos exemplos só existe dentro de `add_example_quick_replies`, chamada pelo botão).

**Produção**
1. Backup (esquema 390 KB + dados 118 KB, fora do repositório); `migration list --linked`: tudo aplicado até a 005100, **só a 005200 pendente**; `db push --linked --dry-run` listou só ela.
2. `db push --linked`: aplicada sem erro; `migration list`: 52 de 52, sem pendências.
3. Validação somente leitura:
   - 7 funções novas: `SECURITY DEFINER`, `search_path=""`, `authenticated` executa; `anon` e `service_role` não.
   - Tabelas novas: RLS ligada, 1 policy de leitura cada, `anon` sem leitura, `authenticated` sem INSERT; **0 linhas** em ambas.
   - Contagens das 14 tabelas existentes verificadas antes e depois: **idênticas** (ex.: messages 132, conversations 4, audit_events 26).
   - Esquema de produção antes × depois (dump): só linhas adicionadas, nenhuma alterada/removida.
   - Páginas do app atual (Conversas, Kanban, Prioridades) **não foram abertas autenticadas**: não há credencial de produção disponível para a automação. Como nenhum objeto existente mudou (diff acima), o app atual não é afetado; sugiro abrir as três telas uma vez no navegador como conferência.
4. Backups apagados (sem cópias restantes). `EVOLUTION_INSTANCE_NAME` na Vercel mantida (não tocada).
