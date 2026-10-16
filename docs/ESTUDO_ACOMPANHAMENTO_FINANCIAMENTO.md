# Estudo: acompanhamento de financiamento imobiliário (correspondente Caixa Aqui)

> **Só estudo.** Nenhum código, tabela ou tela foi criado por causa deste documento. As etapas, listas de documentos e prazos abaixo
> são uma **proposta de partida baseada no fluxo usual de financiamento habitacional**; as exigências reais mudam por produto,
> modalidade, renda, estado civil e normas vigentes da Caixa. **Tudo isso precisa ser validado pelo Mário**, que opera como
> correspondente Caixa Aqui, antes de virar tela. Itens marcados com **[validar]** dependem dele.

## 1. Contexto e objetivo

O Mário atende clientes que querem **comprar** (imóvel pronto/usado ou na planta) ou **construir** (terreno próprio) usando
financiamento da Caixa, como correspondente. Hoje o ImobFlux acompanha **conversas**, **oportunidades** (Kanban de funil comercial),
**tarefas** e o painel **Hoje**. O financiamento é um **processo longo (semanas a meses)**, com muita **coleta de documento**, **prazos de
terceiros** (Caixa, cartório, engenharia/avaliação) e **muitas mensagens repetidas** ("falta a certidão X", "sua avaliação saiu").

Objetivo do módulo: para cada cliente em financiamento, mostrar **em que etapa está, o que falta, quem deve a próxima ação e há quanto
tempo está parado**, sem planilha paralela, reaproveitando conversa, tarefas, respostas rápidas (agora com anexo) e o painel Hoje.

## 2. O que já existe e será reaproveitado

| Peça existente | Papel no acompanhamento |
|---|---|
| **Oportunidades + Kanban** (`opportunities`, `pipeline_stages`) | Já é um funil por etapas, com cartões arrastáveis. O financiamento pode ser um **segundo funil** (esteira) ou uma **extensão da oportunidade**. |
| **Tarefas e follow-ups** (`work_tasks`, tarefa ligada a contato/oportunidade/conversa) | Cada pendência vira tarefa com prazo e responsável; vencidas aparecem no **Hoje**. |
| **Respostas rápidas com anexo** (Pacote Noite) | Modelos como "Lista de documentos para financiamento" + a lista em PDF anexada, enviados pela fila normal. |
| **Painel Hoje** | Alertas: processo parado, documento pendente, vencimento de validade (ver 8). |
| **Conversa e arquivos recebidos** (`attachments`, bucket privado) | Os documentos que o cliente manda pelo WhatsApp já chegam aqui; falta **vincular** cada arquivo ao item do checklist. |
| **Permissões** (owner/attendant, contato protegido, RLS) | Documentos de cliente são **dados sensíveis**: o acesso segue a regra da conversa/contato. |
| **Auditoria** | Quem mudou de etapa, quem marcou documento como conferido. |

## 3. Modelos de processo (etapas)

Duas esteiras. Os nomes são **propostas [validar]**; o ideal é o Mário editar as etapas pela tela (como já se edita o Kanban).

### 3.1 Aquisição (imóvel pronto/usado ou novo de construtora)

1. **Atendimento inicial** — entendeu o perfil: renda, entrada, FGTS, imóvel em vista.
2. **Simulação** — simulação de valor financiável/parcela; cliente decide seguir.
3. **Documentação do cliente** — coleta do checklist pessoal e de renda.
4. **Análise de crédito** — envio do dossiê; análise e **aprovação de crédito** (ou pendências).
5. **Documentação do imóvel** — matrícula, certidões, dados do vendedor.
6. **Avaliação do imóvel** — vistoria/laudo; **conformidade** jurídica do imóvel.
7. **Assinatura do contrato** — emissão e assinatura (contrato com a Caixa).
8. **Registro em cartório** — registro do contrato e da matrícula.
9. **Liberação / entrega** — liberação do recurso ao vendedor e conclusão.
10. **Pós-venda** — retornos, indicação, acompanhamento de pagamento da 1ª parcela etc.

### 3.2 Construção (terreno próprio / financiamento de construção)

1. Atendimento inicial e simulação.
2. Documentação do cliente.
3. Documentação do **terreno** (matrícula, regularidade) e do **projeto** (projeto aprovado, ART/RRT, orçamento, cronograma).
4. Análise de crédito.
5. **Engenharia** — análise do projeto e do cronograma físico-financeiro.
6. Assinatura do contrato e registro.
7. **Obra em andamento** — **medições** periódicas e **liberações por etapa da obra** (várias parcelas de liberação).
8. **Habite-se / averbação** e encerramento.

Particularidade: a esteira de construção tem um **ciclo repetitivo** (medição → liberação) que não existe na aquisição; precisa
de uma subestrutura "medições" **[validar]**.

### 3.3 Subestados dentro de uma etapa

Cada etapa tem um **estado** além do nome, para saber de quem é a vez:

- *Aguardando cliente* (documento, assinatura, resposta)
- *Aguardando equipe* (conferir, montar dossiê, enviar)
- *Aguardando Caixa/terceiro* (análise, avaliação, cartório)
- *Parado/pausado* (cliente sumiu, pendência externa)
- *Concluída*

Esse estado casa com a ideia já usada nas conversas (**quem deve resposta**) e alimenta os alertas.

## 4. Checklists de documentos (proposta inicial **[validar]**)

Os itens abaixo são os **usuais**; a lista exata varia por produto, renda e estado civil. A tela deve permitir **editar modelos de
checklist** e **ajustar por processo** (ex.: autônomo vs. assalariado, casado vs. solteiro).

**Pessoais (proponente e cônjuge/coproponentes)**
- Documento de identificação com foto (RG/CNH) e CPF
- Certidão de estado civil (nascimento / casamento / averbação de divórcio ou óbito) e, se união estável, comprovação
- Comprovante de residência recente
- Dados de contato e de profissão

**Renda**
- Assalariado (CLT): contracheques recentes, carteira de trabalho, extrato de FGTS (se usar FGTS)
- Autônomo/empresário/profissional liberal: declaração de imposto de renda completa e recibo, extratos bancários, comprovantes
  de atividade, pró-labore/DECORE etc. **[validar]**
- Aposentado/pensionista: extrato do benefício
- Imposto de renda do último exercício (quando exigido)

**Imóvel (aquisição)**
- Matrícula atualizada, certidões do imóvel e do vendedor, IPTU, condomínio quando houver
- Contrato/compromisso de compra e venda ou proposta, dados do vendedor (pessoa física ou jurídica)

**Terreno e obra (construção)**
- Matrícula do terreno, projeto aprovado, ART/RRT, orçamento e cronograma, alvará, licenças

**Validade**: vários documentos **vencem** (certidões, comprovantes). Cada item pode ter **data de emissão** e **validade**, para
alertar "vence em 7 dias" (ver 8).

Cada item do checklist tem: **situação** (pendente · recebido · conferido · reprovado/incompleto · dispensado), **arquivo vinculado**
(da conversa), **quem conferiu e quando**, **observação**.

## 5. Modelo de dados (rascunho, sem implementar)

- `financing_processes` — um por cliente/negócio: contato, oportunidade (opcional), **tipo** (aquisição/construção), esteira
  (modelo de etapas), etapa e estado atuais, responsável, **valor do imóvel/financiamento/entrada** (opcional), datas de início e
  de fechamento, motivo de perda/cancelamento.
- `financing_stage_templates` / `financing_stages` — etapas editáveis por workspace, com ordem, tipo (aquisição/construção) e
  "prazo esperado" opcional.
- `financing_stage_history` — **linha do tempo**: cada mudança de etapa/estado (quem, quando, de→para, motivo).
- `financing_checklist_templates` / `financing_checklist_items` — modelos e itens por processo (nome, obrigatório, validade em
  dias, situação, anexo, conferido por/em, observação).
- `financing_participants` — proponente, cônjuge, coproponentes, vendedor, corretor do imóvel (liga a `contacts`).
- `financing_events` (opcional) — marcos: análise enviada, aprovada, avaliação agendada, assinatura marcada, etc., com data prevista e
  data real.
- `financing_measurements` (só construção) — medições e liberações.

Princípios: tudo com `workspace_id`, **RLS** igual ao restante; escrita por **funções** (`SECURITY DEFINER`, `search_path` vazio),
auditoria **sem dados pessoais nem nomes de arquivo**; vínculo ao arquivo é por **referência** (id do anexo), sem copiar o arquivo.

## 6. Reaproveitamento de respostas rápidas e anexos

- Categoria **"Financiamento"** com modelos: *Boas-vindas ao processo*, *Lista de documentos (aquisição)*, *Lista de documentos
  (construção)*, *Falta documento X*, *Documentos recebidos, em análise*, *Crédito aprovado*, *Agendamento de assinatura*.
- O **anexo** do modelo pode ser o **PDF do checklist** do Mário (marca, orientações). Já funciona hoje: o texto entra na caixa e os
  arquivos vão para a bandeja; **nada sai sozinho**.
- Variáveis novas possíveis (futuro): `{{etapa}}`, `{{documentos_pendentes}}` (lista gerada do checklist do processo). Hoje existem
  `{{nome}}`, `{{meu_nome}}`, `{{empresa}}`; estender é pequeno, mas exige cuidado para **não vazar** itens de outro cliente.
- Botão no processo: **"Cobrar documentos pendentes"** → monta a mensagem com a lista dos itens pendentes e a deixa **na caixa da conversa**
  para revisão (mesma regra: nunca envia sozinho).

## 7. Experiência proposta

1. **Aba "Financiamento"** na tela do contato/oportunidade (e atalho no painel lateral da conversa): etapa atual, quem deve a ação,
   barra de progresso das etapas, dias na etapa.
2. **Checklist** com situação de cada documento; botão **"Vincular arquivo da conversa"** (escolhe entre os arquivos recebidos);
   marcar como conferido.
3. **Linha do tempo** do processo (mudanças de etapa, documentos recebidos/conferidos, tarefas concluídas, mensagens-chave).
4. **Kanban de financiamento**: uma coluna por etapa; cartão com cliente, tipo, valor, dias parado, pendências; filtros por
   responsável/etapa/"parados há +X dias". Reaproveita o componente do Kanban atual.
5. **Visão por cliente no celular**: tudo cabe em uma coluna; checklist com toques de 44 px.
6. Linguagem **neutra** e sem fotos de imóvel nos cartões (mesma diretriz do Hoje).

## 8. Alertas e integração com Hoje e Tarefas

Regras de alerta (todas configuráveis **[validar]**):

- Processo **parado** na mesma etapa há mais de *N* dias (valor por etapa).
- **Documento pendente** há mais de *N* dias após a cobrança.
- **Documento vencendo** (validade nos próximos 7/15 dias).
- **Prazo do cliente**: "aguardando cliente" há mais de X horas/dias (reusa a ideia do SLA de follow-up).
- **Marcos próximos**: assinatura marcada, avaliação agendada, vencimento da simulação/proposta.

Como aparece: no **Hoje**, uma seção "Financiamentos que precisam de você" (processos parados/pendentes do dia, respeitando o filtro por
responsável); cada alerta gera/atualiza uma **tarefa** com prazo (reusa `work_tasks`). Sem notificação por e-mail/WhatsApp nesta fase.

## 9. Permissões e privacidade

- **Proprietário**: vê e edita todos os processos; configura etapas, modelos e alertas; vê relatórios.
- **Atendente**: vê e atua nos processos **dos clientes que atende** (mesma regra de acesso da conversa/contato); não edita modelos.
- **Contato protegido**: o processo acompanha a proteção do contato; atendente sem acesso ao contato **não vê** o processo nem os
  documentos.
- Documentos são sensíveis (RG, CPF, renda, estado civil): ficam no **bucket privado**, acessados por **URL assinada de vida curta**,
  nunca em log; auditoria registra **quem acessou/conferiu** sem copiar o conteúdo.
- LGPD: finalidade = prestar o serviço contratado; guardar o mínimo; definir **prazo de retenção** após conclusão/cancelamento e
  rotina de eliminação **[validar com o Mário e, se possível, com orientação jurídica]**.
- Dados do cônjuge/coproponentes são de terceiros: tratar com a mesma proteção.

## 10. Relatórios (primeira versão simples)

- Processos por etapa e por responsável (quantos, valor total estimado).
- **Tempo médio por etapa** e processos mais parados.
- Conversão por etapa (quantos avançam / caem e **motivo**).
- Documentos pendentes mais frequentes (para melhorar o checklist inicial).
- Previsão de fechamento (por marcos) — só depois de haver histórico.

## 11. Fases de implementação sugeridas

1. **Fase 1 — Esteira simples**: processo + etapas editáveis + linha do tempo + responsável + Kanban de financiamento. Sem checklist.
2. **Fase 2 — Checklist de documentos**: modelos, situação por item, vincular arquivo da conversa, validade.
3. **Fase 3 — Alertas e Hoje/Tarefas**: regras de parado/pendente/vencendo; seção no Hoje; tarefas automáticas.
4. **Fase 4 — Modelos de mensagem inteligentes**: "Cobrar documentos pendentes", variáveis do processo, categoria de respostas.
5. **Fase 5 — Relatórios**.
6. **Fase 6 — Construção**: medições e liberações (se o Mário atender esse volume).

Cada fase termina com: migrations aditivas + pgTAP + rollback documentado, testes de navegador, regressão completa — o mesmo ritmo dos
pacotes anteriores.

## 12. Riscos

- **Excesso de rigidez**: se as etapas/checklists forem fixos demais, o Mário volta para a planilha. Mitigação: tudo **editável**.
- **Excesso de digitação**: se cada documento exigir muitos cliques, ninguém usa. Mitigação: vincular arquivo **a partir da conversa**
  em 2 toques.
- **Dado sensível**: vazamento de RG/renda é grave. Mitigação: bucket privado, RLS, URL curta, auditoria, sem log de conteúdo.
- **Regra da Caixa muda**: checklist e etapas desatualizados. Mitigação: modelos editáveis e **sem** regras de negócio codificadas.
- **Duplicação com a oportunidade**: dois funis confundem. Mitigação: decidir 1 (ver pergunta 1) e manter **um** lugar para o status.
- **Escopo de construção** (medições) é bem maior que o de aquisição; separar em fase própria.
- **Promessa implícita**: o sistema não pode sugerir "aprovado" por conta própria; só registra o que a equipe informa.

## 13. Perguntas para o Mário

1. O financiamento deve ser **uma esteira própria** (um segundo Kanban) ou **uma extensão da oportunidade** do funil comercial?
2. As **etapas** da seção 3 refletem a sua rotina? Quais mudar, juntar ou separar? Aquisição e construção têm o **mesmo** número de
   etapas para você?
3. Os **checklists** da seção 4 batem com o que você pede hoje? Quais variam por **tipo de renda** e **estado civil**?
4. Quais documentos **vencem** e em quantos dias (para o alerta de validade)?
5. Quanto tempo na mesma etapa já é "parado" em cada etapa (para o alerta)?
6. O **atendente** pode mudar etapa e conferir documento, ou só o proprietário?
7. Cliente casado: cônjuge é **participante** do mesmo processo (documentos dele no mesmo checklist)?
8. Há **vendedor/corretor do imóvel** a acompanhar (documentos e contatos) no mesmo processo?
9. Você acompanha **valores** (imóvel, financiamento, entrada, comissão) no sistema ou só o andamento?
10. Para **construção**, quer registrar **medições e liberações**? Com que frequência e quantas por obra, em média?
11. Quais **relatórios** você realmente olharia toda semana?
12. Por quanto tempo guardar os documentos depois do processo **concluído ou cancelado**?
13. Quer que o sistema **monte a mensagem de cobrança** de documentos pendentes (sempre revisável antes de enviar)?
14. Há **outros produtos** além de aquisição e construção (reforma, portabilidade, consórcio) que entrariam depois?

## 14. Recomendação

Começar pela **Fase 1 + Fase 2** (esteira simples e checklist com arquivo vinculado da conversa), porque entregam o maior ganho (saber
"o que falta" por cliente) com o menor risco, e usam peças que já existem (Kanban, tarefas, conversa, respostas rápidas com anexo).
Alertas no Hoje (Fase 3) vêm em seguida. Construção com medições só depois de o Mário confirmar o volume.
