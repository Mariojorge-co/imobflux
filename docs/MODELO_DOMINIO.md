# Modelo conceitual do domínio do ImobFlux

Status: modelo conceitual final consolidado antes da modelagem lógica.

Este documento descreve o domínio do produto sem definir tabelas, estruturas de
banco de dados, APIs ou mecanismos de autenticação. Recomendações de segurança
não substituem as decisões de produto identificadas como abertas.

## 1. Objetivo

Definir uma linguagem comum e um modelo conceitual mínimo para orientar, em
etapas futuras:

- tipos de domínio;
- modelagem PostgreSQL;
- autenticação e associação de usuários;
- políticas de acesso;
- APIs;
- integração com WhatsApp;
- auditoria e testes de segurança.

O modelo atende inicialmente um proprietário e poucos atendentes, sem acoplar o
domínio às telas atuais ou antecipar recursos de um CRM genérico.

## 2. Princípios do domínio

- **Workspace como limite de isolamento:** todo dado comercial ou operacional
  pertence a um workspace. O acesso nunca deve atravessar esse limite.
- **Colaboração comercial:** todos os membros ativos do workspace podem
  visualizar e editar informações comerciais. Atribuições definem
  responsabilidade operacional, não uma fronteira de acesso.
- **Classificação direta:** conversas não utilizam estados intermediários,
  quarentena, pendência ou classificação temporária. Conversas individuais
  nascem comerciais, salvo proteção explícita já existente; grupos nascem
  privados por regra do produto.
- **Menor privilégio administrativo e privado:** configurações administrativas,
  auditoria e conteúdos privados continuam limitados pelo papel e pelas regras
  de proteção.
- **Negação por padrão:** ausência de uma autorização válida significa ausência
  de acesso.
- **Privacidade além da interface:** conteúdo e metadados protegidos devem ser
  filtrados no servidor, nas consultas, no banco, nas buscas, nos contadores,
  nas notificações, nos anexos e em qualquer dado derivado.
- **Cadastro separado de atividade:** contato descreve uma pessoa ou
  organização; conversa, oportunidade e tarefa descrevem acontecimentos ou
  trabalho relacionado.
- **Estado atual separado de histórico:** o registro atual responde como algo
  está agora; históricos explicam como chegou a esse estado.
- **Conversa não é processo comercial:** mensagens pertencem à conversa; etapa
  comercial pertence à oportunidade.
- **Permissões contextuais:** o papel do usuário não basta sozinho. O acesso
  também depende de workspace, situação do vínculo, natureza comercial ou
  privada do registro, visibilidade e proteção do contato.
- **Revogação efetiva:** retirar uma permissão deve interromper imediatamente
  acesso direto e indireto, inclusive a arquivos e dados derivados.
- **Auditoria sem cópia de conteúdo:** eventos registram ação, ator, alvo,
  momento e resultado, sem duplicar mensagens ou anexos.
- **Sem exclusão definitiva no uso normal:** registros são arquivados ou
  inativados. Exclusão física fica reservada a rotinas técnicas futuras.
- **Auditoria permanente:** eventos de auditoria são imutáveis e não podem ser
  apagados.
- **Auditoria de ação, não de leitura:** simples visualizações não geram eventos
  de auditoria no MVP.

## 3. Glossário

### Workspace

Ambiente isolado de trabalho pertencente ao negócio do corretor. Reúne membros,
contatos, configurações e dados operacionais.

### Usuário

Identidade de uma pessoa que pode participar de um ou mais workspaces. Não
carrega, por si só, papel ou acesso a dados de um workspace específico.

### Membro do workspace

Vínculo entre usuário e workspace. Define papel, situação do vínculo e escopo
administrativo básico.

### Contato

Cadastro mestre de uma pessoa ou organização conhecida pelo workspace. Pode
existir antes de qualquer relação comercial.

### Ponto de contato

Identificador usado para comunicação, como número de telefone ou endereço
externo de um canal. Permite representar vários números do mesmo contato e
identificadores ainda não associados a um contato conhecido.

### Cliente

Classificação de um contato que possui relação comercial relevante. Não é uma
entidade separada no modelo inicial.

### Lead

Condição de aquisição ou qualificação de um contato. Não representa uma
negociação independente e, por isso, não é uma entidade separada no modelo
inicial.

### Oportunidade

Possibilidade comercial concreta acompanhada ao longo de um funil. Um contato
pode possuir mais de uma oportunidade em momentos ou contextos diferentes.

### Situação do contato e etapa do funil

A situação do contato descreve sua condição cadastral ou operacional, como
estar ativo ou inativo. A etapa do funil descreve a posição comercial de uma
oportunidade específica. Um contato com várias oportunidades pode ter cada uma
em uma etapa diferente; por isso, a etapa nunca deve ser gravada como situação
do contato.

### Conversa

Thread persistente de comunicação em um canal. Contém participantes e
mensagens, mas não representa etapa comercial ou sessão de trabalho.

### Atendimento

Possível período de trabalho sobre uma conversa, com início, encerramento,
responsável e métricas. O conceito está adiado até que uma necessidade real de
sessões, filas ou medição justifique sua existência.

### Tarefa de trabalho

Unidade operacional com prazo e responsável. Follow-up é um tipo de tarefa;
lembrete é uma forma de avisar sobre a tarefa.

### Conversa privada

Conversa cuja visibilidade efetiva impede acesso por membros não autorizados.
É um estado de acesso da conversa, não uma entidade independente. Sua proteção
afeta somente a conversa escolhida e não altera automaticamente as demais
conversas ou o contato. Para ATTENDANT, sua existência e todos os seus
metadados são invisíveis. Quando o OWNER a libera, o histórico anterior
permanece privado e a visibilidade comercial vale somente após o marco da
liberação.

### Contato protegido

Contato cuja política de proteção restringe, por padrão, suas conversas e
pontos de contato. É uma política aplicada ao contato, não outro cadastro.

### Histórico

Registro temporal de uma mudança relevante. Históricos não substituem o estado
atual e não devem ser alterados para simular o presente.

### Auditoria

Registro imutável de ações relevantes para segurança, responsabilização e
investigação.

## 4. Entidades aprovadas

### 4.1 Workspace

- **Responsabilidade:** delimitar propriedade, isolamento e configurações do
  negócio.
- **Dados conceituais essenciais:** identificação, nome, situação, fuso horário
  e configurações administrativas.
- **Relacionamentos:** possui membros, contatos, etapas do funil, conexões de
  canal e todos os registros operacionais.
- **Cardinalidade principal:** um workspace possui um proprietário ativo e pode
  possuir vários atendentes.
- **Ciclo de vida:** criado, ativo, eventualmente suspenso ou encerrado. O
  encerramento não transfere dados para outro workspace.
- **Não pertence à entidade:** credenciais pessoais do usuário, conteúdo de
  mensagens ou regras específicas de uma conversa.

### 4.2 Usuário

- **Responsabilidade:** representar a identidade da pessoa que usa o sistema.
- **Dados conceituais essenciais:** identificação, nome de exibição, referência
  de identidade futura e situação global.
- **Relacionamentos:** pode possuir vínculos com zero ou mais workspaces.
- **Cardinalidade principal:** um usuário pode ser membro de vários workspaces;
  cada vínculo pertence a um único usuário.
- **Ciclo de vida:** convidado por meio de um vínculo, ativo e eventualmente
  desativado. A desativação não apaga autoria histórica.
- **Não pertence à entidade:** papel, atribuições ou permissões de um workspace
  específico.

### 4.3 Membro do workspace

- **Responsabilidade:** representar o vínculo de um usuário com um workspace.
- **Dados conceituais essenciais:** usuário, workspace, papel, situação do
  vínculo e datas relevantes do convite e da ativação.
- **Relacionamentos:** pode receber conversas, oportunidades e tarefas; pode ser
  ator de históricos e auditoria.
- **Cardinalidade principal:** um workspace possui muitos membros; o mesmo
  usuário possui no máximo um vínculo ativo por workspace.
- **Ciclo de vida:** convidado, ativo, suspenso ou removido. Suspensão e remoção
  revogam acesso, mas preservam referências e autorias históricas. O
  desligamento não transfere registros ou autorias para outro usuário.
- **Não pertence à entidade:** dados pessoais duplicados do usuário ou conteúdo
  acessado pelo membro.

### 4.4 Contato

- **Responsabilidade:** manter a identidade comercial conhecida de uma pessoa
  ou organização.
- **Dados conceituais essenciais:** nome de exibição, classificação de
  relacionamento, situação operacional, observações cadastrais mínimas e
  política atual de proteção.
- **Relacionamentos:** pertence a um workspace; pode possuir vários pontos de
  contato, conversas, oportunidades, tarefas, notas e etiquetas no futuro.
- **Cardinalidade principal:** um workspace possui muitos contatos; um contato
  pode possuir zero ou muitas oportunidades e zero ou muitas conversas.
- **Ciclo de vida:** Pessoa, Lead, Cliente ou Inativo. Essas classificações
  pertencem ao mesmo contato; a transformação não cria outro cadastro.
  Arquivamento ou inativação preservam conversas, oportunidades e históricos.
- **Não pertence à entidade:** etapa do funil, histórico de mensagens ou
  responsável por uma conversa específica.

### 4.5 Ponto de contato

- **Responsabilidade:** representar um endereço externo pelo qual alguém pode
  participar de conversas.
- **Dados conceituais essenciais:** tipo de canal, identificador normalizado,
  nome externo opcional, situação da associação e proteção específica quando
  necessária.
- **Relacionamentos:** pertence ao workspace; pode ser associado a um contato e
  referenciado por participantes de conversas.
- **Cardinalidade principal:** um contato pode possuir vários pontos; um ponto
  pode permanecer sem contato associado enquanto ainda não for identificado.
- **Ciclo de vida:** descoberto, associado, corrigido, desassociado ou
  desativado. Reassociações sensíveis devem ser auditadas.
- **Não pertence à entidade:** conteúdo de conversa, classificação comercial ou
  credenciais da conexão de canal.

### 4.6 Conexão de canal

- **Responsabilidade:** representar um canal externo conectado ao workspace,
  como uma futura conta de WhatsApp.
- **Dados conceituais essenciais:** provedor, identificador externo do canal,
  situação da conexão e configurações de sincronização e privacidade.
- **Relacionamentos:** pertence a um workspace e origina muitas conversas.
- **Cardinalidade principal:** um workspace pode possuir várias conexões ao
  longo de sua evolução. No MVP, no máximo uma conexão de WhatsApp pode estar
  ativa por workspace.
- **Ciclo de vida:** configurada, ativa, pausada, desconectada ou substituída.
- **Não pertence à entidade:** mensagens, contatos ou segredos expostos a
  usuários sem autorização.

### 4.7 Conversa

- **Responsabilidade:** representar uma thread de comunicação e seu contexto de
  acesso.
- **Dados conceituais essenciais:** workspace, conexão de canal, identificador
  externo da thread, tipo individual ou grupo, situação operacional e
  visibilidade atual.
- **Relacionamentos:** possui participantes e mensagens; pode estar associada a
  contatos, oportunidades, tarefas, notas e membros atribuídos.
- **Cardinalidade principal:** uma conexão origina muitas conversas; uma
  conversa possui muitos participantes e muitas mensagens.
- **Ciclo de vida:** descoberta ou importada, classificada, ativa, arquivada e,
  quando aplicável, protegida ou liberada pelo OWNER. Conversas individuais
  nascem `COMERCIAL`, sem estado intermediário. Conversas em grupo nascem como
  `OWNER ONLY` e somente o OWNER pode liberá-las individualmente.
- **Não pertence à entidade:** conteúdo das mensagens, etapa comercial ou papel
  administrativo dos usuários.

### 4.8 Participante da conversa

- **Responsabilidade:** representar quem participa de determinada conversa.
- **Dados conceituais essenciais:** conversa, tipo de participante, ponto de
  contato ou membro relacionado e nome externo apenas quando permitido.
- **Relacionamentos:** liga conversa a contato, ponto de contato, membro ou
  participante externo ainda não identificado.
- **Cardinalidade principal:** uma conversa possui muitos participantes; um
  contato ou ponto de contato pode participar de muitas conversas.
- **Ciclo de vida:** incluído, atualizado e removido da conversa. Em grupos,
  mudanças de participantes podem exigir nova avaliação de privacidade.
- **Não pertence à entidade:** cadastro completo do contato ou cópia permanente
  de dados protegidos usados somente para exibição.

### 4.9 Mensagem

- **Responsabilidade:** representar uma unidade de comunicação dentro de uma
  conversa.
- **Dados conceituais essenciais:** conversa, remetente externo, direção,
  conteúdo, origem da captura (`CRM` ou `WHATSAPP`), autor interno opcional,
  momento externo, momento de recebimento e situação de entrega.
- **Relacionamentos:** pertence a uma conversa, possui um remetente e pode
  possuir vários anexos.
- **Cardinalidade principal:** uma conversa possui muitas mensagens; uma
  mensagem pertence a exatamente uma conversa.
- **Ciclo de vida:** recebida ou criada, enviada, entregue, falha ou marcada
  conforme eventual estado informado pelo canal. Não é excluída fisicamente
  durante o uso normal do sistema.
- **Autoria e origem:** mensagem enviada pelo CRM referencia o membro
  responsável. Mensagem enviada ou recebida diretamente no WhatsApp é
  sincronizada, identificada com essa origem e não recebe autoria interna
  presumida.
- **Não pertence à entidade:** etapa da oportunidade, atribuição da conversa ou
  cópias do conteúdo em auditoria.

### 4.10 Anexo

- **Responsabilidade:** representar um arquivo associado a uma mensagem.
- **Dados conceituais essenciais:** mensagem, tipo, nome seguro, tamanho,
  referência de armazenamento, integridade e situação.
- **Relacionamentos:** pertence a uma mensagem e herda o escopo de acesso da
  mensagem, inclusive o marco temporal de uma eventual liberação da conversa.
- **Cardinalidade principal:** uma mensagem pode possuir vários anexos; um anexo
  pertence a uma única mensagem.
- **Ciclo de vida:** identificado, armazenado, disponível, indisponível,
  arquivado ou inativado. Exclusão física fica reservada a rotina técnica
  futura.
- **Não pertence à entidade:** permissão pública permanente, URL irrestrita ou
  cópia do arquivo no evento de auditoria.

### 4.11 Atribuição de conversa

- **Responsabilidade:** representar quais membros são responsáveis atualmente
  por uma conversa comercial.
- **Dados conceituais essenciais:** conversa, membro, autor da atribuição e
  momento da atribuição.
- **Relacionamentos:** liga uma conversa a zero ou mais membros do mesmo
  workspace.
- **Cardinalidade principal:** uma conversa pode não possuir responsável ou
  possuir vários membros atribuídos; um membro pode receber muitas conversas.
- **Ciclo de vida:** criada, substituída ou encerrada. Cada mudança gera
  histórico operacional. A atribuição define responsabilidade de trabalho e
  não concede nem revoga acesso a informações comerciais.
- **Não pertence à entidade:** papel do membro, conteúdo da conversa ou
  permissão administrativa.

### 4.12 Oportunidade

- **Responsabilidade:** representar uma possibilidade comercial concreta.
- **Dados conceituais essenciais:** contato, título ou contexto, etapa atual,
  situação, responsável opcional e informações comerciais mínimas.
- **Relacionamentos:** pertence a um contato e a um workspace; referencia uma
  etapa do funil e pode se relacionar a conversas, tarefas e notas.
- **Cardinalidade principal:** um contato pode possuir várias oportunidades;
  cada oportunidade possui uma etapa atual.
- **Ciclo de vida:** aberta, movimentada pelo funil, ganha, perdida ou
  arquivada, com nomenclatura final a confirmar.
- **Não pertence à entidade:** cadastro do contato, mensagens ou histórico
  embutido de mudanças de etapa.

### 4.13 Etapa do funil

- **Responsabilidade:** definir uma posição comercial configurável dentro do
  workspace.
- **Dados conceituais essenciais:** nome, ordem, situação e significado
  comercial.
- **Relacionamentos:** pertence ao workspace e pode ser etapa atual de várias
  oportunidades.
- **Cardinalidade principal:** um workspace possui várias etapas; uma etapa pode
  classificar muitas oportunidades.
- **Ciclo de vida:** criada, reordenada, renomeada e desativada. Desativar não
  apaga históricos.
- **Não pertence à entidade:** condição operacional do contato ou eventos de
  mudança.

### 4.14 Histórico de etapa

- **Responsabilidade:** registrar cada mudança de etapa de uma oportunidade.
- **Dados conceituais essenciais:** oportunidade, etapa anterior, nova etapa,
  ator, momento e motivo opcional.
- **Relacionamentos:** pertence a uma oportunidade e referencia etapas e membro
  responsável pela mudança.
- **Cardinalidade principal:** uma oportunidade possui muitos registros de
  histórico; cada registro descreve uma única transição.
- **Ciclo de vida:** criado de forma somente acrescentável quando ocorre uma
  mudança válida.
- **Não pertence à entidade:** etapa atual ou cópia completa da oportunidade.

### 4.15 Tarefa de trabalho

- **Responsabilidade:** representar uma ação operacional pendente ou concluída.
- **Dados conceituais essenciais:** tipo, descrição curta, prazo, situação,
  prioridade operacional, responsável e referência ao contexto de trabalho.
- **Relacionamentos:** pertence ao workspace; deve estar ligada a pelo menos um
  contato, oportunidade ou conversa e pode possuir um membro responsável.
- **Cardinalidade principal:** um registro de contexto pode possuir muitas
  tarefas; uma tarefa possui no máximo um responsável atual no modelo inicial.
- **Ciclo de vida:** criada, agendada, concluída, cancelada ou vencida.
- **Não pertence à entidade:** mensagem, etapa comercial ou notificação já
  entregue. Follow-up é um tipo; lembrete é uma configuração de aviso.

### 4.16 Nota interna

- **Responsabilidade:** registrar contexto humano que não deve ser enviado ao
  contato.
- **Dados conceituais essenciais:** autor, conteúdo, momento e registro
  relacionado.
- **Relacionamentos:** pertence ao workspace e se relaciona a um contato,
  oportunidade ou conversa.
- **Cardinalidade principal:** um registro pode possuir muitas notas; cada nota
  possui um autor.
- **Ciclo de vida:** criada, editada e eventualmente arquivada, sempre
  preservando autoria e rastreabilidade. Não há remoção física no uso normal.
- **Não pertence à entidade:** mensagem ao cliente ou meio de contornar a
  privacidade do registro relacionado.

### 4.17 Evento de auditoria

- **Responsabilidade:** registrar ações relevantes para segurança e
  responsabilização.
- **Dados conceituais essenciais:** workspace, ator ou sistema, ação, tipo e
  identificação do alvo, momento, resultado e contexto técnico sanitizado.
- **Relacionamentos:** pertence a um workspace e pode referenciar membro,
  conversa, contato, anexo, oportunidade ou configuração.
- **Cardinalidade principal:** um workspace possui muitos eventos; um alvo pode
  estar associado a muitos eventos.
- **Ciclo de vida:** acrescentado de forma imutável e mantido permanentemente.
  Não pode ser editado ou apagado.
- **Regra do MVP:** registra ações e alterações relevantes, mas não registra
  simples visualizações.
- **Não pertence à entidade:** conteúdo duplicado de mensagens, binários,
  segredos, tokens ou dados pessoais desnecessários.

## 5. Entidades descartadas ou adiadas

| Conceito | Decisão inicial | Justificativa |
| --- | --- | --- |
| Perfil de usuário separado | Descartado no momento | Dados pessoais ficam em Usuário; papel e situação ficam no vínculo com o workspace. |
| Cliente | Não será entidade | É uma classificação de Contato. Duplicar o cadastro causaria divergência. |
| Lead | Não será entidade | É uma condição de aquisição ou qualificação; a negociação concreta é a Oportunidade. |
| Atendimento | Adiado | Conversa, atribuição e tarefa atendem o escopo atual. Deve voltar apenas se sessões, filas ou métricas exigirem. |
| Follow-up | Não será entidade separada | Será um tipo de Tarefa de trabalho. |
| Lembrete | Não será entidade separada inicialmente | Será uma configuração de aviso associada à tarefa. Múltiplos avisos podem justificar entidade futura. |
| Responsável pelo atendimento | Não será entidade | É uma relação entre Membro e Conversa, Oportunidade ou Tarefa. |
| Regra de acesso genérica | Descartada no modelo inicial | Visibilidade da conversa, proteção do contato, papel e situação do vínculo formam um modelo mais específico e auditável. |
| Conversa privada | Não será entidade | É uma condição de visibilidade da Conversa. |
| Contato protegido | Não será entidade | É uma política do Contato e, quando necessário, do Ponto de contato. |
| Marcador ou etiqueta | Adiado | Não é necessário para o fluxo inicial e sua aplicação a vários tipos aumentaria a generalidade do modelo. |
| Origem do lead | Adiada | Pode virar cadastro mestre quando captação e relatórios forem definidos. |
| Imóvel de interesse | Adiado | O escopo de catálogo de imóveis ainda não foi definido; o contexto pode permanecer na Oportunidade inicialmente. |
| Papéis adicionais | Adiados | Administrador, corretor, supervisor e visualizador dependem de necessidades reais de equipe. |

## 6. Relacionamentos e cardinalidades

- Um **Workspace** possui exatamente um proprietário ativo e zero ou muitos
  atendentes.
- Um **Workspace** possui muitos membros, contatos, etapas do funil, tarefas e
  eventos de auditoria.
- Um **Usuário** pode possuir vínculos com vários workspaces, mas no máximo um
  vínculo ativo em cada workspace.
- Um **Contato** pertence a um workspace e pode possuir vários pontos de
  contato.
- Um **Ponto de contato** pertence a um workspace e pode estar associado a zero
  ou um contato por vez.
- Um **Workspace** pode possuir várias conexões de canal; o limite do MVP ainda
  é uma conexão de WhatsApp ativa, sem impedir múltiplas conexões futuras no
  modelo.
- Uma **Conexão de canal** origina muitas conversas.
- Uma **Conversa** possui muitos participantes e muitas mensagens.
- Uma **Conversa** pode estar ligada a zero ou mais contatos. Conversas em grupo
  podem envolver vários contatos.
- Um **Participante** pertence a uma conversa e pode referenciar um ponto de
  contato, um membro ou uma identidade externa ainda não classificada.
- Uma **Mensagem** pertence a uma conversa e pode possuir vários anexos.
- Um **Anexo** pertence a exatamente uma mensagem e herda o acesso efetivo da
  conversa.
- Uma **Conversa** pode possuir zero ou mais membros atribuídos.
- Um **Membro** pode ser atribuído a muitas conversas.
- Um **Contato** pode possuir várias oportunidades.
- Uma **Oportunidade** possui uma etapa atual e muitos registros de histórico
  de etapa.
- Uma **Etapa do funil** pertence a um workspace e pode ser usada por muitas
  oportunidades.
- Uma **Tarefa de trabalho** pertence a um workspace, pode possuir um
  responsável e deve referenciar pelo menos um contexto comercial ou
  operacional.
- Uma **Nota interna** possui um autor e um registro principal relacionado.
- Um **Evento de auditoria** pertence a um workspace e pode referenciar um ator
  e um alvo sem copiar o conteúdo do alvo.

Relações nunca concedem acesso entre workspaces. Todos os membros ativos
compartilham o acesso aos registros comerciais do workspace, mas relações não
concedem acesso implicitamente a uma conversa privada ou a um contato
protegido. Por exemplo, ser responsável por uma oportunidade não libera
conversas privadas do contato.

## 7. Cadastros mestres

São cadastros que descrevem identidade, configuração ou referência estável:

- Workspace;
- Usuário;
- Membro do workspace;
- Contato;
- Ponto de contato;
- Etapa do funil;
- Conexão de canal, antes da integração;
- futuros cadastros de etiquetas e origens, caso sejam aprovados.

O estado comercial de uma oportunidade e o histórico de comunicação não devem
ser gravados nesses cadastros.

## 8. Dados operacionais

Representam trabalho ou acontecimentos correntes:

- Conversa;
- Participante da conversa;
- Mensagem;
- Anexo;
- Atribuição atual de conversa;
- Oportunidade;
- Tarefa de trabalho;
- Nota interna.

Cada registro operacional deve preservar o workspace de origem e respeitar a
visibilidade efetiva do contexto ao qual pertence. Em contexto comercial, todos
os membros ativos podem visualizar e editar o registro; atribuições indicam
responsabilidade operacional.

## 9. Históricos e auditoria

### Histórico operacional

Explica mudanças no trabalho diário:

- atribuição e remoção de responsáveis;
- mudança de situação de tarefas;
- envio e situação de entrega de mensagens;
- arquivamento ou reabertura de conversas.

### Histórico comercial

Explica evolução do relacionamento comercial:

- mudanças de etapa da oportunidade;
- encerramento como ganha ou perdida;
- mudanças comerciais relevantes que precisem de rastreabilidade.

### Auditoria de segurança

Registra ações sensíveis, incluindo:

- alterações de registros comerciais;
- movimentações operacionais;
- respostas enviadas pelo CRM;
- marcação ou remoção de privacidade;
- proteção ou desproteção de contato ou ponto de contato;
- concessão, revogação ou tentativa negada de acesso;
- atribuição, remoção ou troca de responsável;
- mudança de estágio da oportunidade;
- exportação;
- alteração administrativa;
- desativação ou remoção de membro.

Um evento de auditoria registra metadados mínimos e sanitizados. Não deve conter
corpo de mensagem, transcrição, miniatura, arquivo, token, URL pública ou cópia
de dados privados. A auditoria é permanente, não pode ser editada ou apagada e
somente o OWNER pode consultá-la integralmente. Listar, buscar ou abrir um
registro para simples visualização não gera evento de auditoria no MVP.

## 10. Usuários e papéis

### OWNER

- É o proprietário administrativo do workspace.
- Gerencia membros e configurações sensíveis.
- Pode proteger contatos e conversas.
- Pode conceder ou remover atribuições.
- Pode consultar auditoria.
- É o único papel autorizado a exportar dados do sistema.
- Possui acesso aos dados do próprio workspace, sujeito a controles técnicos de
  isolamento e integridade.
- É o único papel autorizado a alterar privacidade no modelo inicial.

O workspace possui um proprietário ativo. Transferência de propriedade é
possível evolução futura e deve ser auditada.

### ATTENDANT

- Pode visualizar e editar todos os registros comerciais do workspace enquanto
  seu vínculo estiver ativo.
- Não acessa conversas pessoais, privadas ou protegidas sem autorização válida.
- Não modifica configurações de privacidade.
- Não convida ou remove membros.
- Não consulta integralmente nem exporta a auditoria.
- Não exporta contatos, conversas, oportunidades, anexos, relatórios ou outros
  dados do sistema.
- Não recebe conteúdo protegido por busca, notificações, contadores, anexos ou
  acesso direto por identificador.

### Papéis futuros

Administrador, corretor, supervisor e visualizador podem ser avaliados quando
existirem diferenças reais de responsabilidade. Não devem ser implementados
antecipadamente como simples variações nominais.

Papel é uma autorização ampla. A decisão final de acesso a uma conversa depende
também do vínculo ativo, da natureza comercial ou privada, da visibilidade e da
proteção do contato. A atribuição não participa da autorização de registros
comerciais.

## 11. Modelo conceitual de permissões

### Escopos de visibilidade

O modelo conceitual utiliza dois escopos:

1. **Somente proprietário:** nenhum atendente acessa ou recebe metadados da
   conversa.
2. **Equipe comercial:** OWNER e todos os ATTENDANT ativos do workspace podem
   visualizar e editar o registro comercial.

Atribuição não é escopo de visibilidade. Ela identifica quem está responsável
pelo trabalho, sem restringir a colaboração dos demais membros ativos.

### Avaliação de acesso

Uma autorização futura deve considerar, nesta ordem conceitual:

1. o registro pertence ao workspace solicitado;
2. o usuário possui vínculo ativo com o workspace;
3. o papel permite a categoria de ação;
4. o contato ou ponto de contato não impõe proteção mais restritiva;
5. o registro é comercial ou sua visibilidade atual inclui o membro;
6. não existe revogação ou restrição mais forte;
7. o resultado derivado também pode ser exibido.

Em conflito, a regra mais restritiva vence. A mesma decisão deve filtrar:

- listas e detalhes;
- busca e sugestões;
- filtros e exportações;
- última mensagem e prévias;
- nomes e imagens;
- anexos e miniaturas;
- contadores e indicadores;
- notificações;
- índices, caches e relatórios;
- acesso direto por identificadores.

O frontend não é uma fronteira de segurança. A autorização deverá ser repetida
no servidor e reforçada por políticas no armazenamento e no banco de dados em
etapas futuras.

## 12. Conversas privadas e contatos protegidos

### Alteração de privacidade

No modelo inicial, somente o OWNER pode:

- marcar uma conversa como privada;
- liberar uma conversa para uso comercial;
- proteger ou desproteger um contato;
- proteger ou desproteger um ponto de contato.

ATTENDANT não pode receber delegação para essas ações no modelo inicial.

### Efeito de um contato protegido

- Todas as conversas atuais tornam-se `OWNER ONLY`.
- Futuras conversas associadas ao contato também nascem `OWNER ONLY`.
- Todos os números associados herdam a proteção.
- Um ponto de contato pode possuir proteção mais específica sem tornar os
  demais públicos.
- Atribuições continuam indicando responsabilidade, sem alterar a proteção ou o
  acesso.
- Busca, notificações, anexos, prévias, contadores, caches e dados derivados
  deixam de ser acessíveis aos atendentes.
- A revogação precisa ocorrer antes de novos resultados serem apresentados.
- Somente o OWNER pode aplicar ou remover a proteção.
- Alterações precisam gerar auditoria.

Ao remover a proteção porque o contato passou a integrar o contexto comercial,
somente as conversas futuras podem receber visibilidade da equipe. Conversas,
mensagens e anexos anteriores permanecem privados, sem efeito retroativo.

### Existência da conversa

Uma conversa privada é totalmente invisível para ATTENDANT, inclusive sem
marcador “Conversa privada”. Sua existência não pode ser inferida por nome,
quantidade, ordenação, lacuna, lista, busca, filtro, resultado, notificação,
contador ou indicador.

### Contato protegido que se torna comercial

A mudança deve ser explícita pelo OWNER. A partir dela, novas conversas podem
ser compartilhadas com toda a equipe comercial. O histórico anterior, incluindo
conversas, mensagens, anexos e dados derivados, permanece `OWNER ONLY`. A
mudança não possui efeito retroativo.

### Liberação individual de conversa privada

Somente o OWNER pode liberar uma conversa privada específica. A liberação:

- não remove a proteção do contato ou ponto de contato;
- não libera outras conversas;
- não altera mensagens, anexos ou dados derivados anteriores;
- estabelece um marco temporal a partir do qual novas mensagens e anexos podem
  receber visibilidade comercial;
- exige auditoria.

Se o contato continuar protegido, a regra mais restritiva prevalece e a
liberação da conversa não produz acesso para a equipe.

### Conversas em grupo

- Todos os grupos importados permanecem `OWNER ONLY` por padrão.
- Todo grupo novo também nasce `OWNER ONLY`.
- ATTENDANT não recebe existência, notificação, busca, contador, nome, imagem,
  última mensagem, participantes, anexos ou qualquer metadado do grupo.
- Somente o OWNER pode liberar um grupo.
- A liberação é individual e nunca ocorre automaticamente.
- Um grupo liberado continua sujeito a contatos protegidos e a outras regras
  mais restritivas.
- O histórico produzido antes da liberação permanece privado.
- Somente o OWNER pode remover a liberação.

### Vários números do mesmo contato

Pontos de contato distintos permitem associar vários números ao mesmo contato.
A proteção do contato é herdada por todos. Exceções por número precisam ser
explícitas, mais restritivas por padrão e auditadas.

### Conversas importadas anteriormente

Configurar proteção depois da importação exige reavaliar:

- conversa e mensagens;
- anexos e miniaturas;
- índices de busca;
- prévias e última mensagem;
- contadores;
- notificações pendentes;
- caches;
- atribuições.

Até a reavaliação terminar, o acesso deve permanecer negado.

## 13. Estratégia para sincronização

A estratégia oficial do produto é:

1. importar todos os contatos e pontos de contato disponíveis;
2. importar todas as conversas individuais diretamente como `COMERCIAL`;
3. importar todos os grupos diretamente como `OWNER ONLY`;
4. sincronizar todas as mensagens enviadas e recebidas pelo WhatsApp;
5. registrar se a mensagem foi originada no CRM ou sincronizada do WhatsApp;
6. associar autoria interna somente quando a mensagem foi enviada pelo CRM;
7. aplicar imediatamente proteção já existente no contato ou ponto de contato;
8. permitir que o OWNER proteja posteriormente uma conversa pessoal;
9. manter atribuições apenas como responsabilidade operacional.

Não existe revisão inicial obrigatória, quarentena, conversa pendente ou
classificação desconhecida. Uma conversa individual de contato ainda não
identificado também nasce comercial. As únicas exceções são proteção explícita
já aplicada pelo OWNER e grupos, que permanecem privados por regra do produto.

Marcar uma conversa individual como privada afeta somente aquela conversa. Para
proteger todas as conversas e todos os números de uma pessoa, o OWNER aplica a
política de contato protegido.

Grupos permanecem privados, salvo liberação individual pelo OWNER. Qualquer
liberação preserva como privado o histórico anterior ao seu marco temporal.

## 14. Escopo MVP versus futuro

Premissas operacionais do MVP:

- um workspace por ambiente de negócio;
- um número de WhatsApp conectado por workspace;
- equipe esperada de três a cinco funcionários;
- estrutura conceitual preparada para múltiplas conexões futuras sem alterar as
  relações centrais entre workspace, canal, conversa e mensagem.

| Entidade ou conceito | Classificação | Motivo |
| --- | --- | --- |
| Workspace | Necessário para o MVP | Limite de propriedade e isolamento |
| Usuário e Membro | Necessários para o modelo inicial | Separam identidade, papel e workspace, mesmo antes da autenticação |
| Contato e Ponto de contato | Necessários para o MVP | Base cadastral e identificação de múltiplos números |
| Oportunidade e Etapa do funil | Necessárias para o MVP | Representam o processo comercial e o Kanban futuro |
| Histórico de etapa | Necessário para o MVP comercial | Preserva evolução sem misturar estado atual |
| Tarefa de trabalho | Necessária para o MVP | Suporta prioridades, tarefas e follow-ups |
| Conexão de canal | Necessária antes do WhatsApp | Define a origem das conversas; o MVP limita uma conexão ativa, mas o modelo admite múltiplas |
| Conversa, Participante e Mensagem | Necessárias antes do WhatsApp | Representam o histórico de comunicação |
| Anexo | Necessário antes do WhatsApp | Precisa nascer com acesso protegido |
| Visibilidade e proteção | Necessárias antes do WhatsApp | Evitam exposição de conversas pessoais |
| Atribuição de conversa | Necessária para múltiplos usuários | Define responsabilidade operacional sem limitar o acesso comercial |
| Nota interna | Necessária para múltiplos usuários | Compartilha contexto sem enviar mensagem |
| Auditoria | Necessária antes de múltiplos usuários e WhatsApp | Registra ações sensíveis e mudanças de acesso |
| Etiqueta | Evolução futura | Organização adicional ainda não necessária |
| Origem do lead | Evolução futura | Depende de captação e relatórios |
| Imóvel de interesse | Evolução futura | Depende do escopo de imóveis |
| Atendimento | Evolução futura | Depende de sessões, filas ou métricas |
| Papéis adicionais | Evolução futura | Dependem de responsabilidades confirmadas |
| Cliente, Lead, Follow-up e Lembrete separados | Desnecessários no momento | São classificações ou variações de entidades aprovadas |

## 15. Decisões em aberto

As recomendações abaixo não são decisões de produto aprovadas.

| Decisão pendente | Recomendação técnica inicial |
| --- | --- |
| Reativação restaura atribuições anteriores? | Exigir nova atribuição para evitar restauração acidental de acesso. |
| Quem transfere a propriedade do workspace? | Definir processo administrativo forte e auditado antes de oferecer a função. |

## 16. Riscos arquitetônicos

- **Vazamento por metadados:** ocultar o corpo, mas exibir nome, horário, última
  mensagem, miniatura ou contagem.
- **Autorização apenas por papel:** considerar ATTENDANT suficiente sem avaliar
  vínculo ativo, natureza comercial, visibilidade e proteção.
- **Acesso direto por identificador:** permitir consultar registro protegido
  fora das listagens filtradas.
- **Caches e índices desatualizados:** revogar o registro principal, mas manter
  resultados privados em busca, contadores ou notificações.
- **Anexos com acesso público:** uma URL permanente pode contornar todas as
  outras regras.
- **Associação incorreta de contatos:** unir números ou contatos pode liberar
  conversas pessoais indevidamente.
- **Mudança em grupos:** novos participantes protegidos podem alterar o risco de
  uma conversa já liberada.
- **Proteção retroativa incompleta:** marcar o contato como protegido sem
  revogar prévias, notificações, caches e demais dados derivados.
- **Auditoria com conteúdo sensível:** logs podem se tornar uma segunda fonte de
  vazamento.
- **Revogação tardia:** usuário suspenso ou removido continuar acessando por
  sessão, cache ou arquivo previamente autorizado.
- **Acoplamento entre oportunidade e conversa:** relacionamentos comerciais não
  devem conceder acesso privado automaticamente.
- **Supermodelagem:** criar entidades genéricas antes de confirmar fluxos torna
  permissões e manutenção mais difíceis.

## 17. Próximos passos recomendados

1. Confirmar as decisões de produto que permanecem abertas neste documento e
   na matriz de permissões.
2. Transformar a matriz e os fluxos consolidados em cenários verificáveis de
   aceitação e negação de acesso.
3. Elaborar cenários de ameaça para conversa pessoal, grupos, anexos, busca,
   notificações e revogação.
4. Transformar o modelo aprovado em tipos de domínio, sem reutilizar diretamente
   tipos de apresentação das páginas.
5. Criar o modelo lógico do banco somente após resolver os pontos de
   cardinalidade e privacidade ainda abertos.
6. Projetar políticas de isolamento por workspace e acesso a conversas antes de
   implementar autenticação ou integração.
7. Definir o contrato de identidade externa para números, participantes e
   conversas do WhatsApp.
8. Planejar testes automatizados que provem ausência de conteúdo e metadados
   privados em todas as projeções.
