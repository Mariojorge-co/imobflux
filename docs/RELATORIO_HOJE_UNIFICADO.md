# Relatório — Hoje unificado (Hoje + Prioridades em uma tela só)

Branch `feat/hoje-unificado`, a partir da `main` `8db36b6`. **Sem migration** (só a Trava B), sem push, sem deploy. Não mexi em Evolution, webhook,
banco de produção, variáveis da Vercel, fila de envio, SLA (regra de cálculo) nem permissões.

## O que foi feito

`/hoje` virou a tela única de "o que fazer agora". `/prioridades` deixou de existir como tela.

**Ordem das seções (de cima para baixo)**

1. **Contadores do dia**: "Para agir agora" (novo), Recebidas hoje, Enviadas hoje, Conversas novas, Tarefas concluídas.
2. **Clientes aguardando resposta da equipe** (a equipe está devendo resposta).
3. **Follow-ups devidos** (ações marcadas que venceram ou vencem hoje; Reagendar e Concluir como antes).
4. **Tarefas de hoje e atrasadas**.
5. **Novas conversas sem atendimento**.
6. **Aguardando cliente** (a bola está com o cliente), agrupado por nível (Atenção / Atrasado / Muito atrasado) com o limite de cada nível.
7. **Higiene de cadastro**, por último e **recolhida** (um `<details>`): pendentes de qualificação, sem telefone, leads sem revisão recente e novos nos
   últimos 7 dias (quatro cartões de contagem + as quatro listas).

Cada seção tem título, contagem, lista limitada (6 itens) com **"Ver mais (N)"** / "Ver menos", e um estado vazio com texto amigável. O carregamento
continua pelo `loading.tsx` da rota.

**Sem números duplicados**: o mesmo cliente pode aparecer em mais de uma seção (aguardando + follow-up devido + nova sem atendimento), mas "Para agir agora"
conta cada pessoa uma vez (chave = contato; sem contato, a conversa; sem conversa, a tarefa). "Aguardando cliente" e a higiene não entram nesse número. Um
follow-up devido também não repete na lista de tarefas (mesmo registro, uma só linha).

**Navegação**: `/prioridades` redireciona com **308 (permanente)** para `/hoje` em `next.config.ts`; o item "Prioridades" saiu do menu (o "Hoje" mantém o ícone);
login, convite, setup e a raiz agora caem em `/hoje`; `requireOwnerAccess` manda para `/hoje?reason=owner_required`; `revalidatePath` e a lista de rotas
privadas do proxy trocaram `/prioridades` por `/hoje`; textos de ajuda (Configurações, Prazos, controle de prazo) dizem "Hoje". A busca global e o painel de
atalhos não citavam Prioridades (nada a trocar).

**Consultas**: sem migration, as mesmas RPCs. O Hoje agora faz, **em paralelo**, `get_today_overview`, `get_prioridades_dashboard`, os prazos, as tarefas e (só
proprietário) a lista de membros. Saiu `get_sla_conversations` (a lista de conversas com prazo já vem no overview): **uma consulta a menos** do que as duas telas
juntas.

**Arquivos**: `components/hoje/hoje-view.tsx` (nova estrutura), `components/hoje/limited-list.tsx` (Ver mais), `lib/hoje/model.ts`
(`countActionTargets`, `withoutDuplicatedFollowups`), `app/(app)/hoje/page.tsx`, `next.config.ts`, `components/sidebar.tsx`; removidos `app/(app)/prioridades/*`,
`components/prioridades/priority-client-item.tsx` e `lib/conversations/sla-conversations-data.ts` (sem uso). Os itens de follow-up e de cadastro de
`components/prioridades/` foram reaproveitados. O link do título do follow-up ganhou altura de 44 px (o teste de toque pegou 36 px).

## Decisões (sem inventar regra nova)

- **Visibilidade das conversas**: seguem as regras do Hoje (atendente só vê as dele e as novas sem dono; proprietário vê a equipe e filtra por responsável).
  Em Prioridades o atendente via a fila inteira com prazo; **agora vê só a dele**, como já era no Hoje. Grupos, conversa consigo mesmo, arquivadas e prazo
  pausado/desativado já ficam de fora na própria RPC (a mesma base das duas telas). Follow-ups devidos e higiene seguem a RLS, como antes.
- **Nome das seções**: "Follow-ups devidos" (ações marcadas) e "Aguardando cliente" (conversas paradas) separam o que antes se chamava "follow-up" nas duas telas.
- **"Para agir agora"** é um contador novo (os quatro do dia ficam como estavam).
- Campos continuam com 16 px (regra dos Ajustes 7); não mexi no Diagnóstico de tela nem no layout da conversa; sem `maximum-scale`/`user-scalable`.

## Testes

- **Lint e tipos:** limpos. **Unitários:** 680 passando em **Node 22 e Node 24** (3 novos: "Para agir agora" sem duplicar, aguardando cliente fora da contagem, follow-up não repete nas tarefas). **Build** com variáveis fake de CI: ok (`/hoje` dinâmica, `/prioridades` não existe mais como rota).
- **Banco:** nenhuma migration; nada novo em pgTAP.
- **Navegador novo** `tests/hoje-unificado.spec.ts` (11): ordem das seções (contadores primeiro, higiene por último), contagem e título em cada seção, mesmo cliente em 3 seções soma 1 em "Para agir agora", higiene recolhida e abrindo com os 4 grupos, "Ver mais"/"Ver menos", redirect 308 de `/prioridades` e menu sem "Prioridades", atendente sem filtro da equipe, celular 360/390/430 (sem rolagem lateral, nada além da borda, seções sem sobreposição, alvos de toque ≥ 44 px) e computador 1440. `tests/hoje-unificado-tema.spec.ts` (4): contraste AA em claro/escuro, 390 e 1440 px, com a higiene fechada e aberta: **0 violações**.
- **Regressão, uma suíte por vez (ambiente descartável), todas passando no fim:** hoje 5, ajustes-7 13, ajustes-7-tema 4, celular 12, tema 7, tema-novas-telas 4, tema-correcoes 4, busca-global 8, conversations 13, sprint23-hotfix 5, sprint23-conversations-evolution 7, prazos 7, functional-hotfix 3, collaboration-hotfix 4, correcoes-4 8, auth-flow 17, team-management 3, atalhos 12, ajustes-6 20, ajustes-5 9, notificacoes 5.
- **O que a regressão pegou (testes antigos que dependiam da tela antiga, não bugs):** `prazos` e `hoje` procuravam o cliente mais recente numa lista que agora corta em 6 (passaram a abrir "Ver mais" pelo ajudante `tests/helpers/hoje.ts`); `auth-flow` olhava os cartões de higiene, agora recolhidos (abre o título antes); `team-management` e `prazos` esperavam `/prioridades?reason=owner_required` (agora `/hoje?...`); `functional-hotfix` e `prazos` usavam títulos/ids da tela antiga. Meu teste de toque achou o link do título do follow-up com 36 px (corrigido para 44 px).
- **Chrome, não WebKit/iPhone:** o layout foi medido no Chrome em 360/390/430; a aparência no Safari do iPhone só o aparelho confirma.

## O que só o uso real confirma

- Se a ordem das seções serve ao dia a dia (por exemplo, se "Aguardando cliente" deveria vir antes das novas conversas).
- Se o **atendente** sente falta de ver a fila dos colegas (antes via em Prioridades; agora só a dele).
- Com muitos clientes de verdade: o limite de 6 itens e o "Ver mais" (a lista vem do mais antigo para o mais novo, então o cliente mais recente fica no fim).

## Mini reteste (3 minutos, no celular)

1. Abra **Hoje**: o menu não tem mais "Prioridades"; no topo há "Para agir agora" e os contadores do dia.
2. Role: as seções vêm na ordem acima e a **Higiene de cadastro** é a última, **fechada**; toque nela e ela abre.
3. Numa lista com mais de 6 itens, toque **Ver mais**. Confira se nada sai da tela para o lado.
4. Abra um favorito antigo de `/prioridades` (ou digite o endereço): deve cair em Hoje.
5. Toque num cliente (abre a conversa), conclua um follow-up devido e confira se o número de "Para agir agora" desce.
