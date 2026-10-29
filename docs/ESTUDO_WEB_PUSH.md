# Estudo — avisos de mensagem nova com o ImobFlux fechado (Web Push)

> Só estudo: nenhum código foi escrito para isto. Data da pesquisa: 28/10/2026. Cada afirmação diz se é **confirmada** (fonte primária) ou **não confirmada** (fonte secundária ou ainda não testada).

## 1. O problema, em uma frase

Hoje o aviso (título com número, som, aviso do sistema) só existe **com o ImobFlux aberto**. Com o app fechado, em segundo plano no iPhone, ou com o aparelho bloqueado, nada chega. O único jeito de avisar nesse caso é o **servidor** empurrar a notificação (Web Push).

## 2. Como funciona o Web Push (visão simples)

1. O navegador do aparelho cria uma **assinatura** (um endereço único no serviço de push do fabricante: Google, Apple ou Mozilla) e entrega ao ImobFlux.
2. O ImobFlux guarda essa assinatura no banco, ligada à pessoa e ao aparelho.
3. Quando chega uma mensagem de cliente, o **servidor** envia um pequeno recado a esse endereço, assinado com a chave **VAPID** do ImobFlux.
4. O serviço de push acorda o **service worker** do aparelho (mesmo com o app fechado), que mostra a notificação. Tocar nela abre a conversa.

Peças necessárias: (a) service worker com tratamento de `push` (hoje o `/sw-avisos.js` só trata o clique); (b) permissão pedida por um **toque da pessoa**; (c) tabela de assinaturas; (d) envio pelo servidor; (e) um par de chaves VAPID.

## 3. Por plataforma

| Plataforma | Funciona? | Observação |
|---|---|---|
| **Computador** (Chrome, Edge, Firefox; Safari recente no Mac) | Sim, com o navegador aberto em qualquer aba **ou** em segundo plano; com o navegador totalmente fechado depende do sistema (Chrome costuma manter um processo em segundo plano). | Não confirmado em todos os sistemas; testar em Windows e Mac. |
| **Android** (Chrome; Opera, Edge, Samsung Internet) | Sim, inclusive com o app fechado, sem precisar instalar. Instalar como app melhora a confiabilidade. | Confirmado em geral (padrão W3C); o comportamento do Opera no Android não foi testado aqui. |
| **iPhone/iPad, iOS 16.4 ou mais novo** | **Somente** o app **instalado na Tela de Início** (Compartilhar → Adicionar à Tela de Início). | Confirmado pelo WebKit (ver abaixo). |
| **iPhone no Safari/Opera/Chrome como aba** | **Não.** | Confirmado: abas do navegador não podem pedir permissão de push no iOS. |

### Regras do iOS (confirmado em [WebKit: Web Push for Web Apps on iOS and iPadOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/))

- Só **web apps adicionados à Tela de Início** recebem Web Push. Para isso o manifest precisa ter `display: standalone` (ou `fullscreen`); senão o iOS salva apenas um atalho que abre no navegador. **O manifest do ImobFlux já tem `standalone` (Ajustes 6).**
- A permissão só pode ser pedida **em resposta a um toque** (um botão "Ativar avisos").
- A entrega passa pelo serviço de push da Apple (APNs). **Não precisa** de conta de desenvolvedor Apple paga. Se o servidor limitar destinos de saída, liberar `*.push.apple.com`.
- A notificação aparece na tela bloqueada, na Central de Notificações e no Apple Watch pareado. A pessoa controla por app em Ajustes → Notificações e pelos **Modos de Foco**.
- O app pode se instalar mais de uma vez; o `id` do manifest identifica o app para o Foco.
- Boa prática da Apple: detectar o recurso (feature detection), não o navegador.
- Não consta no post a regra sobre push "silencioso"; a experiência prática é que o iOS **exige mostrar uma notificação** a cada push (não confirmado por fonte primária lida aqui) — o desenho abaixo já mostra sempre uma notificação.

### Navegadores de terceiros no iPhone (Opera, Chrome, Edge)

- **Confirmado:** desde o iOS 16.4 um navegador de terceiros pode oferecer "Adicionar à Tela de Início" no menu Compartilhar, desde que tenha o entitlement `com.apple.developer.web-browser` e mostre uma página HTTP/HTTPS. O Opera pode ou não cumprir isso: **não confirmado** — se a opção não aparecer no Opera, abrir o ImobFlux no **Safari** e instalar por lá.
- **Confirmado:** o aviso depende do **app instalado**, não do navegador usado para instalá-lo.
- **Não confirmado:** se o app instalado a partir do Opera usa o mesmo mecanismo de push do Safari. O mais seguro é **instalar pelo Safari** e deixar o Opera de lado para essa finalidade.
- **Não verificado:** regras de outros países (a Apple mudou regras de navegadores na União Europeia; não se aplica ao Brasil até onde se sabe).

**Teste obrigatório antes de prometer qualquer coisa:** um iPhone real, iOS 16.4+, app instalado pelo Safari, aviso com o app fechado e tela bloqueada.

## 4. Desenho proposto para o ImobFlux (sem código ainda)

### 4.1 Tabela de assinaturas (com RLS)

`push_subscriptions`: `id`, `workspace_id`, `member_id` (quem), `endpoint` (único), `p256dh`, `auth`, `user_agent` (texto curto), `platform` (ios/android/desktop), `created_at`, `last_seen_at`, `last_error_at`, `disabled_at`.

- RLS: a pessoa **só lê, cria e apaga as próprias** assinaturas (`member_id = auth do membro`); ninguém vê as da outra pessoa. O envio usa a chave de serviço no servidor.
- Uma pessoa pode ter vários aparelhos (uma linha por aparelho). Assinatura que o serviço de push recusa (HTTP 404/410) é **desativada** automaticamente.
- Preferência de privacidade por pessoa (`push_preview`: só "Nova mensagem" ou com prévia).

### 4.2 Onde encaixar o envio sem atrasar o webhook

O webhook (`app/api/webhooks/whatsapp/route.ts`, `maxDuration = 60`) grava a mensagem e responde à Evolution — isso **não pode esperar** pelo push.

- **Opção A (recomendada para começar): `after()` do Next.** Já é usado no projeto para baixar mídia (`lib/conversations/media-download.ts`). Depois de gravar e responder, `after()` decide quem avisar e dispara os envios. Vantagem: simples, sem peça nova. Limite: é "melhor esforço" (sem repetição se falhar) e conta no tempo máximo da função e no consumo de CPU.
- **Opção B: fila no banco + cron.** O webhook só insere uma linha em `push_outbox`; um job (Vercel Cron a cada minuto ou função do Supabase) envia. Mais robusto e com repetição, porém com até ~1 minuto de atraso no plano que só permite cron por minuto.
- **Opção C: Database Webhook / Edge Function do Supabase** disparada pela inserção em `messages`. Totalmente fora do caminho do webhook, mas é mais uma peça para operar e monitorar.

Recomendação: **A**, com `push_outbox` preparada se um dia precisar de repetição.

### 4.3 Quem recebe

Reaproveitar **as mesmas regras do avisador atual** (`lib/notifications/model.ts`: só mensagem de cliente, não a da própria equipe, não histórico, conversa visível à pessoa, prazo pausado avisa, prazo desativado só com a opção ligada, conversa do número com ele mesmo não avisa). Hoje essa regra roda no navegador; no servidor precisa de uma versão equivalente (SQL ou TypeScript) para **decidir por pessoa** — exige cuidado com a privacidade de grupos e contatos protegidos (mesma matriz de permissões).

### 4.4 Limites e custos

- Limites da Vercel: a duração máxima da função é configurável (o webhook já usa 60 s). Fontes secundárias dizem 300 s padrão em 2026 — **conferir na página oficial de limites** antes de depender disso. Cada push é uma chamada HTTP curta; com poucas pessoas por conta, o volume é pequeno.
- Biblioteca: pacote npm `web-push` (padrão de mercado) ou chamadas diretas com Web Crypto. Sem custo.
- Serviços de push (Google/Apple/Mozilla): **gratuitos**.
- Custo extra no Vercel/Supabase: desprezível no volume atual (mais algumas invocações e uma tabela pequena).
- Alternativas pagas (OneSignal etc.): evitam o servidor próprio, mas colocam dados de clientes em terceiros — **não recomendado** pela privacidade.

### 4.5 Privacidade

- O push passa por Google/Apple/Mozilla (o conteúdo vai **criptografado de ponta a ponta** até o aparelho, mas o serviço enxerga que houve um aviso).
- Padrão recomendado: **sem prévia** — "Nova mensagem" + nome do contato, sem o texto. Prévia do texto como opção por pessoa, desligada por padrão (o texto de cliente apareceria na tela bloqueada).
- Nunca enviar texto de mensagem em log do servidor.

### 4.6 Segredos

- Um par de chaves **VAPID** (pública e privada) gerado **uma vez** com o comando do pacote `web-push` (`web-push generate-vapid-keys`).
- **Quem gera:** o Mário, no próprio computador, ou eu por comando local **sem exibir a chave privada no chat**.
- A privada vai como variável de ambiente **só no servidor** da Vercel (nome sugerido `VAPID_PRIVATE_KEY`), a pública como `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, e um contato `VAPID_SUBJECT` (`mailto:`). **Nunca no chat, nunca no repositório.**
- Trocar a chave privada invalida todas as assinaturas existentes (as pessoas precisam reativar).

## 5. Alternativa: o WhatsApp do próprio celular já avisa

O número ligado ao ImobFlux está no WhatsApp de um celular, e esse celular **já notifica** cada mensagem (som, tela bloqueada, relógio) sem nenhum trabalho. Para o dono que tem esse celular no bolso, o aviso do ImobFlux **quase não acrescenta nada**.

O aviso do ImobFlux faz diferença quando:
1. **A equipe não tem o celular do número** (atendentes usam só o ImobFlux).
2. Há **mais de uma pessoa** e é preciso saber **quem deve responder** (aviso só para o responsável).
3. Quer-se avisar por **prazo estourando** ou conversa **atribuída** (algo que o WhatsApp não sabe).
4. O celular do número fica no **escritório** e o corretor está na rua.

Se o uso for só o dono com o próprio celular, **não vale o custo agora**.

## 6. Esforço estimado

| Etapa | Estimativa |
|---|---|
| Migration (`push_subscriptions` + RLS + pgTAP + rollback) | 0,5 dia |
| Service worker com `push`, assinatura, botão "Ativar avisos neste aparelho" (por gesto) | 1 dia |
| Envio pelo servidor (`after()`), regras de quem recebe, limpeza de assinaturas inválidas | 1–1,5 dia |
| Preferências (prévia sim/não, listar e remover aparelhos) | 0,5 dia |
| Testes (unitários, navegador com o push simulado) e documentação | 1 dia |
| **Teste em iPhone e Android reais** (com o Mário) | 0,5 dia |
| **Total** | **~4,5–5 dias de trabalho** |

Risco principal: o comportamento no iPhone **só se confirma no aparelho real** e pode ter surpresas por versão do iOS e por navegador. Risco secundário: aviso duplicado (aba aberta + push) — resolver não mostrando o push se a aba do ImobFlux está em primeiro plano.

## 7. Passo a passo do que o Mário precisa fazer

1. Decidir as perguntas da seção 8.
2. Ter um **iPhone com iOS 16.4 ou mais novo** e um Android para o teste final.
3. Autorizar a **Trava A** (migration da tabela de assinaturas em produção).
4. Gerar as chaves VAPID (comando local) e **cadastrar as variáveis na Vercel** (Settings → Environment Variables) — sem colar no chat.
5. Autorizar a **Trava B** (publicação do app).
6. No iPhone: abrir o ImobFlux **no Safari**, Compartilhar → Adicionar à Tela de Início, abrir pelo ícone, ir em Preferências → "Ativar avisos neste aparelho" e aceitar. Depois fechar o app e mandar uma mensagem de outro número.

## 8. Recomendação e decisões

**Recomendação:** implementar **em duas fases**. Fase 1 (Android + computador + base para iPhone) e Fase 2 (iPhone instalado), porque a Fase 1 já entrega valor e o iPhone depende de teste real. Só começar se a equipe **não** usar o celular do número (seção 5); se o dono usa o próprio celular, **adiar**.

Decisões que só o Mário toma:
1. **Vale o esforço?** A equipe atende sem o celular do número?
2. **Prévia do texto** na notificação: desligada (recomendado) ou ligada?
3. **Quem recebe:** todos, ou só o responsável pela conversa (e o dono quando não há responsável)?
4. **iPhone:** instalar o app pelo Safari para todos os atendentes é aceitável?
5. **Horário:** avisar a qualquer hora ou respeitar um horário de silêncio?
6. Pode usar a opção A (`after()`) e aceitar que, se o envio falhar, não há repetição na primeira versão?

## Fontes

- [WebKit — Web Push for Web Apps on iOS and iPadOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/) (primária; requisitos do iOS, permissão por gesto, APNs, Foco, navegadores de terceiros)
- Fontes secundárias sobre limites de duração/`waitUntil` na Vercel: conferir [a página oficial de limites da Vercel](https://vercel.com/docs/functions/limitations) antes de decidir.
