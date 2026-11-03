# Procedimento de lançamento: desligar "só números cadastrados" (`ingest_only_known_contacts`)

> Documento de procedimento, escrito sem acessar produção. Nenhum passo foi executado. Os valores atuais da conexão de produção **não foram consultados**: o procedimento começa por conferi-los.

## 1. O que a chave faz
`channel_connections.ingest_only_known_contacts` (tela **Configurações > WhatsApp > "Só números cadastrados"**, só o proprietário altera, vira o evento de auditoria `whatsapp.ingest_settings_changed`):

| | **Ligada** (estado de teste) | **Desligada** (estado de lançamento) |
|---|---|---|
| Número desconhecido escreve | **Ignorado**: não grava nada, conta em `ignored_counts.unknown_contact`, não baixa mídia | **Cria contato provisório** + conversa + mensagem; entra em "Novas sem atendimento" no Hoje |
| Contato arquivado | Volta a ser desconhecido (silencia o número) | Mensagem reabre/usa o contato conforme a ingestão normal |
| Nono dígito (12 x 13) | Tolerado (`phone_match_candidates`) | **Igualdade exata** (pode duplicar contato; ver `docs/ESTUDO_LID.md`) |
| `@lid` | Nunca casa, é ignorado | **Cria contato com telefone falso** (achado conhecido; ver `docs/ESTUDO_LID.md`) |
| Mensagem do próprio número (auto-conversa) | Aceita | Aceita |
| Web Push | Só de contatos cadastrados | De toda conversa nova: sem responsável avisa **só o proprietário** |

A chave é independente de `ingest_groups` (grupos, desligado por padrão) e de `history_window_days` (trancado depois do pareamento).

## 2. Pré-requisitos (não desligar antes disto)
1. Web Push funcionando e testado em iPhone e Android reais (mini reteste de `docs/RELATORIO_WEB_PUSH.md`). Sem isso, o dono não é avisado de lead novo.
2. **Decisão sobre `@lid`** (`docs/ESTUDO_LID.md`): ou implementar a leitura de `remoteJidAlt` antes, ou aceitar que contatos `@lid` criarão contato com telefone falso (e não dá para responder a eles pelo CRM). **Recomendação: implementar antes de desligar.**
3. **Decisão sobre nono dígito no caminho normal**: mesma observação.
4. **Bloqueio de número** (`docs/ESTUDO_BLOQUEIO_NUMERO.md`): com a chave desligada, qualquer número (spam, ex, fornecedor) vira conversa. Ter como silenciar é importante; hoje a única forma é arquivar, que **não** impede a mensagem de voltar com a chave desligada.
5. **Backup** do Supabase e da Evolution recente e ensaiado (`docs/PLANO_BACKUP_VPS.md`).
6. Atendentes convidados e com permissão (teste de ponta a ponta de `docs/CHECKLIST_LANCAMENTO.md`) e regra de atribuição definida: lead sem responsável chega só para o proprietário.
7. Janela de histórico: lembrar que ela já está trancada pelo pareamento (não muda agora).
8. Número de WhatsApp: decidir se é o **pessoal** do corretor. Desligar a chave num número pessoal traz para o CRM **todas** as conversas pessoais novas (família, amigos). Se o número for misto, considerar manter a chave **ligada** e cadastrar os clientes, ou usar um número comercial.

## 3. Ordem das ações
1. **Janela**: escolher horário de baixo movimento e estar disponível por 1 hora.
2. **Conferir o estado** (leitura): tela WhatsApp conectada, "Só números cadastrados: Ligado", contador "N ignoradas" (anotar o valor: é a medida de quantos desconhecidos já escreveram).
3. **Backup** do banco do Supabase (como nas Trava A anteriores) e confirmação do último backup da VPS.
4. **Anunciar** à equipe: a partir de agora chegam contatos novos; o proprietário recebe os avisos dos sem responsável.
5. **Desligar** pela tela (Configurações > WhatsApp). Não é migration: é uma configuração da conexão, com auditoria.
6. **Verificar em 5 minutos**: mandar uma mensagem de um número que **não** está nos Contatos para o número do ImobFlux. Esperado: contato provisório criado, conversa em "Novas sem atendimento", aviso no celular do proprietário ("Nova mensagem de {nome}").
7. **Verificar em 1 hora e em 24 horas** (seção 5).
8. **Atribuir** os leads novos a atendentes; conferir que o atendente recebe o aviso só das conversas dele.

## 4. Como reverter
- **Imediato e sem perda**: religar a chave pela mesma tela. Passa a ignorar desconhecidos de novo. **Não apaga** o que já entrou.
- O que entrou enquanto estava desligada **permanece** (contatos provisórios, conversas, mensagens). Para limpar lixo: arquivar os contatos provisórios indesejados (ficam silenciados com a chave ligada). Exclusão real ainda não existe (`docs/ESTUDO_EXCLUSAO_CLIENTE.md`).
- Se houver avalanche de spam: religar primeiro, depois analisar.
- Não há rollback de banco (nenhuma migration).

## 5. O que monitorar
| O quê | Onde | Alerta |
|---|---|---|
| Quantidade de contatos provisórios novos por hora | Hoje > "Novas sem atendimento"; Contatos | Salto fora do normal (spam) |
| Contatos com telefone de 14 a 15 dígitos ou nome "Contato +…" | Contatos | Sinal de `@lid` virando contato falso |
| Duplicados (mesmo nome, 12 x 13 dígitos) | Contatos | Nono dígito |
| Contador "N ignoradas" | Configurações > WhatsApp | Deve parar de crescer em `unknown_contact` |
| Falhas do webhook (4xx/5xx) | Logs da Vercel (`[webhook-shape]`, erros) | Qualquer 5xx recorrente |
| Avisos de push (`[push] aparelhos=… enviados=… falhas=…`) | Logs da Vercel | `falhas` altas ou `desativados` subindo |
| Tempo de resposta do webhook | Logs da Vercel | Aumento (a ingestão agora grava mais) |
| Espaço no Supabase (banco e Storage) | Painel do Supabase | Mídia de desconhecidos enchendo o plano |
| SLA: conversas novas sem resposta | Hoje | Leads sem dono esquecidos |

## 6. Riscos
Spam e conversas pessoais invadindo o CRM; contatos duplicados e com telefone falso (`@lid`, nono dígito); o proprietário inundado de avisos (todo lead sem responsável avisa só ele); mídia de desconhecidos consumindo o armazenamento gratuito; privacidade (conversas de terceiros que nunca foram clientes passam a ser gravadas: avaliar base legal e o aviso de privacidade); impossibilidade de excluir de verdade.

## 7. Decisões que o Mário precisa tomar
1. Desligar já no lançamento ou manter ligada e cadastrar clientes? (Depende do número ser pessoal ou comercial.)
2. Implementar o tratamento de `@lid` e do nono dígito **antes** de desligar? (recomendado)
3. Bloqueio de número antes do lançamento?
4. Quem recebe os leads novos: só o proprietário no início, ou distribuição automática (ainda não existe)?
5. Aviso de privacidade/termos para quem escreve para o número.
6. Data e horário da janela, e quem acompanha.
