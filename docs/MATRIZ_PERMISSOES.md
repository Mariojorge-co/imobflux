# Matriz conceitual de permissões do ImobFlux

Status: consolidação final da Sprint 8.

Esta matriz define regras de negócio. Ela não implementa autenticação,
autorização, banco de dados ou políticas técnicas.

## 1. Papéis

### OWNER

Proprietário administrativo do workspace. É o único papel que pode alterar
privacidade, liberar grupos, administrar membros e consultar auditoria de
segurança.

### ATTENDANT

Membro operacional. Pode visualizar e editar todos os registros comerciais do
workspace enquanto estiver ativo, mas nunca supera uma restrição de
privacidade.

## 2. Legenda

| Valor | Significado |
| --- | --- |
| PERMITIDO | O papel pode executar a ação dentro do próprio workspace. |
| CONDICIONAL | Depende de vínculo ativo, privacidade, natureza comercial ou estado do registro. |
| NEGADO | O papel não pode executar a ação. |
| N/A | A ação não se aplica à entidade ou é executada exclusivamente pelo sistema. |

## 3. Regras que prevalecem sobre a matriz

1. Um usuário somente opera dentro de um workspace no qual possua vínculo
   ativo.
2. Toda conversa individual nova ou importada nasce `COMERCIAL`, sem estado
   intermediário, pendente ou desconhecido.
3. Conversa associada a contato ou ponto de contato já protegido permanece
   privada.
4. Contato protegido prevalece sobre papel, atribuição e situação comercial.
5. Conversa privada é completamente invisível ao ATTENDANT, inclusive em
   listas, buscas, filtros, resultados, notificações, contadores e indicadores.
6. Grupo nasce e permanece como `OWNER ONLY` até liberação individual feita
   pelo OWNER.
7. Um grupo liberado continua sujeito à proteção de contatos e às demais regras
   do workspace.
8. Mensagens, anexos, notas e tarefas relacionadas nunca podem possuir acesso
   mais amplo que seu contexto protegido.
9. A liberação de conversa estabelece um marco temporal e não torna público o
   histórico anterior.
10. Busca, contadores, notificações, prévias, exportações, caches e acesso direto
   devem aplicar as mesmas regras da consulta principal.
11. Suspensão ou remoção de um membro revoga imediatamente seu acesso.
12. Todos os membros ativos podem visualizar e editar informações comerciais;
    atribuições indicam responsabilidade e não limitam esse acesso.
13. Somente o OWNER pode exportar dados do sistema.
14. Não existe exclusão definitiva no uso normal. Registros são arquivados ou
    inativados, e exclusões físicas ficam reservadas a rotinas técnicas futuras.
15. Toda alteração relevante gera auditoria permanente e imutável; simples
    visualizações não geram evento no MVP.
16. Em conflito, a regra mais restritiva vence.

## 4. Workspace

| Ação | OWNER | ATTENDANT | Condições e observações |
| --- | --- | --- | --- |
| Visualizar identificação básica | PERMITIDO | PERMITIDO | Somente o workspace do vínculo ativo. |
| Criar | PERMITIDO | NEGADO | A criação também estabelece o primeiro OWNER. |
| Editar dados administrativos | PERMITIDO | NEGADO | Mudança sensível deve gerar auditoria. |
| Arquivar ou encerrar | PERMITIDO | NEGADO | Preserva dados, autorias e auditoria. |
| Excluir definitivamente | NEGADO | NEGADO | Exclusão física não faz parte do uso normal do sistema. |
| Gerenciar usuários | PERMITIDO | NEGADO | Inclui convite, suspensão, remoção e reativação. |
| Consultar auditoria | PERMITIDO | NEGADO | Dentro do próprio workspace. |
| Exportar dados do workspace | PERMITIDO | NEGADO | Exportação é exclusiva do OWNER e deve ser auditada. |
| Alterar configurações | PERMITIDO | NEGADO | Configurações operacionais e sensíveis. |
| Alterar privacidade | PERMITIDO | NEGADO | Competência exclusiva do OWNER. |

## 5. Contato

| Ação | OWNER | ATTENDANT | Condições e observações |
| --- | --- | --- | --- |
| Visualizar | PERMITIDO | CONDICIONAL | ATTENDANT visualiza todos os contatos comerciais não protegidos. |
| Criar manualmente | PERMITIDO | CONDICIONAL | ATTENDANT pode criar contato comercial no workspace do vínculo ativo. |
| Criar automaticamente | N/A | N/A | A criação automática é responsabilidade do sistema durante importação ou recebimento. |
| Editar cadastro | PERMITIDO | CONDICIONAL | ATTENDANT pode editar informações comerciais, mas não proteção nem campos administrativos. |
| Alterar classificação | PERMITIDO | CONDICIONAL | Pessoa, Lead, Cliente ou Inativo; exige acesso ao contato. |
| Arquivar ou tornar inativo | PERMITIDO | CONDICIONAL | Não apaga conversas, oportunidades ou históricos. |
| Excluir definitivamente | NEGADO | NEGADO | O contato deve ser arquivado ou inativado. |
| Exportar | PERMITIDO | NEGADO | Exportação é exclusiva do OWNER e respeita a proteção. |
| Proteger | PERMITIDO | NEGADO | Afeta todos os números e conversas atuais e futuras. |
| Remover proteção | PERMITIDO | NEGADO | Exige auditoria; somente conversas futuras podem ser compartilhadas e o histórico anterior permanece privado. |
| Associar ou corrigir número | PERMITIDO | CONDICIONAL | Correções sensíveis e fusões devem ser auditadas. |
| Consultar histórico comercial | PERMITIDO | CONDICIONAL | Todos os membros ativos consultam o histórico comercial não protegido. |

## 6. Conversa individual

| Ação | OWNER | ATTENDANT | Condições e observações |
| --- | --- | --- | --- |
| Visualizar | PERMITIDO | CONDICIONAL | Conversa comercial é acessível a todos os membros ativos; conversa privada é totalmente invisível ao ATTENDANT. |
| Criar por importação ou canal | N/A | N/A | O sistema cria a conversa a partir do canal conectado. |
| Editar metadados operacionais | PERMITIDO | CONDICIONAL | ATTENDANT somente em conversa acessível; privacidade não pode ser alterada. |
| Arquivar e reabrir | PERMITIDO | CONDICIONAL | Preserva mensagens e auditoria. |
| Excluir definitivamente | NEGADO | NEGADO | A conversa deve ser arquivada, preservando mensagens e auditoria. |
| Atribuir responsável | PERMITIDO | CONDICIONAL | Membro ativo pode definir responsabilidade em conversa comercial acessível; isso não altera acesso. |
| Trocar responsável | PERMITIDO | CONDICIONAL | Preserva o histórico e não restringe a colaboração dos demais membros ativos. |
| Exportar | PERMITIDO | NEGADO | Exportação é exclusiva do OWNER e respeita anexos, privacidade e auditoria. |
| Tornar privada | PERMITIDO | NEGADO | Afeta somente a conversa escolhida. |
| Liberar conversa privada | PERMITIDO | NEGADO | Não remove proteção do contato, não libera outras conversas e mantém privado todo o histórico anterior ao marco da liberação. |
| Consultar participantes | PERMITIDO | CONDICIONAL | Segue exatamente o acesso da conversa. |
| Consultar última mensagem e prévia | PERMITIDO | CONDICIONAL | É proibido indicar existência ou produzir prévia quando a conversa for privada. |

## 7. Grupo

| Ação | OWNER | ATTENDANT | Condições e observações |
| --- | --- | --- | --- |
| Visualizar antes da liberação | PERMITIDO | NEGADO | Grupo é `OWNER ONLY` por padrão. |
| Receber em busca, contador ou notificação antes da liberação | PERMITIDO | NEGADO | A existência do grupo não pode vazar para a equipe. |
| Criar por importação ou canal | N/A | N/A | Todo grupo importado ou novo é criado como `OWNER ONLY`. |
| Liberar grupo específico | PERMITIDO | NEGADO | A liberação é individual e auditada. |
| Remover liberação | PERMITIDO | NEGADO | Revoga acessos e dados derivados. |
| Visualizar depois da liberação | PERMITIDO | CONDICIONAL | Todos os membros ativos acessam o grupo liberado se não houver proteção mais restritiva. |
| Editar metadados depois da liberação | PERMITIDO | CONDICIONAL | Somente enquanto o grupo permanecer acessível. |
| Arquivar ou reabrir | PERMITIDO | CONDICIONAL | ATTENDANT apenas em grupo liberado e autorizado. |
| Atribuir responsável | PERMITIDO | CONDICIONAL | Em grupo liberado, define responsabilidade sem equivaler à liberação. |
| Exportar | PERMITIDO | NEGADO | Exportação é exclusiva do OWNER. |
| Excluir definitivamente | NEGADO | NEGADO | O grupo deve ser arquivado; exclusão física não ocorre no uso normal. |
| Consultar participantes e anexos | PERMITIDO | CONDICIONAL | Somente após liberação e sem proteção mais restritiva. |

## 8. Mensagem e anexo

| Ação | OWNER | ATTENDANT | Condições e observações |
| --- | --- | --- | --- |
| Visualizar mensagem | PERMITIDO | CONDICIONAL | Herda integralmente o acesso da conversa. |
| Visualizar anexo | PERMITIDO | CONDICIONAL | Herda a mensagem e não gera auditoria por simples visualização. |
| Baixar ou exportar anexo | PERMITIDO | NEGADO | Exportação de anexos é exclusiva do OWNER e deve ser auditada. |
| Enviar mensagem pelo CRM | PERMITIDO | CONDICIONAL | Exige conversa acessível e registra o membro responsável como autor interno. |
| Enviar anexo | PERMITIDO | CONDICIONAL | Mesma regra da mensagem e validações futuras do arquivo. |
| Sincronizar mensagem enviada ou recebida pelo WhatsApp | N/A | N/A | O sistema sincroniza a mensagem, registra origem WhatsApp e não presume autoria interna. |
| Consultar origem da mensagem | PERMITIDO | CONDICIONAL | Herda o acesso da mensagem e diferencia CRM de WhatsApp. |
| Editar mensagem enviada | NEGADO | NEGADO | Mensagem é registro do canal; eventual correção deve seguir capacidade futura do provedor. |
| Excluir mensagem | NEGADO | NEGADO | Mensagens não são excluídas fisicamente no uso normal. |
| Arquivar individualmente | N/A | N/A | Arquivamento ocorre no contexto da conversa. |
| Exportar | PERMITIDO | NEGADO | Exportação é exclusiva do OWNER e não inclui conteúdo protegido indevido. |
| Consultar situação de entrega | PERMITIDO | CONDICIONAL | Exige acesso à conversa. |
| Alterar privacidade isoladamente | NEGADO | NEGADO | A privacidade é definida na conversa ou no contato. |

## 9. Oportunidade

| Ação | OWNER | ATTENDANT | Condições e observações |
| --- | --- | --- | --- |
| Visualizar | PERMITIDO | CONDICIONAL | Todos os membros ativos visualizam oportunidades comerciais de contatos não protegidos. |
| Criar | PERMITIDO | CONDICIONAL | Vinculada a contato acessível e etapa válida do workspace. |
| Editar | PERMITIDO | CONDICIONAL | Qualquer membro ativo pode editar oportunidade comercial não protegida. |
| Alterar etapa | PERMITIDO | CONDICIONAL | Toda mudança gera histórico comercial. |
| Encerrar como ganha ou perdida | PERMITIDO | CONDICIONAL | Preserva histórico e não apaga o contato. |
| Arquivar ou reabrir | PERMITIDO | CONDICIONAL | Conforme acesso comercial vigente. |
| Excluir definitivamente | NEGADO | NEGADO | A oportunidade deve ser encerrada ou arquivada. |
| Atribuir responsável | PERMITIDO | CONDICIONAL | Membro ativo pode definir responsabilidade; isso não concede acesso a conversas privadas. |
| Trocar responsável | PERMITIDO | CONDICIONAL | Membro ativo pode alterar a responsabilidade, preservando o histórico operacional. |
| Exportar | PERMITIDO | NEGADO | Exportação é exclusiva do OWNER. |
| Consultar histórico de etapas | PERMITIDO | CONDICIONAL | Segue a natureza comercial e a proteção da oportunidade. |

## 10. Tarefa de trabalho

| Ação | OWNER | ATTENDANT | Condições e observações |
| --- | --- | --- | --- |
| Visualizar | PERMITIDO | CONDICIONAL | ATTENDANT visualiza todas as tarefas de contextos comerciais não protegidos. |
| Criar | PERMITIDO | CONDICIONAL | Deve possuir contexto acessível e pelo menos um vínculo comercial ou operacional. |
| Editar | PERMITIDO | CONDICIONAL | Qualquer membro ativo pode editar tarefa comercial acessível; não amplia acesso ao contexto. |
| Concluir | PERMITIDO | CONDICIONAL | Qualquer membro ativo com acesso ao contexto. |
| Cancelar ou arquivar | PERMITIDO | CONDICIONAL | Preserva histórico operacional. |
| Reabrir | PERMITIDO | CONDICIONAL | Conforme acesso atual ao contexto. |
| Excluir definitivamente | NEGADO | NEGADO | A tarefa deve ser cancelada ou arquivada. |
| Atribuir responsável | PERMITIDO | CONDICIONAL | Qualquer membro ativo pode atribuir tarefa comercial a membro ativo do mesmo workspace. |
| Trocar responsável | PERMITIDO | CONDICIONAL | Qualquer membro ativo pode trocar a responsabilidade, preservando o histórico. |
| Exportar | PERMITIDO | NEGADO | Exportação é exclusiva do OWNER. |
| Configurar lembrete | PERMITIDO | CONDICIONAL | ATTENDANT somente para tarefa acessível. |

## 11. Nota interna

| Ação | OWNER | ATTENDANT | Condições e observações |
| --- | --- | --- | --- |
| Visualizar | PERMITIDO | CONDICIONAL | Herda o acesso do contato, oportunidade ou conversa relacionada. |
| Criar | PERMITIDO | CONDICIONAL | ATTENDANT precisa acessar o contexto relacionado. |
| Editar nota própria | PERMITIDO | CONDICIONAL | Preserva autoria e rastreabilidade. |
| Editar nota de outro membro | PERMITIDO | CONDICIONAL | Qualquer membro ativo pode editar nota comercial acessível, preservando autoria e auditoria da alteração. |
| Remover | NEGADO | NEGADO | Nota não é excluída fisicamente; deve ser arquivada. |
| Arquivar | PERMITIDO | CONDICIONAL | Não amplia o acesso ao contexto. |
| Exportar | PERMITIDO | NEGADO | Exportação é exclusiva do OWNER. |
| Alterar privacidade | NEGADO | NEGADO | A nota herda privacidade; não cria exceção própria. |

## 12. Auditoria

| Ação | OWNER | ATTENDANT | Condições e observações |
| --- | --- | --- | --- |
| Consultar | PERMITIDO | NEGADO | Somente dentro do workspace do OWNER. |
| Criar evento manualmente | N/A | N/A | Eventos são produzidos pelo sistema em consequência de ações. |
| Editar | NEGADO | NEGADO | Auditoria é somente acrescentável. |
| Excluir | NEGADO | NEGADO | Auditoria é permanente e não pode ser apagada. |
| Exportar | PERMITIDO | NEGADO | Deve ser auditado e sanitizado. |
| Consultar conteúdo de mensagem pelo evento | NEGADO | NEGADO | Auditoria não duplica conteúdo. |
| Alterar permanência dos eventos | NEGADO | NEGADO | A permanência da auditoria é uma regra fixa do produto. |
| Gerar evento por simples visualização | N/A | N/A | Consultas e aberturas para leitura não são auditadas no MVP. |

## 13. Configurações

| Ação | OWNER | ATTENDANT | Condições e observações |
| --- | --- | --- | --- |
| Visualizar configurações sensíveis | PERMITIDO | NEGADO | Inclui canal, privacidade e membros. |
| Alterar configurações gerais | PERMITIDO | NEGADO | Ações relevantes geram auditoria. |
| Alterar configurações de canal | PERMITIDO | NEGADO | Não expõe segredos nos registros apresentados. |
| Alterar regras de privacidade | PERMITIDO | NEGADO | Exclusivo do OWNER. |
| Gerenciar usuários | PERMITIDO | NEGADO | Convite, suspensão, remoção e reativação. |
| Liberar ou restringir grupo | PERMITIDO | NEGADO | Sempre por grupo e com auditoria. |
| Conectar número de WhatsApp | PERMITIDO | NEGADO | O MVP permite no máximo uma conexão ativa por workspace. |
| Consultar estado da sincronização | PERMITIDO | NEGADO | Informação administrativa da conexão do workspace. |
| Exportar configurações | PERMITIDO | NEGADO | Toda exportação de dados é exclusiva do OWNER. |

## 14. Situação das decisões de permissão

Não restam células `PENDENTE` nesta matriz. As decisões aprovadas consolidaram
o modelo colaborativo, a exportação exclusiva do OWNER, a ausência de exclusão
definitiva e a permanência da auditoria.

Continuam abertas somente questões que não alteram as permissões já
consolidadas:

- **Restauração de atribuições após reativação:** trata-se do estado operacional
  automático do retorno, não de acesso aos dados comerciais. Até decisão,
  atribuições anteriores não devem ser restauradas automaticamente.
- **Transferência da propriedade do workspace:** o processo e suas confirmações
  ainda não foram definidos; por isso, a ação não integra esta matriz.
