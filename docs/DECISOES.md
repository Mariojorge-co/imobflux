# Decisões técnicas

## Fundação inicial

Data: 30 de julho de 2026.

- O projeto utiliza Next.js com App Router.
- O código fica em pastas na raiz, sem o diretório `src/`.
- TypeScript está configurado em modo estrito.
- Tailwind CSS é processado pelo PostCSS e usado para os estilos da Home.
- ESLint utiliza a configuração recomendada para projetos Next.js.
- npm é o gerenciador de pacotes, com versões registradas no
  `package-lock.json`.
- O alias `@/*` aponta para a raiz do projeto.
- `components/`, `lib/` e `types/` foram reservadas para crescimento futuro e
  permanecem sem implementações.
- `public/` foi reservada para arquivos estáticos.
- Nenhum banco de dados, serviço externo, contêiner ou componente de negócio
  foi adicionado nesta etapa.

## Sprint 2 — layout base

- O layout compartilhado usa um Route Group do App Router, preservando as URLs
  públicas sem duplicar o `AppLayout` entre as páginas.
- A Sidebar é o único Client Component desta etapa porque utiliza
  `usePathname` para destacar a rota ativa.
- AppLayout, Sidebar e Topbar são componentes estruturais e não contêm regras
  de negócio.
- A Home usa o redirecionamento nativo do Next.js para `/prioridades`.
- As páginas de prioridades, conversas, kanban e configurações não possuem
  conteúdo ou dados.
- Lucide React é a única dependência adicionada nesta etapa.

## Sprint 3 — Design System base

- Os tokens de cores, espaçamentos, bordas e tipografia ficam centralizados no
  tema do Tailwind em `app/globals.css`.
- A identidade visual usa superfícies claras, cor primária neutra e cores
  semânticas discretas, sem gradientes ou sombras decorativas.
- Os componentes reutilizáveis ficam em `components/ui` e são exportados por
  um único ponto de entrada.
- As propriedades dos componentes estendem os atributos nativos dos elementos
  HTML correspondentes para preservar acessibilidade, tipagem e composição.
- Variantes visuais são definidas por mapas tipados, sem lógica de negócio.
- `lib/class-names.ts` centraliza a composição de classes sem adicionar uma
  dependência externa.
- O layout existente passou a consumir os tokens semânticos, sem mudanças de
  arquitetura ou comportamento.

## Sprint 4 — estrutura base das páginas

- Prioridades, Conversas, Kanban e Configurações compartilham a mesma
  hierarquia de `PageContainer`, `PageHeader` e `EmptyState`.
- `PageContainer` aplica o espaçamento vertical padronizado entre seus filhos,
  preservando sua API anterior.
- Cada página permanece como Server Component estático, sem estado, ações,
  dados ou lógica de negócio.
- Os estados vazios usam textos neutros e o mesmo tratamento visual, variando
  somente o ícone Lucide adequado e o título da página no cabeçalho.
- A estrutura utiliza dimensões fluidas e quebra automática do `PageHeader`
  para atender desktop, notebook e tablet.

## Sprint 5 — página de Prioridades

- A página permanece um Server Component estático e recebe dados locais
  tipados, sem estado, efeitos ou eventos.
- Tipos, dados e componentes específicos ficam separados em `types/`,
  `lib/` e `components/prioridades/`, respectivamente.
- Os dados locais representam somente o modelo de apresentação necessário para
  esta página e já estão ordenados pela urgência definida no próprio arquivo.
- `Badge` passou a aceitar tons semânticos opcionais e `Card` passou a aceitar
  controle opcional de espaçamento; os valores padrão anteriores foram
  preservados.
- O tempo de espera combina tamanho, cor semântica e rótulo textual para não
  depender apenas de cor.
- O botão de atendimento é apenas visual e não possui evento ou navegação.
- A página usa uma lista principal detalhada e duas listas secundárias
  compactas para manter a hierarquia visual sem aparência de tabela.

## Sprint 6 — refinamento de UX de Prioridades

- A ordem visual dos clientes prioriza nome, tempo aguardando, próxima ação,
  contexto, status e canal, acompanhando a decisão que o corretor precisa tomar.
- Os contextos dos cards de resumo usam somente informações já presentes nos
  dados locais, sem cálculos dinâmicos ou novas regras de negócio.
- O card de respostas pendentes recebe destaque por superfície e proporção,
  reutilizando exclusivamente os tokens existentes.
- A próxima ação é apresentada como orientação informativa em uma superfície
  discreta; o botão de atendimento utiliza a variante visual `ghost`.
- A Sidebar permanece disponível a partir de tablet e a Topbar oferece um menu
  recolhível simples no celular, mantendo o restante do layout como Server
  Component.
- Alvos interativos do menu e da ação de atendimento possuem altura mínima de
  44 pixels, foco visível e rótulos acessíveis.
- Os espaçamentos móveis do `PageContainer` foram reduzidos com tokens já
  existentes, preservando a API do componente.

## Sprint 7 — domínio, usuários e privacidade

- Workspace é o limite conceitual de propriedade e isolamento de todos os dados
  do negócio.
- Usuário representa identidade global; papel, situação e acesso contextual
  pertencem ao vínculo do usuário com o workspace.
- Contato é o cadastro mestre. Cliente e lead são classificações do contato, e
  oportunidade representa uma negociação comercial independente.
- Conversa representa a thread e o histórico do canal; o conceito de
  atendimento permanece adiado até existir necessidade de sessões, filas ou
  métricas.
- Follow-up é um tipo de tarefa de trabalho e lembrete é uma configuração de
  aviso, evitando entidades sobrepostas no modelo inicial.
- Visibilidade da conversa, proteção do contato, papel e situação do vínculo
  formam o modelo conceitual de acesso; uma regra genérica de acesso não será
  criada nesta etapa. A atribuição, inicialmente considerada nesse contexto,
  foi consolidada na Sprint 8 apenas como responsabilidade operacional.
- OWNER e ATTENDANT são os únicos papéis do modelo inicial. Papéis adicionais
  permanecem como evolução futura.
- Acesso a conversas segue menor privilégio e negação por padrão, incluindo
  conteúdo, metadados, busca, contadores, notificações, anexos e resultados
  derivados.
- Estado atual, histórico operacional, histórico comercial e auditoria de
  segurança são conceitos separados.
- Eventos de auditoria não duplicam conteúdo de mensagens ou anexos.
- Os pontos explicitamente mantidos na seção de decisões abertas de
  `docs/MODELO_DOMINIO.md` ainda dependem de confirmação do produto.

## Sprint 8 — consolidação de permissões e fluxos

- A primeira sincronização importa todos os contatos, números, conversas e
  grupos.
- Conversas individuais importadas ou novas são classificadas diretamente como
  comerciais e ficam acessíveis a todos os membros ativos do workspace.
- Não existe estado intermediário de revisão, pendência ou conversa
  desconhecida. O OWNER protege posteriormente uma conversa que seja pessoal.
- Todos os grupos importados e novos nascem como `OWNER ONLY`; somente o OWNER
  pode liberar ou restringir individualmente um grupo.
- Contato protegido torna privadas todas as conversas atuais e futuras, alcança
  todos os números associados e prevalece sobre qualquer atribuição.
- Proteger uma conversa individual afeta somente essa conversa e não altera
  automaticamente o contato ou suas outras conversas.
- Somente o OWNER pode proteger ou desproteger contatos, alterar privacidade,
  liberar grupos e modificar visibilidade.
- Em qualquer contexto protegido, busca, notificações, contadores, prévias,
  anexos, participantes, caches e dados derivados seguem a mesma restrição do
  registro principal.
- Pessoa, Lead, Cliente e Inativo são classificações do mesmo Contato, não
  entidades separadas.
- Atribuições representam responsabilidade operacional e não restringem o
  acesso dos demais membros ativos às informações comerciais.

## Finalização da Sprint 8 — consolidação das pendências

- O ImobFlux adota um modelo colaborativo: todos os membros ativos do workspace
  podem visualizar e editar informações comerciais.
- Não existem restrições de edição entre atendentes para dados comerciais. As
  exceções continuam sendo isolamento entre workspaces, conversas privadas,
  contatos protegidos, grupos não liberados e ações administrativas exclusivas
  do OWNER.
- Toda alteração relevante deve registrar ator, alvo, momento, resultado e
  contexto mínimo na auditoria.
- Somente o OWNER pode exportar dados do sistema, incluindo contatos,
  conversas, oportunidades, anexos, relatórios, tarefas, notas, configurações e
  auditoria.
- ATTENDANT não possui permissão de exportação.
- Não existe exclusão definitiva durante o uso normal. Registros devem ser
  arquivados ou inativados, preservando autorias, relacionamentos, históricos e
  auditoria.
- Exclusão física não é uma ação disponível aos usuários e fica restrita a
  rotinas técnicas futuras.
- Quando um contato protegido passa a ser comercial, somente as conversas
  futuras podem ser compartilhadas com a equipe. Todo o histórico anterior
  permanece privado e a mudança não possui efeito retroativo.
- A auditoria é permanente, imutável e não pode ser apagada. Somente o OWNER
  pode consultá-la integralmente.
- Quando um funcionário deixa o workspace, todas as autorias históricas são
  preservadas, nenhum registro é transferido para outro usuário e a auditoria
  continua identificando quem executou cada ação.
- As decisões resolvidas deixaram de constar como pendentes. Questões de produto
  não abrangidas por esta consolidação continuam explicitamente abertas nos
  documentos de domínio, permissões e fluxos, sem gerar autorização implícita.

## Consolidação final anterior à modelagem lógica

- O sistema evita classificações temporárias. Toda conversa individual nova ou
  importada nasce `COMERCIAL`, inclusive quando o contato ainda não foi
  identificado ou qualificado.
- Conversas associadas a contato ou ponto de contato já protegido permanecem
  privadas. Grupos são a exceção estrutural: todos nascem e permanecem
  `OWNER ONLY` até eventual liberação individual.
- Conversas privadas são completamente invisíveis para ATTENDANT. Sua
  existência não aparece em listas, buscas, filtros, resultados, notificações,
  contadores ou indicadores.
- Somente o OWNER pode liberar individualmente uma conversa privada. A
  liberação não remove a proteção do contato, não libera outras conversas e não
  altera o histórico anterior, que continua privado.
- A liberação estabelece um marco temporal: somente mensagens e anexos futuros
  podem adquirir visibilidade comercial.
- O MVP permite um único número de WhatsApp conectado por workspace e atende
  uma equipe de três a cinco funcionários. O domínio deve admitir múltiplas
  conexões futuras sem remodelagem estrutural.
- Toda mensagem enviada ou recebida diretamente pelo WhatsApp deve ser
  sincronizada. Mensagem originada fora do CRM é identificada como sincronizada
  do WhatsApp e não recebe autoria interna presumida.
- Mensagens enviadas pelo CRM preservam o usuário responsável como autor da
  ação.
- A auditoria registra alterações, movimentações, respostas, atribuições,
  mudanças de estágio, alterações de privacidade, exportações e ações
  administrativas.
- Eventos de simples visualização não são registrados na auditoria do MVP.

## Sprint 9 — modelagem lógica do banco

- O modelo lógico inicial possui 18 tabelas e permanece independente de SQL,
  migrations, ORM, autenticação e políticas RLS.
- Identificadores internos usam UUID. Paginação de alto volume usa timestamp de
  negócio mais UUID como cursor, sem depender da ordenação do identificador.
- Estados internos usam `text` controlado por `CHECK`, evitando PostgreSQL ENUM
  rígido. Etapas configuráveis continuam em tabela própria.
- `app_users` representa a identidade durável do domínio e poderá possuir uma
  referência nullable e única a `auth.users`, preservando autoria caso a
  identidade de autenticação seja removida.
- `workspace_id` é repetido somente nas tabelas do tenant em que fortalece RLS,
  índices ou integridade. FKs compostas impedem relações entre workspaces.
- FKs de negócio usam `RESTRICT` ou `NO ACTION` como padrão. Não há remoção em
  cascata de dados operacionais, históricos ou auditoria.
- A invariável de no máximo um OWNER ativo usa unicidade parcial; a existência
  obrigatória de um OWNER ao fim da transação exigirá validação diferível na
  implementação futura.
- Classificação comercial do contato (`person`, `lead`, `client`) foi separada
  do estado operacional (`active`, `inactive`). Essa normalização representa
  “Inativo” sem misturá-lo à progressão comercial.
- Um ponto externo ainda não identificado é um `contact_point` com `contact_id`
  nulo. Participantes referenciam ponto ou membro por FKs mutuamente exclusivas,
  sem alvo polimórfico.
- O relacionamento N:N já previsto entre oportunidade e conversa é
  materializado em `opportunity_conversations`, com vínculo e desvínculo
  temporais.
- A privacidade temporal usa proteção atual e `commercial_visible_from` em
  contato, ponto e conversa. Mensagens usam `occurred_at`; anexos herdam a
  mensagem. Não há flag de privacidade duplicada por conteúdo.
- Atribuições de conversa atuais e históricas compartilham
  `conversation_assignments`; `ended_at` nulo identifica responsabilidade
  atual e não participa da autorização.
- Tarefas usam FKs explícitas nullable para contato, oportunidade e conversa,
  exigindo ao menos um contexto. Notas exigem exatamente um contexto.
- Mensagens possuem unicidade externa por conexão e chave local de
  idempotência para envios do CRM, permitindo reconciliar webhook, retry e
  sincronização sem duplicidade.
- A identidade externa de uma conexão é única por provedor em todo o sistema,
  impedindo que a mesma origem seja ingerida simultaneamente por workspaces
  diferentes.
- Arquivamento é ortogonal aos estados de negócio: oportunidades preservam o
  resultado `open`, `won` ou `lost`, e tarefas preservam `pending`, `completed`
  ou `cancelled` mesmo quando arquivadas.
- Metadados de anexo ficam separados do armazenamento e usam chave privada, sem
  URL pública permanente.
- Auditoria usa alvo lógico `target_type + target_id` sem FK polimórfica,
  justificadamente, para preservar eventos append-only mesmo diante de mudanças
  técnicas futuras.
- `last_message_at`, `last_message_id`, `unread_count`, contadores e resumos não
  são armazenados inicialmente por risco de inconsistência e vazamento de
  conteúdo anterior ao marco de privacidade.
- A restauração de atribuições após reativação e a transferência de propriedade
  continuam adiadas; a estrutura não impede sua implementação futura.

## Sprint 10 — schema PostgreSQL e migrations

- O schema inicial usa `public`, com cinco migrations cronológicas e
  determinísticas na estrutura mínima do Supabase CLI.
- Nenhuma extensão de produção é necessária. UUIDs usam `gen_random_uuid()` do
  PostgreSQL atual.
- `app_users.auth_user_id` permanece nullable e UNIQUE, sem FK para
  `auth.users`; a integração e o `ON DELETE SET NULL` ficam para a sprint de
  autenticação.
- RLS permanece desabilitada e nenhuma policy é criada nesta sprint.
- Todas as 55 FKs usam `ON DELETE RESTRICT`; não existe cascata em dados de
  negócio, históricos ou auditoria.
- Um membership removido pode ter `user_id` nulo somente quando representa
  convite cancelado antes do aceite, com e-mail, convite e remoção preservados e
  `activated_at` nulo. Vínculos já ativados preservam `user_id`.
- Um UNIQUE parcial de OWNER não removido garante também no máximo um OWNER
  ativo, sem índice parcial redundante.
- Uma função reutilizável mantém `updated_at` nas 12 tabelas mutáveis que possuem
  a coluna.
- Uma função técnica de proteção impede `UPDATE` e `DELETE` em
  `pipeline_history` e `audit_events`, materializando o comportamento
  append-only sem gerar eventos automaticamente.
- Mensagens WhatsApp exigem timestamps externo e de recebimento, mas o banco não
  compara rigidamente a ordem entre relógios de sistemas distintos;
  `occurred_at` permanece o instante canônico de ordenação e privacidade.
- Funções usam `search_path` restrito, não usam `SECURITY DEFINER` e não contêm
  lógica de negócio.
- A validação estrutural é especificada em 48 testes pgTAP transacionais, sem
  seed funcional ou dados reais. pgTAP é habilitado somente durante o teste.
- Migrations são forward-only. Correções posteriores devem ser novas migrations;
  não são fornecidos scripts destrutivos de rollback.

## Sprint 10.1 — correções de integridade do schema

- As cinco migrations da Sprint 10 permanecem preservadas. As correções são
  aplicadas por uma sexta migration forward-only, mantendo as 18 tabelas do
  modelo.
- `public.set_updated_at()` usa `statement_timestamp()` para representar o
  início da instrução que realiza a alteração, inclusive quando há múltiplas
  instruções dentro da mesma transação. A função continua única, com
  `search_path` restrito, sem `SECURITY DEFINER`, e os 12 triggers existentes
  permanecem conectados a ela.
- O trigger de `updated_at` sempre substitui o valor informado pelo cliente.
- `pipeline_history` e `audit_events` rejeitam `UPDATE`, `DELETE` e `TRUNCATE`.
  A proteção contra truncamento usa triggers por instrução e reutiliza o mesmo
  guard técnico append-only, sem introduzir lógica de negócio.
- `workspace_members.invited_by_member_id` é obrigatório para memberships
  originados por convite. A única representação local com autor nulo corresponde
  ao OWNER criado sem convite: exige papel OWNER, `user_id` e `activated_at`, e
  proíbe e-mail e timestamps de convite.
- O membership do OWNER inicial sem convite permanece estruturalmente válido em
  todo o lifecycle aprovado: `active`, `suspended` ou `removed`, respeitando as
  constraints de lifecycle e timestamps existentes.
- Autorreferência em `invited_by_member_id` é rejeitada. A FK composta existente
  continua garantindo que o autor pertença ao mesmo workspace.
- Uma futura transferência que rebaixe o OWNER inicial para ATTENDANT exige
  decisão adicional de modelagem, pois o registro atual não possui um campo
  histórico que indique sua criação original pelo sistema. Nenhuma coluna foi
  adicionada nesta sprint.
- A constraint UNIQUE comum de `app_users.auth_user_id` foi substituída por um
  índice UNIQUE parcial explícito com `WHERE auth_user_id IS NOT NULL`, alinhando
  a implementação ao modelo lógico e preservando múltiplos valores nulos.
- A suíte pgTAP foi ampliada para 72 verificações, cobrindo as correções e as
  invariantes estruturais adicionais solicitadas. A execução desses testes
  depende de PostgreSQL/Supabase com pgTAP disponível.

## Sprint 12 — autenticação local e bootstrap inicial

- A aplicação usa `@supabase/supabase-js@2.110.8` e
  `@supabase/ssr@0.12.3`. A primeira versão declara Node `>=22.0.0`; a segunda
  não declara `engines`, enquanto Next.js 16.2.12 exige Node `>=20.9.0`. Por
  isso, o requisito consolidado do projeto passa a ser Node 22 ou superior.
- A configuração usa nomes neutros para a chave pública de baixo privilégio e
  a chave administrativa server-side. O Supabase CLI 2.111.0 local fornece
  tanto `PUBLISHABLE_KEY`/`SECRET_KEY` quanto `ANON_KEY`/`SERVICE_ROLE_KEY`;
  qualquer par compatível pode preencher as variáveis sem alterar o código.
- O cliente administrativo usa `@supabase/supabase-js` diretamente, sem cookies,
  persistência de sessão ou compartilhamento com os clientes SSR. Sua chave é
  lida somente no servidor.
- Next.js 16 usa `proxy.ts` para renovação otimista da sessão. A autorização
  efetiva das rotas privadas é repetida no layout do servidor com `getUser()` e
  verificação de `app_user`, membership e workspace ativos.
- Login e logout usam Server Actions, origem validada e redirecionamentos fixos.
  Login autenticado sem identidade durável ou membership ativo é rejeitado e a
  sessão recém-criada é encerrada localmente.
- O bootstrap inicial usa uma tela controlada por token server-side de alta
  entropia. O token trafega apenas no corpo `POST`, é comparado em tempo
  constante por digest e não pode aparecer em URLs, logs, erros ou bundles.
- O bootstrap é global e único para o MVP individual: qualquer workspace
  existente o fecha. Essa decisão não modela a criação futura de outros
  workspaces; o provisionamento posterior exigirá operação administrativa
  própria.
- `public.bootstrap_initial_workspace(...)` usa `SECURITY INVOKER`, `search_path`
  vazio, objetos qualificados e advisory transaction lock. A função cria
  atomicamente `app_user`, workspace, OWNER inicial e auditoria. Somente
  `service_role` possui `EXECUTE`.
- A criação de Auth user ocorre antes do RPC e não participa da transação
  PostgreSQL. Depois de qualquer erro reportado pelo RPC, a aplicação consulta
  `app_users` pelo UUID criado: registro encontrado confirma o domínio e impede
  compensação; ausência confirmada permite excluir somente esse UUID; falha da
  própria reconciliação produz resultado ambíguo e nunca exclui o Auth user.
  Nunca há busca ou exclusão compensatória por e-mail.
- O workspace inicial usa `America/Maceio`. Um seletor de fuso não faz parte
  desta sprint.
- `app_users.auth_user_id` referencia `auth.users(id)` com `ON DELETE SET NULL`.
  A remoção da credencial preserva a identidade durável, membership, workspace
  e autorias históricas.
- Enquanto RLS estiver desabilitada, `anon` e `authenticated` não possuem nas 18
  tabelas grants de `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`,
  `REFERENCES` ou `TRIGGER`. A chave pública serve somente ao Auth nesta sprint.
- Uma oitava migration forward-only concede à `service_role` somente `SELECT`
  em `app_users`, `workspaces` e `workspace_members`, e `INSERT` nessas três
  tabelas e em `audit_events`. Antes dos grants mínimos, eventuais privilégios
  residuais nas 18 tabelas são revogados. Nenhum outro privilégio de tabela é
  mantido para essa role.
- A aplicação não pode ser publicada antes da implementação de RLS e policies.
  A sprint futura deverá reatribuir apenas grants mínimos e validar isolamento
  por workspace e privacidade.
- Playwright usa o canal do Chrome x64 já instalado; nenhum navegador adicional
  é baixado. Testes cobrem autenticação, sessão e acesso, enquanto testes de
  unidade cobrem sucesso, falha anterior ao RPC, reconciliação positiva,
  ausência confirmada, resultado ambíguo, compensação e Auth user órfão.

## Sprint 13 — RLS do OWNER individual

- Foi adotada a abordagem incremental: a primeira versão autoriza somente o
  OWNER autenticado, ativo e vinculado a workspace ativo. ATTENDANT permanece
  sem acesso nesta etapa, sem remover a estrutura multipapel do domínio.
- RLS está habilitada nas 18 tabelas. Cada tabela possui exatamente uma policy
  de `SELECT` para `authenticated`; não existem policies de `INSERT`, `UPDATE`
  ou `DELETE`.
- `authenticated` recebe somente `SELECT` nas 18 tabelas e continua sem
  `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES` ou `TRIGGER`. `anon`
  permanece sem qualquer grant e os privilégios mínimos da `service_role` não
  são ampliados.
- `private.active_owner_context()` centraliza a resolução de `auth.uid()` para
  `app_user_id`, `member_id` e `workspace_id`. A função é `STABLE`, não aceita
  parâmetros, pertence a `postgres`, usa `search_path` vazio, objetos
  totalmente qualificados e nenhum SQL dinâmico.
- A função privada é a única `SECURITY DEFINER` dos schemas da aplicação. Essa
  característica é necessária para consultar as próprias tabelas protegidas
  sem recursão de RLS. `authenticated` possui somente `USAGE` no schema privado
  e `EXECUTE` na função; `PUBLIC`, `anon` e `service_role` não podem executá-la.
- `app_users` expõe somente a identidade durável do próprio OWNER ativo;
  `workspaces` expõe somente o workspace ativo autorizado;
  `workspace_members` expõe os vínculos desse workspace; as demais tabelas são
  filtradas diretamente por `workspace_id`.
- A privacidade temporal não adiciona filtros para OWNER, que pode consultar o
  histórico integral do próprio workspace. Os campos existentes permanecem
  preparados para policies de ATTENDANT sem flags duplicadas.
- O DAL da versão individual exige explicitamente `role = owner`, repetindo no
  servidor a restrição que o banco aplica aos dados.
- A escrita será liberada progressivamente pelos módulos Contatos,
  Oportunidades/Kanban, Tarefas/Prioridades, Histórico e
  Conversas/Integração. Cada liberação deverá entregar conjuntamente grants
  mínimos, policies `USING` e `WITH CHECK`, operação transacional, auditoria e
  testes específicos.
- Testes de `WITH CHECK` permanecem deliberadamente adiados porque a Sprint 13
  não possui grant nem policy de escrita.
- Nenhum índice foi acrescentado. A autorização reutiliza o índice parcial de
  `app_users.auth_user_id`, os índices de membership e a PK de workspaces.

## Sprint 14 — módulo vertical de Contatos

- O primeiro módulo funcional permanece limitado ao OWNER individual ativo. A
  estrutura multiworkspace foi preservada, mas ATTENDANT, convites, equipe e
  transferência de OWNER continuam fora da interface e dos fluxos de escrita.
- Contatos recebem leitura pela policy RLS já existente e escrita somente por
  cinco RPCs transacionais: criar, editar, mudar estado operacional, arquivar e
  restaurar. Não há grant direto de escrita para `authenticated` e não houve
  ampliação dos privilégios da `service_role`.
- As RPCs derivam `workspace_id` e `member_id` apenas da sessão via
  `private.active_owner_context()` e rejeitam qualquer chamada sem exatamente um
  OWNER ativo. Elas são as únicas novas `SECURITY DEFINER` aprovadas, pertencem
  a `postgres`, usam `search_path` vazio, objetos qualificados e nenhum SQL
  dinâmico. `PUBLIC`, `anon` e `service_role` não podem executá-las.
- O cadastro inicia como `lead`, `active` e não protegido. Campos de
  privacidade não são aceitos pelas operações do módulo. Não existe hard delete:
  o ciclo disponível é inativar/reativar e arquivar/restaurar.
- O telefone é opcional e aceita somente números brasileiros de 10 ou 11
  dígitos, com ou sem o prefixo `55`. O valor normalizado é armazenado como
  `+55...` e a apresentação digitada é preservada. Não há inferência de DDD,
  alteração de dígitos, telefone principal ou suporte internacional.
- A edição com mais de um telefone ativo é recusada tanto pela interface quanto
  pela RPC. A listagem informa esse estado sem escolher, remover ou expor um
  número arbitrariamente. Uma decisão de produto futura será necessária para
  editar múltiplos telefones.
- Contato, telefone e auditoria são atômicos. Os eventos de auditoria registram
  somente ação, alvo, ator e flags técnicas; nome, telefone e conteúdo do
  formulário nunca entram em `audit_events`.
- A listagem usa paginação por offset de 20 itens no MVP, com busca por nome ou
  telefone normalizado e filtros por classificação, estado operacional e
  arquivamento. Não foi acrescentado índice trigram, coluna de telefone
  principal nem alteração especulativa no modelo.

## Padrões Arquiteturais e Decisões de Sistema (ADRs)

### 1. RPCs de Leitura com `SECURITY INVOKER` e RLS
- **Decisão**: Toda RPC de leitura agregada (como `get_prioridades_dashboard` e `get_conversations_list`) deve ser criada com `SECURITY INVOKER` e sem parâmetro `workspace_id`.
- **Racional**: A execução ocorre no contexto de privilégios do usuário autenticado chamador, deixando o isolamento de tenant 100% a cargo das políticas de RLS ativas nas tabelas de domínio subjacentes.

### 2. Paginação por Cursor Estável para Listas de Atividade
- **Decisão**: Telas com atividade contínua e ordenação por data (como a lista de conversas) devem utilizar paginação por cursor estável `(timestamp_coluna DESC, id_coluna DESC)` em vez de `OFFSET`.
- **Racional**: O uso de `OFFSET` causa duplicação ou omissão de registros quando novas mensagens chegam durante a navegação do usuário. O cursor estável garante previsibilidade e integridade do lote.

### 3. Separação Estrita entre Funções Server-Only e Server Actions
- **Decisão**: Funções de consulta de dados para Server Components devem ser mantidas em arquivos `server-only` (`lib/<domain>/data.ts`). As Server Actions (`"use server"` em `lib/<domain>/actions.ts`) destinam-se exclusivamente a submissões de formulário e chamadas assíncronas disparadas por Client Components.
- **Racional**: Evita expor endpoints de leitura desnecessários como Server Actions acessíveis publicamente e mantém a separação clara de responsabilidades entre RSC e cliente.

### 4. Governança da Documentação como Single Source of Truth (SOT)
- **Decisão**: Foi instituída a política permanente de governança documental ([docs/DOCUMENTATION_POLICY.md](file:///C:/Users/User/Desktop/PROJETOS/CRM%20Corretor/docs/DOCUMENTATION_POLICY.md)).
- **Racional**: O arquivo `STATUS_PROJETO.md` centraliza o estado vivo atual do repositório, `ROADMAP.md` isola o planejamento futuro, `ARQUITETURA.md` define os padrões do sistema, e a pasta `docs/sprints/` preserva o histórico imutável por sprint, eliminando a duplicação de informações e divergências de contexto.

### 5. Índices Parciais para Atributos de Remetente de Mensagem (`messages`)
- **Decisão**: Índices para chaves estrangeiras de remetente na tabela `messages` (`sender_contact_point_id` e `internal_author_member_id`) devem ser criados com predicados parciais `WHERE coluna IS NOT NULL`.
- **Racional**: Como mensagens recebidas e enviadas populam colunas de remetente distintas, o índice parcial evita a indexação de valores nulos, reduzindo o consumo de armazenamento no disco e mantendo a escrita otimizada.



