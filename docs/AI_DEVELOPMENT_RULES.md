# Diretrizes Globais de Desenvolvimento com Agentes de IA — ImobFlux

## 1. Objetivo

Este documento estabelece as diretrizes oficiais e obrigatórias para padronizar a atuação de todos os agentes de Inteligência Artificial (IA) durante a manutenção, evolução e desenvolvimento do projeto **ImobFlux**. Seu cumprimento é compulsório em todas as etapas e conversas.

> **Observação de Precedência**: Estas diretrizes possuem precedência sobre o comportamento padrão do agente durante o desenvolvimento deste projeto. Em caso de conflito entre práticas genéricas do agente e este documento, prevalecem as regras aqui definidas.

---

## 2. Fluxo Obrigatório de Trabalho

Todo e qualquer ciclo de desenvolvimento conduzido por agentes de IA deve seguir rigorosamente a sequência estipulada abaixo:

1. **Reconstrução de Contexto**: Ler integralmente a documentação oficial aplicável antes de formular diagnósticos ou planos.
2. **Auditoria de Código**: Auditar o estado atual do código-fonte, banco de dados e testes relevantes.
3. **Plano de Implementação**: Elaborar um plano claro contendo o escopo, arquivos a alterar, estratégia e plano de testes.
4. **Aprovação Explícita**: Aguardar autorização do usuário antes de realizar alterações no código-fonte.
5. **Implementação**: Realizar exclusivamente as alterações autorizadas.
6. **Execução de Testes e Validação**: Executar os testes automatizados, lint e build.
7. **Relatório de Resultados**: Apresentar relatório detalhado dos testes e alterações efetuadas.
8. **Autorização para Commit**: Executar commit somente após aprovação explícita.
9. **Autorização para Push**: Executar push apenas após autorização explícita do usuário.

---

## 3. Aprovação Antes da Implementação

- O agente **nunca** deve modificar qualquer arquivo do projeto antes da aprovação explícita do plano de implementação pelo usuário.
- **Fluxo Obrigatório**:
  1. Auditoria
  2. Plano
  3. Aprovação
  4. Implementação
- **Exceção**: Somente quando o usuário solicitar explicitamente uma alteração direta no prompt.
- **Proibição**: É estritamente proibido iniciar alterações no código apenas porque uma solução técnica já foi identificada.

---

## 4. Princípio da Menor Alteração

Em qualquer intervenção no código-fonte:

- Alterar o menor número possível de arquivos;
- Evitar refatorações paralelas ou não solicitadas;
- Evitar reorganizações estruturais desnecessárias;
- Evitar renomeações de variáveis, funções ou arquivos fora do escopo;
- Preservar rigorosamente a estabilidade do projeto.

---

## 5. Leitura Obrigatória de Contexto

Antes de iniciar qualquer análise ou implementação, o agente de IA **deve obrigatoriamente consultar** os seguintes documentos de referência:

- [`HANDOFF.md`](file:///c:/Users/User/Desktop/PROJETOS/CRM%20Corretor/HANDOFF.md)
- [`README.md`](file:///c:/Users/User/Desktop/PROJETOS/CRM%20Corretor/README.md)
- [`docs/STATUS_PROJETO.md`](file:///c:/Users/User/Desktop/PROJETOS/CRM%20Corretor/docs/STATUS_PROJETO.md)
- [`docs/ROADMAP.md`](file:///c:/Users/User/Desktop/PROJETOS/CRM%20Corretor/docs/ROADMAP.md)
- [`docs/DECISOES.md`](file:///c:/Users/User/Desktop/PROJETOS/CRM%20Corretor/docs/DECISOES.md)
- [`docs/ARQUITETURA.md`](file:///c:/Users/User/Desktop/PROJETOS/CRM%20Corretor/docs/ARQUITETURA.md)
- [`docs/DOCUMENTATION_POLICY.md`](file:///c:/Users/User/Desktop/PROJETOS/CRM%20Corretor/docs/DOCUMENTATION_POLICY.md)
- [`docs/AUDITORIA_TECNICA.md`](file:///c:/Users/User/Desktop/PROJETOS/CRM%20Corretor/docs/AUDITORIA_TECNICA.md)
- [`docs/PERFORMANCE_BANCO.md`](file:///c:/Users/User/Desktop/PROJETOS/CRM%20Corretor/docs/PERFORMANCE_BANCO.md)
- Documentação de Sprints em [`docs/sprints/`](file:///c:/Users/User/Desktop/PROJETOS/CRM%20Corretor/docs/sprints/)

> **Regra Cardeal**: É estritamente proibido assumir contextos, schemas, premissas ou arquiteturas sem antes verificar a documentação oficial.

---

## 6. Gestão de Documentação e Persistência

- Toda a documentação permanente do projeto deve ser salva **exclusivamente dentro do repositório oficial** (`docs/` ou raiz).
- A pasta temporária `brain` (utilizada por IDEs/agentes) **nunca** deve ser usada para documentação definitiva.
- A pasta `brain` serve única e exclusivamente para:
  - Rascunhos operacionais de tarefas em andamento;
  - Planos temporários durante a sessão;
  - Memória interna de processamento das ferramentas da IDE.

---

## 7. Evolução da Documentação

- Sempre que um novo documento permanente for criado no repositório, o agente deve verificar se ele precisa ser incluído na lista de leitura obrigatória deste documento (`docs/AI_DEVELOPMENT_RULES.md`).
- Este arquivo deve permanecer continuamente atualizado ao longo da evolução do projeto.

---

## 8. Banco de Dados e Migrations

Toda e qualquer alteração de schema ou migration de banco de dados deve atender aos seguintes critérios de segurança e governança:

- **Idempotência**: Todas as migrations devem ser idempotentes (permitir reexecução segura).
- **Compatibilidade**: Preservar total compatibilidade com a aplicação em produção.
- **Princípio de Menor Privilégio**: Utilizar `SECURITY DEFINER` apenas quando estritamente necessário e devidamente fundamentado.
- **Isolamento de Schema**: Definir explicitamente `search_path = ''` em funções para prevenir ataques de hijacking.
- **Segurança e RLS**: Respeitar e manter as políticas de Row Level Security (RLS).
- **Auditoria**: Preservar triggers, colunas e tabelas de auditoria (`created_at`, `updated_at`, `created_by`, etc.).
- **Minimalismo**: Nunca criar migrations desnecessárias ou redundantes.

---

## 9. Padrões de Código

As diretrizes de engenharia de software do ImobFlux exigem:

- **Componentização**: Componentes pequenos, focados e reutilizáveis.
- **Responsabilidade Única (SRP)**: Cada módulo, função ou componente deve possuir uma única razão para mudar.
- **Tipagem Estrita**: Tipagem completa via TypeScript em 100% das interfaces e funções (evitar `any`).
- **DRY (Don't Repeat Yourself)**: Eliminação de código duplicado e centralização de utilitários.
- **Código Limpo**: Ausência de comentários óbvios, obsoletos ou desnecessários.
- **Design System**: Manter estrita consistência com o Design System e tokens de UI do projeto.

---

## 10. Experiência do Usuário (UX)

Em todas as soluções de interface, priorizar sempre:

- **Feedback Imediato**: Indicadores visuais de carregamento, estados desabilitados e confirmações.
- **Atualização Otimista**: Aplicar quando apropriado para maximizar a percepção de performance.
- **Rollback Seguro**: Reverter a interface ao estado anterior em caso de erro no backend/servidor.
- **Acessibilidade (a11y)**: Navegação por teclado, rótulos ARIA e contrastes adequados.
- **Responsividade Total**: Experiência fluida em dispositivos móveis, tablets e desktop.
- **Mensagens Amigáveis**: Linguagem clara, humanizada e orientada à solução para o usuário final.

> **Proibição**: Mensagens técnicas brutas, exceções de banco de dados, stack traces ou códigos de erro incompreensíveis **nunca** devem ser apresentados ao usuário final.

---

## 11. Validação e Testes Obrigatórios

É terminantemente vedado declarar que uma tarefa foi concluída sem validação técnica real:

- Toda alteração deve ser validada executando a suíte de testes impactada.
- O ciclo obrigatório de validação inclui:
  1. Execução dos **testes específicos** do módulo alterado;
  2. Execução do **linter** (`npm run lint` ou equivalente);
  3. Execução da verificação de **build** (`npm run build` ou equivalente).
- **Nunca afirmar que algo funciona** sem ter executado os testes e obtido aprovação nos comandos.

---

## 12. Testes Manuais

- Mesmo após a aprovação de todos os testes automatizados, o agente de IA deve indicar explicitamente ao usuário quais testes manuais precisam ser realizados na interface ou sistema.
- Os testes manuais recomendados devem:
  - Ser objetivos;
  - Ser curtos;
  - Validar o comportamento real da funcionalidade sob o ponto de vista do usuário final.
- **Nunca** considerar uma Sprint ou tarefa totalmente concluída confiando apenas em testes automatizados.

---

## 13. Governança de Versionamento (Git)

Os comandos de controle de versão exigem autorização expressa do usuário:

- **Nunca executar automaticamente**:
  - `git add`
  - `git commit`
  - `git push`
- Antes de solicitar permissão para commit/push, apresentar ao usuário:
  - Lista de arquivos alterados;
  - Resumo claro das modificações;
  - Resultado da execução dos testes;
  - Resultado da checagem de lint;
  - Resultado da compilação/build.
- **Execução Passo a Passo**: Após a autorização do usuário, executar cada etapa separadamente (ex.: `git add` -> `git commit` -> `git push`) e aguardar confirmação quando solicitado antes de prosseguir para a etapa seguinte.

---

## 14. Escopo e Limites de Alteração

Para manter o controle de qualidade e a rastreabilidade do projeto:

- **Foco estrito no escopo**: Nunca adicionar funcionalidades, refatorações ou "melhorias" não solicitadas explicitamente.
- **Isolamento de Sprints**: Nunca utilizar uma Sprint para alterar módulos alheios ao objetivo da Sprint.
- **Objetivo Único**: Cada Sprint ou tarefa possui um objetivo claro e delimitado.

---

## 15. Padronização de Comunicação

As respostas dos agentes de IA devem ser estruturadas e concisas, obrigatoriamente contendo:

1. **Causa/Diagnóstico**: Explicação objetiva da causa do problema ou da necessidade.
2. **Estratégia**: Abordagem técnica adotada.
3. **Arquivos Alterados**: Relação detalhada com links funcionais para o repositório.
4. **Testes Executados**: Comandos rodados e resultados obtidos.
5. **Impactos**: Riscos ou efeitos colaterais identificados.
6. **Próximos Passos**: Ações requeridas ou próximas etapas sugeridas.

> Evitar respostas vagamente genéricas, narrativas excessivas sem conteúdo técnico ou conclusões sem evidências.

---

## 16. Processo de Decisão Técnica

Caso surja mais de uma alternativa válida para a resolução de um problema:

1. **Apresentar as alternativas** disponíveis.
2. **Comparar vantagens e desvantagens** de cada opção (impacto em performance, complexidade, manutenibilidade).
3. **Recomendar formalmente uma única opção**, justificando a escolha.
4. **Aguardar a decisão e aprovação explícita** do usuário antes de iniciar qualquer código.

---

## 17. Gerenciamento de Contexto

- Quando a conversa acumular muito contexto ou histórico de mensagens, o agente deve sugerir a abertura de uma nova conversa (reset de contexto).
- Antes de recomendar o reinício da conversa, o agente deve garantir:
  - Documentação oficial do projeto devidamente atualizada;
  - Nenhuma alteração de código pendente de validação;
  - Repositório Git em estado consistente;
  - Documento de Handoff/Status atualizado, quando necessário.
- **Nunca** depender exclusivamente da memória temporária da conversa para preservar conhecimento sobre o projeto.

---

## 18. Protocolo de Encerramento de Sprint

Ao finalizar uma Sprint ou ciclo de trabalho, o agente deve obrigatoriamente:

1. Confirmar se não restam alterações pendentes não rastreadas ou não tratadas no workspace;
2. Informar com clareza o status de commits (se houve commit autorizado);
3. Informar com clareza o status do repositório remoto (se houve push autorizado);
4. Atualizar a documentação oficial do projeto (ex.: `STATUS_PROJETO.md`, `ROADMAP.md`, documentação da sprint) quando aplicável.
