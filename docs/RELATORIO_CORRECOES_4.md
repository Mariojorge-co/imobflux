# Relatório — Correções 4 (vídeo grande, botão Sair no celular, duplo clique na linha) — branch local `fix/mensagens-4`

> Estado: **pronto e testado localmente; NADA publicado.** Parte da `main` (`efda91a`). **Há 1 migration** (`20260802006400_media_bucket_50mb`,
> muda só a configuração do bucket de mídia, com rollback): a ordem é **Trava A (banco) → Trava B (app)**. Sem a Trava A, o app novo ainda
> mostra o aviso final correto para arquivos grandes, mas só passa a **guardar** de 25 a 50 MiB depois dela.

## 1. Vídeo grande que não carrega — causa raiz (com evidência, consulta SOMENTE LEITURA em produção)

| Fato (produção) | Valor |
|---|---|
| `storage.buckets` → `whatsapp-media` | privado, `file_size_limit = 26214400` (25 MiB) |
| Maior anexo **guardado** (`available`) | 25.283.975 bytes (um 7z de 24,1 MiB) |
| Anexos **não** disponíveis (`unavailable`) | **4**, de 35.287.337 a **50.042.451** bytes (o vídeo "47,7 MB", um `.zip` de 41,9 MB e dois `.rar` de 35,3 MB) |
| Anexos abaixo do limite que falharam | **0** |
| Vídeos menores (0,5 a 10 MB) | todos `available` |

**Hipótese (a) confirmada**: o limite de 25 MiB (no bucket e na constante `MAX_MEDIA_BYTES`) recusa todo arquivo maior; nenhum anexo abaixo
dele falhou. As hipóteses (b) e (c) não são a causa: o `unavailable` do vídeo vem do `TOO_LARGE` do `decodeBase64Media` (o app baixava a
Evolution inteira, ~67 MB de base64, para só então descartar).

**Por que parecia "Tentando… para sempre"**: o anexo `unavailable` mostrava o botão "Tentar novamente"; cada clique rodava de novo o download
completo (JSON de ~67 MB da Evolution) e só no fim devolvia o erro — lento e sem desfecho claro, e nada impedia repetir.

**Limite do plano do Supabase**: **não foi possível ler** (exige token da Management API, que não está nesta máquina). O limite global de upload
do plano continua valendo acima do bucket (no plano gratuito costuma ser 50 MiB). Os 50.042.451 bytes do vídeo são **47,7 MiB**, ou seja, cabem em
50 MiB. **Confirme no painel (Storage > Settings > Global file size limit) antes de aplicar a Trava A.**

## 2. O que foi corrigido

- **Bucket e constante em 50 MiB** (`MAX_MEDIA_BYTES`; migration `20260802006400_media_bucket_50mb.sql` + `docs/rollback/20260802006400_rollback.sql`;
  pgTAP ajustado em `whatsapp_media_storage` e `outgoing_media`). O **envio** (ImobFlux → WhatsApp) continua em 25 MiB (a função
  `queue_outgoing_media_message` não mudou).
- **Sem baixar o que não cabe**: o webhook compara o tamanho declarado com o limite; acima de 50 MiB não chama a Evolution e marca o anexo como
  indisponível na hora (`[whatsapp-media] arquivo acima do limite…`). O "Tentar de novo" manual também responde de imediato.
- **Retry limitado e com espera** (`storeAttachmentMediaWithRetry`): falhas passageiras (rede, tempo, Evolution/Storage) repetem até 3 vezes com
  espera de 2 s e 6 s, dentro de um orçamento de 52 s (a rota roda no máximo 60 s); falhas finais (`TOO_LARGE`, `NOT_FOUND`, resposta inválida)
  **não repetem**. Acabadas as tentativas o anexo fica `unavailable` de vez. Tempo de espera da Evolution: 20 s + 1 s por MB (máx. 50 s).
- **Estado final claro**: "Arquivo grande demais para o ImobFlux (60,0 MB; limite 50 MB). Abra no WhatsApp." com o botão **"Tentar de novo"**
  (manual). O botão nunca fica em "Tentando…" para sempre: passados 70 s o estado vira erro e o botão volta.
- **Rótulo certo**: "Vídeo · 47,7 MB" (nomes genéricos como `video`, `audio`, `imagem` não repetem o tipo); nomes de verdade continuam
  ("PDF · contrato.pdf · 1 KB"). Vídeos que já carregam ficam iguais.
- **Botão Sair no celular/tablet**: saiu da barra (ao lado do sanduíche) e foi para **dentro do menu**, separado dos links por uma linha, com
  confirmação **"Sair do ImobFlux?"** (Cancelar recebe o foco; botões com 44 px e 16 px de distância). No desktop continua na barra, sem confirmação.
- **Duplo clique na linha inteira**: o gesto agora vale na faixa horizontal da mensagem (inclusive o vazio ao lado da bolha), com a mesma regra de
  exceções (links, botões, anexos, menus, apagadas, edição, gravação, notas internas e divisores/mensagens de sistema ficam fora da linha). Arrastar
  o mouse continua selecionando; a seleção é limpa ao disparar. Realce leve (`hover:bg-neutral-soft/40`) na linha quando ela responde.

## 3. Limites reais (sem esconder)

- **Vercel/memória**: a Evolution só entrega o arquivo em base64 dentro de um JSON; um arquivo de 50 MiB vira ~67 MB de texto + 50 MB de buffer em
  memória (cerca de 250 MB de pico). Deve caber nas funções da Vercel (o limite de memória do plano não foi consultado aqui), mas é o teto prático — **não há stream/URL assinada** nesse
  caminho com a Evolution v2.3.7. Acima de 50 MiB: aviso final, sem tentar contornar.
- **Plano do Supabase**: se o limite global do projeto for menor que 50 MiB, o upload falha (`STORAGE_ERROR`) e a tela explica; o dono precisa
  conferir o painel antes da Trava A.
- Opções futuras (não implementadas): miniatura/compactação do vídeo no servidor, ou armazenamento externo (S3/R2) para arquivos > 50 MiB.
- O vídeo de 47,7 MiB que já falhou continua `unavailable` até a Trava A + B; depois, o **"Tentar de novo"** manual deve guardá-lo (se a Evolution
  ainda tiver a mensagem).

## 4. Testes

| Camada | Resultado |
|---|---|
| Lint, tipos | limpos |
| Unitários Node 22 / 24 | **627 testes** passando nos dois (novos: retry com espera/orçamento, timeout por tamanho, rótulo e aviso final, webhook acima do limite, ação de retry com arquivo grande) |
| Build (variáveis fake de CI) | ok |
| pgTAP | `whatsapp_media_storage` e `outgoing_media` passam com a migration 006400 (aplicada só no banco local) |
| Navegador novo — `correcoes-4` | **8/8** (vídeo grande com aviso final e sem laço; vídeo de 26 MB guardado e servido inteiro; arquivo ausente na Evolution termina com motivo; Sair em 390×844 fora da barra, dentro do menu com confirmação, alvos ≥ 44 px e ≥ 16 px; Sair no desktop; duplo clique ao lado da bolha; arrastar seleciona; botão do menu não responde) |
| Regressão (uma por vez) | ver o fim deste arquivo (preenchido ao terminar a rodada) |

## 5. MINI RETESTE (3 minutos) — depois da Trava A e da Trava B

1. Em um vídeo recebido grande que já falhou (o de 47,7 MB), clique em **"Tentar de novo"**: deve carregar (ou mostrar o motivo e voltar o botão, sem ficar "Tentando…").
2. Receba um vídeo de uns 30 a 45 MB: deve carregar sozinho.
3. No celular: a barra tem só o sanduíche; **Sair** está dentro do menu e pede "Sair do ImobFlux?".
4. No computador: dê duplo clique **no vazio ao lado de uma bolha**: abre a citação com o cursor no campo. Arrastar para selecionar texto continua funcionando.

## 6. Observação sobre a `feat/pacote-noite`

Ao rebasear, a migration da Noite que usa `20260802006300` já precisa ir para `006500` (a 006400 agora é esta); as demais seguem: `006400→006600`,
`006500→006700`. Atualizar também a lista `SHORTCUTS` (duplo clique na linha) quando a ajuda de atalhos entrar.

## 7. Regressão de navegador (uma suíte por vez, ambiente descartável)

responder-gesto 7, correcoes-mensagens 14, mensagens-pacote 14, send-files 11, auth-flow 17, conversations 13, quick-replies 8,
sprint23-conversations-evolution 7, grupos-e-propria 7, inbox-realtime 3, sprint24-blocob-polish 14 (1 ignorado, como antes), team-management 3,
correcoes-4 8 — **todas passando**.

**Instabilidade registrada**: na primeira rodada de `mensagens-pacote`, o teste "áudio de voz: gravar, ver o tempo…" falhou uma vez
(`toContainText`) enquanto eu rodava em paralelo os unitários e o build na mesma máquina; repetida isolada, a suíte passou **14/14**.
Não mexe em nada deste pacote (o gravador de voz não foi alterado). Não contornei.
