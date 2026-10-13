# Roadmap do Projeto — ImobFlux

Planejamento da evolução do **ImobFlux**. Estado atual em [STATUS_PROJETO.md](STATUS_PROJETO.md).

---

## Concluído

- **Sprints 15–18**: Prioridades reais, Contatos, Conversas, integração WhatsApp textual, Kanban comercial.
- **Sprint 24**: refinamento de UX, identidade canônica de conversas, reordenação persistente do Kanban.
- **Equipe e acesso**: convite por e-mail (SMTP próprio), aceite, redefinição de senha, desativar/reativar.
- **Privacidade reforçada**: contato protegido também em grupo liberado e anexos; webhook com segredo.
- **Mídia no WhatsApp**: download para Storage privado e visualização de imagem, PDF e áudio na conversa.
- **Conexão por QR code**: tela de Configurações > WhatsApp (conectar, renovar QR, desconectar).
- **Rodada de melhorias (outubro/2026)**:
  - correções de bugs de ingestão, oportunidade pela conversa e envio honesto;
  - SLA visual (selo único) na lista, na conversa e no Kanban;
  - Kanban no celular (abas por etapa) e estados vazios guiados;
  - importação de histórico recente do WhatsApp (15 dias), marcada e fora do SLA, com aviso de falha;
  - CI no GitHub (lint, tipos, unitários, build, migrations e pgTAP) e testes sem duplicação.

---

## Próximas prioridades (para uso real)

1. **Hospedar a Evolution API** (VPS Contabo, Debian 12) e **configurar o Vercel**
   (`EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_WEBHOOK_SECRET` + redeploy).
   Passo a passo em [DEPLOY_EVOLUTION_VPS.md](DEPLOY_EVOLUTION_VPS.md). Prioridade: **ALTA**.
2. **Teste com número real**: pareamento, envio/recebimento, mídia, histórico (medir o que o celular envia),
   SLA e privacidade. Roteiro na seção 8 do mesmo documento. Prioridade: **ALTA**.

## Pendências do documento de MVP

Itens do `FLUXOS_NEGOCIO.md` ainda não implementados, em ordem sugerida:

1. **Remoção de funcionário** (fluxo 23) e encerramento de responsabilidades ao desativar.
2. **Atribuição de conversa e troca de responsável** (fluxos 18 e 19; tabela `conversation_assignments` já existe).
3. **Tela de auditoria** para o OWNER (fluxo 25).
4. **Tela própria de tarefas** (fluxos 16 e 17).
5. **Exportação de dados** pelo OWNER (fluxo 26).

## Qualidade contínua

- Atualizar `HANDOFF.md` (ainda descreve a Sprint 24).
- Executar a suíte Playwright isolada de autenticação em ambiente descartável antes de cada release.
- Auditoria geral final (segurança, RLS, performance e UX) antes de comercializar.

---

## Propostas futuras (fora do escopo imediato)

> [!NOTE]
> Possibilidades de expansão, não compromissos.

- Importação de histórico mais profunda, se o provedor permitir (hoje depende do celular e vem uma vez só).
- Envio de mídia pelo CRM (hoje só recepção e visualização).
- Ações comerciais adicionais além do fluxo de ganho/perda atual.
- Instagram Direct.
