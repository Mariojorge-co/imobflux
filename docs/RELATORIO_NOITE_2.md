# Relatório — Pacote Noite 2

> Branch `chore/noite-2`, a partir da `main` `ef87781`. **Somente testes e documentação**: nenhum arquivo de `app/`, `components/`, `lib/`, `supabase/` ou `public/` foi alterado, não há migration, e nada foi enviado (sem push, merge ou deploy). Nada de produção foi acessado (banco, Vercel, VPS, Evolution, WhatsApp). Nenhuma chave foi exibida ou registrada.

## 1. Parte A — testes instáveis

Método: cada suíte rodou **5 vezes isoladas**, com o servidor de teste **encerrado e subido do zero** a cada rodada (o pior caso: servidor frio). Depois das correções, as suítes alteradas rodaram mais 5 vezes. Só arquivos de teste foram mudados; nenhum timeout foi aumentado.

| Suíte | Antes (falhas em 5) | Causa encontrada | O que mudou no teste | Depois |
|---|---|---|---|---|
| `atalhos` (Alt+seta) | **1** | Depois do Alt+↓ a URL muda **antes** de a lista re-renderizar com a conversa nova selecionada; o Alt+↑ imediato parte da seleção antiga e vai para a vizinha de cima de onde estava. | Espera o cartão novo ficar ativo (`aria-current`) antes de voltar. | **5/5** |
| `send-files` (vídeo) | **2** | (a) O MP4 do teste era de bytes falsos: o `<video>` dispara erro de decodificação e o app troca a miniatura pelo "Tentar de novo"; o teste só passava se contasse a miniatura **antes** desse erro. (b) Um 404 do webhook na primeira chamada com servidor frio (ver abaixo). | O teste agora grava um **MP4 H.264 válido no próprio Chrome** (canvas + `MediaRecorder`, codec explícito `avc1`; com `video/mp4` puro o Chrome escolhe VP9 e a gravação sai vazia) e espera os **dados chegarem** em vez de um tempo fixo. | **5/5** |
| `prazos` (webhook 404 na preparação) | 0 | Mesmo 404 da primeira chamada ao webhook com servidor frio (visto antes, não reproduzido nas 5 rodadas). | Helper do webhook espera a rota existir (abaixo). | **5/5** |
| `web-push` (service worker, servidor frio) | 0 | Não reproduzido. Hipótese: evento disparado antes de o worker estar ativado e controlando a página. | `serviceWorkerOf` só devolve o worker depois de provar `controller.state === "activated"` e `registration.active.state === "activated"`. | **5/5** |
| `auth-flow` | 0 | Não reproduzido. | Nada (já usa esperas por estado). | 5/5 (linha de base) |
| `tema-novas-telas` (hidratação) | 0 | Não reproduzido; já espera `data-ready="true"` da coluna da conversa. | Nada. | 5/5 (linha de base) |
| `sprint23-conversations-evolution` | 0 | Não reproduzido; usa o helper do webhook (ganha o aquecimento). | Nada além do helper. | 5/5 (linha de base) |
| Suíte isolada `email-auth-flow` (cópia descartável `imobflux-auth-disposable`, Supabase na porta 56321) | 1 rodada de 4 | **Não foi falha de teste**: o servidor de teste (porta 3100) estourou os 120 s para subir. Logo depois do `db reset` os serviços do Supabase ainda reiniciam e a página de login (que consulta o Auth) fica pendurada. | No **executor** (script fora do repositório), a cada rodada: espera o Auth/API ficarem saudáveis após o reset e libera a porta 3100. | **5/5** (5 rodadas, banco novo em cada uma; as 3 primeiras rodadas anteriores também passaram) |

**Helper compartilhado (`tests/helpers/webhook.ts`)**: antes da primeira chamada real ao webhook em cada processo de teste, espera a rota responder **401** a uma chamada **sem o segredo** (prova que a rota existe, não grava nada). Cobre o "webhook 404" de `prazos` e `send-files` e protege todas as suítes que usam o webhook. O 404 acontece só no servidor de desenvolvimento recém-subido (compilação sob demanda); **não** é um comportamento da produção.

**Hidratação rápida (clicar antes de a página hidratar)**: foram revisados os testes que já comentam o problema (`conversations`, `mensagens-pacote`, `sprint24-blocob-polish`, `ajustes-5-tema`, `ajustes-6`, `tema-novas-telas`, `atalhos`); todos já esperam um marcador de estado (`data-ready`, `data-realtime-inbox="ready"`) ou repetem a ação com `toPass`. Nenhuma falha dessa família apareceu nas rodadas; nenhuma mudança necessária.

**Honestidade sobre o que foi provado**: `atalhos` e `send-files` **falharam e foram corrigidos** (de 1/5 e 2/5 para 0/5). `prazos`, `web-push`, `auth-flow`, `tema-novas-telas` e `sprint23` **não reproduziram** em 5 rodadas frias; as mudanças feitas nelas são **endurecimentos preventivos** pelas causas prováveis, não correções comprovadas. Podem voltar a falhar raramente.

**Regressão completa** (uma suíte por vez, servidor reiniciado entre elas): **42 arquivos de navegador, 323 testes passando, 0 falhas, 1 ignorado** (um `skip` que já existia em `sprint24-blocob-polish`). `web-push-desligado` rodou com `IMOBFLUX_TEST_VAPID=off`.

**Intercorrência de processo (sem efeito no resultado)**: uma tentativa minha de interromper a série de validação com um comando amplo (encerrar todos os processos Node) foi **barrada** pelo controle de permissões; encerrei então só os processos da cadeia e do servidor de teste. As rodadas que coincidiram com a interrupção foram **descartadas** e refeitas do zero. Nada fora dos testes foi afetado.

## 2. Bugs reais do app encontrados
**Nenhum confirmado.** Observações (nada foi corrigido):
1. **Janela mínima de seleção antiga no Alt+seta** (`components/conversations/conversations-list.tsx`, atalho usa `selectedId` da renderização anterior): para reproduzir, pressionar Alt+↓ e Alt+↑ com menos de um quadro de intervalo (o teste automatizado faz; uma pessoa não consegue). Gravidade baixíssima.
2. **Vídeo com mídia inválida mostra "Tentar de novo"** (`components/conversations/attachment-view.tsx`): comportamento intencional dos Ajustes 6; apenas explica por que o teste antigo era instável.
3. **Primeiro uso do webhook após subir o servidor de desenvolvimento pode dar 404**: só ocorre em `next dev`; ver acima.

## 3. Arquivos alterados (apenas testes e documentação)
`tests/atalhos.spec.ts`, `tests/send-files.spec.ts`, `tests/web-push.spec.ts`, `tests/helpers/webhook.ts`, `docs/ROADMAP.md`, `docs/STATUS_PROJETO.md` e os documentos novos abaixo. O executor da suíte isolada e as cadeias de rodadas ficaram **fora do repositório** (pasta temporária).

## 4. Documentos criados e a decisão que cada um pede

| Documento | Decisão principal do Mário |
|---|---|
| [ESTUDO_LID.md](ESTUDO_LID.md) | Contato `@lid` sem telefone: criar provisório ou ignorar? Aceita mesclar duplicados? Autoriza coleta de amostras antes de implementar? |
| [ESTUDO_EXCLUSAO_CLIENTE.md](ESTUDO_EXCLUSAO_CLIENTE.md) | Prazo de guarda; anonimizar basta?; só o proprietário exclui?; lixeira de quantos dias? |
| [ESTUDO_BLOQUEIO_NUMERO.md](ESTUDO_BLOQUEIO_NUMERO.md) | Só ImobFlux primeiro?; o que fazer com a conversa existente?; bloquear também no WhatsApp (afeta o celular pessoal)? |
| [ESTUDO_LEMBRETES_TAREFA.md](ESTUDO_LEMBRETES_TAREFA.md) | **Qual o plano da Vercel** (Hobby só tem cron diário)?; quem recebe; título da tarefa no aviso? |
| [PLANO_BACKUP_VPS.md](PLANO_BACKUP_VPS.md) | Onde guardar a cópia externa, orçamento, retenção; autoriza uma sessão com acesso à VPS só para verificar o cron e o disco? |
| [PROCEDIMENTO_LANCAMENTO_INGESTAO.md](PROCEDIMENTO_LANCAMENTO_INGESTAO.md) | Desligar "só cadastrados" no lançamento? Tratar `@lid`/nono dígito e bloqueio **antes**? Número é pessoal ou comercial? |
| [AUDITORIA_PRE_LANCAMENTO.md](AUDITORIA_PRE_LANCAMENTO.md) | Autorizar um pacote de correções (Next.js, cabeçalhos, erros, limites) |
| [CHECKLIST_LANCAMENTO.md](CHECKLIST_LANCAMENTO.md) | Ordem das fases; decisões reunidas na seção D; teste de ponta a ponta com atendente real |

## 5. Resumo da auditoria (gravidade alta primeiro)
| Gravidade | Achado |
|---|---|
| **Alta** | **Next.js 16.2.12 com avisos críticos/altos** (RCE em otimização de imagem, `use cache`, `ImageResponse`; DoS em Server Actions; SSRF na otimização de imagem). Correção disponível: **16.4.4**. O aviso de **Server Actions se aplica** ao app. Fazer antes do lançamento, com regressão completa. |
| Média | Sem cabeçalhos de segurança (CSP, X-Frame-Options, Permissions-Policy). |
| Média | Sem limite de taxa próprio nas rotas sensíveis (anexos, exportação, webhook); confirmar limites do Supabase Auth. |
| Média | `error.message` bruto do banco devolvido ao navegador em ações de conversa (6 pontos). |
| Média | Dependências indiretas com avisos altos (postcss, sharp, zod, nanoid, js-yaml…); resolvem com a atualização do Next e `npm audit fix` sem `--force` (o `eslint@4` sugerido é falso conserto). |
| Baixa | SSRF do avatar só cobre IPv4 literal; lista de rotas privadas do `proxy.ts` incompleta (a proteção real está no layout); sem páginas próprias de erro/404; bucket sem tipos MIME permitidos; `console.error` do webhook registra o objeto de erro inteiro. |
| Informativo | IP da VPS e `sslip.io` em documentos/exemplos versionados; chave de exemplo legível em `.env.evolution.example` (não é segredo). |
| **OK** | **Nenhum segredo** no repositório nem nos 200 commits recentes; **RLS ligada e com política em todas as tabelas**; **todas as 98 funções `SECURITY DEFINER` com `search_path` vazio**; `anon` sem acesso a dados; `authenticated` só com `SELECT` (escritas por RPC); Storage privado sem políticas diretas; webhook com segredo em tempo constante; sem `dangerouslySetInnerHTML` com dado de usuário. |

## 6. Verificações finais
- Lint: sem erros nem avisos (um aviso de `mp4` sem uso, criado por mim, foi removido).
- Tipos: sem erros.
- Unitários: **720 passando** em Node 22 e em Node 24.
- Build com variáveis fake de CI: ok.
- pgTAP: **não rodado** (nenhuma mudança de banco).
- Regressão de navegador: **42 arquivos, 323 passando, 0 falhas, 1 ignorado pré-existente**, mais a suíte isolada de autenticação 5/5.

## 7. Estado do ambiente local
A pilha do Supabase da cópia descartável `imobflux-auth-disposable-20261011-131017` (portas 56321 a 56329) ficou **ligada** e com o banco recriado; pode ser desligada com `npx supabase stop` naquela pasta. Nada disso é a produção nem o banco local principal.

## 8. Próximos passos
Aguardo o seu "autorizo" para a **Trava B** (só testes e documentação: não há Trava A). Sugestão de ordem para depois: pacote de segurança (Next 16.4.4 + cabeçalhos + erros) antes do teste com atendente real; ver `CHECKLIST_LANCAMENTO.md`.
