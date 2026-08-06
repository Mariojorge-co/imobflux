# Política de Documentação (Single Source of Truth) — ImobFlux

Este documento estabelece as regras permanentes de governança e manutenção de toda a documentação do repositório **ImobFlux**. Seu cumprimento é obrigatório para desenvolvedores e IAs.

---

## 1. Princípios Gerais

1. **Single Source of Truth (SOT)**: Cada informação possui uma única fonte oficial. É proibido duplicar a mesma explicação em múltiplos documentos.
2. **Atualização sobre Criação**: Deve-se sempre preferir atualizar um documento existente em vez de criar arquivos adicionais.
3. **Sem Histórico em Documentos de Estado**: Documentos de estado atual ou planejamento futuro não devem acumular logs históricos.
4. **Repositório Oficial como Destino Único**: Todo documento permanente (PRDs, auditorias, roadmaps, relatórios de sprint, handoff, arquitetura, ADRs) deve ser criado ou atualizado diretamente no repositório oficial (`C:\Users\User\Desktop\PROJETOS\CRM Corretor`). A pasta `brain` destina-se apenas a rascunhos, planos temporários e logs da IDE. É proibido manter documentação oficial exclusivamente na pasta `brain`.

---

## 2. Regras por Documento

### 2.1. STATUS_PROJETO (`docs/STATUS_PROJETO.md`)
- **Propósito**: Representar exclusivamente o estado ATUAL do repositório.
- **Regras**:
  - Sempre substituir informações antigas pelas novas.
  - Nunca acumular histórico de alterações.
  - Manter conciso e direto.

---

### 2.2. ROADMAP (`docs/ROADMAP.md`)
- **Propósito**: Representar exclusivamente o PLANEJAMENTO FUTURO do sistema.
- **Regras**:
  - Organizado por Sprints futuras com objetivo, prioridade e dependências.
  - Ao concluir uma Sprint, remover a pendência concluída e promover a próxima.
  - Nunca transformar em changelog ou histórico.

---

### 2.3. ARQUITETURA (`docs/ARQUITETURA.md`)
- **Propósito**: Documentar a estrutura técnica, decisões de design, convenções e padrões do projeto.
- **Regras**:
  - Atualizar **somente** quando houver alteração estrutural ou de convenção arquitetural.
  - Deve servir como guia de restrições para impedimento de código inconsistente.

---

### 2.4. DECISOES (`docs/DECISOES.md`)
- **Propósito**: Registrar decisões arquiteturais relevantes (Architecture Decision Records - ADRs).
- **Regras**:
  - Registrar **somente** decisões técnicas de alto impacto ou diretrizes de design.
  - Nunca registrar bugs, pequenas correções ou tarefas de progresso diário.

---

### 2.5. HANDOFF (`HANDOFF.md`)
- **Propósito**: Guiar a continuidade operacional rápida para novos desenvolvedores ou sessões de IA.
- **Regras**:
  - Manter focado em execução, comandos de inicialização e estado do ambiente.
  - Sempre referenciar os documentos SOT (`STATUS_PROJETO`, `ARQUITETURA`, `ROADMAP`) em vez de duplicar suas explicações.
  - Nunca transformar em histórico permanente.

---

### 2.6. Histórico por Sprint (`docs/sprints/`)
- **Propósito**: Armazenar o histórico permanente e imutável de cada Sprint concluída.
- **Regras**:
  - Cada Sprint gera exatamente um documento próprio (ex: `SPRINT_15.md`, `SPRINT_16.md`).
  - **Nunca** sobrescrever ou alterar o relatório de uma Sprint antiga.
  - Estrutura obrigatória: Objetivo, Escopo, Arquivos Criados/Alterados, Migrations, RPCs, Testes, Validações, Decisões, Limitações, Resultado e Próxima Etapa.

---

### 2.7. AUDITORIA_TECNICA (`docs/AUDITORIA_TECNICA.md`)
- **Propósito**: Registrar relatórios formais de auditoria técnica do sistema.
- **Regras**:
  - Atualizar apenas quando uma nova auditoria formal for conduzida.

---

### 2.8. README (`README.md`)
- **Propósito**: Ponto de entrada do repositório no GitHub.
- **Regras**:
  - Atualizar apenas quando houver mudanças relevantes no setup ou na arquitetura de documentação.
  - Manter o foco na onboarding inicial do projeto.
