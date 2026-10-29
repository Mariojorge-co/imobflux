# Relatório — Ajustes 6 (teclado no iPhone, cabeçalho da conversa, menu ☰, imagens em branco, app instalável, estudo de Web Push) — branch local `fix/ajustes-6`

> Estado: **pronto e testado localmente; NADA publicado.** Parte da `main` (`b7b9ad5`). **Não há migration** (nada de Trava A): só a
> **Trava B** (app) quando houver "autorizo". Não mexi em Hoje, Prioridades, Evolution, webhook, fila de envio, SLA nem permissões.
>
> **Aviso importante sobre os testes:** o ambiente não tem iPhone nem o WebKit do Playwright instalado (nenhum navegador do
> Playwright foi baixado; os testes usam o Chrome do computador). Os testes usam **Chrome com tela de 360/390/430 px e toque**, e o
> teclado do iOS é **simulado** trocando o `window.visualViewport` (é exatamente o que o iOS muda). Cada item abaixo diz o que
> **só um iPhone real confirma**.

## A. Teclado no iPhone: espaço vazio e conversa que some

**Causa.** O iOS (diferente do Android/Chrome) **não redimensiona o layout** quando o teclado abre: só a *área visível*
(`visualViewport`) encolhe e o iOS rola a página para mostrar o campo. A moldura da conversa tinha altura fixa `100dvh − barra`
(o `dvh` do iOS **não** encolhe com o teclado; o `interactive-widget=resizes-content` do viewport também **não é suportado** no iOS).
Resultado: a moldura continuava com a altura da tela inteira, o iOS empurrava a página, e a caixa de mensagem ficava num ponto
que não era o topo do teclado (o espaço vazio) enquanto a lista, espremida, quase desaparecia.

**Evidência.** No Chrome o layout encolhe sozinho e o problema não existe; reproduzi o mecanismo do iOS simulando a área visível
(`visualViewport.height = 500` com o layout em 844): antes a moldura seguia com 780 px e a caixa ficava fora da área visível.

**Correção.**
- `lib/ui/keyboard-viewport.ts`: calcula "teclado aberto" = campo de texto em foco **e** área visível ≥ 120 px menor que o layout.
  No Android (layout que já encolhe) a diferença é ~0: **nada é reservado duas vezes**. Zoom de pinça (`scale > 1`) não conta.
- `ConversationsViewportFrame`: com o teclado aberto a moldura fica **fixa na área visível** (altura e deslocamento do
  `visualViewport`); a caixa fica colada no teclado; a lista rola dentro do que sobra e **mantém a última mensagem à vista**
  se já estava no fim. Fechando o teclado, volta tudo ao normal.
- Faixa de abas ("Mensagem / Nota interna / Respostas rápidas / expandir") **compacta** (32 px em vez de 44) enquanto o teclado
  estiver aberto. Celular **deitado** com o teclado (área < 360 px): o cabeçalho da conversa se esconde para a caixa caber.
- Observação: achei no teste que, com 190 px de área visível (paisagem), a caixa ficava cortada — é por isso que o cabeçalho se esconde.

**Testes** (`tests/ajustes-6.spec.ts`, `tests/ajustes-6.unit.spec.ts`): abrir/fechar teclado, deslocamento do iOS, paisagem,
layout que encolhe (Android) sem duplicar, zoom de pinça, última mensagem visível, abas compactas; 5 unitários do cálculo.

**Só o iPhone real confirma:** o comportamento do teclado com a barra de sugestões do iOS, a animação de subida, e o salto
do `visualViewport` em cada versão do iOS (principalmente iOS 15–17 no Opera).

## B. Cabeçalho da conversa bagunçado no celular

**Causa.** O cabeçalho tinha tudo na mesma fila com quebra de linha: nome, prazo, "Atribuir a…", "+ Oportunidade", lupa, ícones e
"i". Com a regra de 16 px dos campos (Ajustes 5) o seletor "Atribuir a…" ficou maior e **colidiu** com os botões vizinhos.

**Correção.** Até **767 px** o cabeçalho é **uma linha**: voltar, nome/telefone (com corte "…", sem quebrar), prazo **compacto**, lupa e ⋯.
Todo o resto vai para a folha ⋯ (cada item com 48 px de altura; o seletor com 44 px): **Informações do cliente**, **Responsáveis**
("Atribuir a…" como lista, remover e passar para outro, 44 px), **Etapa/Criar oportunidade**, **Prazo** (ativo/pausar/desativar),
marcar como lida, fixar, arquivar, grupo e mensagens escondidas. No **computador (≥ 768 px)** nada mudou.
O breakpoint das ações do cabeçalho passou de 640 px (`sm`) para 768 px (`md`) para casar com a regra "até 767 px".

**Testes:** sem sobreposição (caixas dos elementos), sem elemento fora da tela, sem rolagem lateral e telefone inteiro em **360, 390, 430 e 768 px**; no
celular só existem voltar/lupa/⋯; folha com 44 px, atribuir/remover, pausar prazo, informações (foco volta ao ⋯), criar
oportunidade; no computador o cabeçalho continua como era.

## C. Menu ☰ não fecha ao tocar fora + auditoria de todas as sobreposições

**Causa.** O menu principal (☰) não tinha fundo nem tratamento de toque fora: só o botão e o Esc. (As folhas ⋯ e o menu da mensagem
já tinham sido corrigidos nos Ajustes 5.)

**Correção.** Fundo escuro (`nav-backdrop`, um botão — funciona no iOS); tocar nele, Esc ou escolher uma tela **fecha** e o **foco
volta ao ☰**. A ajuda de atalhos aberta pelo ☰ também devolve o foco ao ☰.

### Auditoria (fecha tocando fora / Esc / devolve o foco)

| Sobreposição | Toque fora | Esc | Foco volta | Situação |
|---|---|---|---|---|
| Menu ☰ | fundo escuro | sim | ao ☰ | **corrigido agora** |
| Folha ⋯ da conversa, folhas dos itens (BottomSheet) | fundo / arrastar a alça | sim | ao botão | ok (Ajustes 5) |
| Menus de bolha/ViewportMenu (prazo, contatos, Kanban, respostas) | `pointerdown` | sim | ao botão | ok (Ajustes 5) |
| Painel de informações do cliente e outras gavetas (Drawer) | fundo (botão) | sim | ao botão que abriu | foco **corrigido** (no iOS o botão tocado não recebe foco: usa o último botão tocado) |
| Painel de respostas rápidas | fundo (botão) | sim | ao botão | foco **corrigido** (mesma causa) |
| Diálogos (ModalDialog: busca global, ajuda de atalhos, criar oportunidade, tarefas, etc.) | clique no fundo | sim (`<dialog>`) | ao botão | foco **corrigido** (mesma causa) |
| Diálogo "Adicionar funcionário" (`<dialog>` próprio) | **não fechava** → fecha | sim | nativo | **corrigido** |
| Ampliação de foto/vídeo (lightbox) | clique no fundo | sim | nativo | ok |
| Painel de emoji (computador) | `pointerdown` | sim | ao botão | foco ao tocar fora **corrigido** |
| Mensagens: menu e seleção de bolha | `pointerdown` | sim | ao botão | ok (Ajustes 5) |

Testes: `C: menu ☰`, `C: auditoria — celular` (folha ⋯, respostas rápidas, busca global, ajuda de atalhos, painel de informações) e
`C: auditoria no computador` (prazo, emoji, diálogo da equipe). O que não está no teste de 390 por não existir lá (emoji e menu de
prazo são só do computador) foi testado a 1280 px.

**Só o iPhone real confirma:** o toque fora em cada um (o Chrome com toque emulado se comporta como o iOS no `pointerdown`, mas
não garante o comportamento do iOS com `<dialog>` nativo).

## D. Imagens e vídeos em branco no iPhone

| Hipótese | Resultado |
|---|---|
| **Miniatura de imagem que carrega antes da hidratação ficava no quadrado vazio** | **CAUSA CONFIRMADA.** A imagem só fica visível depois do `onLoad`; se o arquivo termina de carregar **antes** de o React hidratar (rede boa, imagem pequena), o `onLoad` nunca chega e a miniatura fica no quadrado cinza pulsante com `opacity-0` para sempre. Reproduzido: atrasando os scripts, o código antigo deixa a classe `opacity-0` (teste falha); o novo confere `img.complete` ao anexar o elemento e fica visível. |
| Vídeo: caixa cinza com ▶ | **Causa provável (padrão do iOS), não confirmável sem iPhone:** o Safari com `preload="metadata"` **não pinta o primeiro quadro**. Correção aplicada: `#t=0.001` no endereço do vídeo (o iOS então pinta o quadro) mantendo `muted`, `playsinline`, `preload="metadata"`. |
| Carregamento preguiçoso (`lazy`) | Descartado como causa principal: o `lazy` não impede carregar imagens visíveis; permanece. |
| Rota de anexos / Range / Content-Type / CORS | **Verificado**: devolve `206` com `Content-Range` e `Accept-Ranges: bytes` (o iOS exige Range para vídeo) e o `Content-Type` certo (teste novo). CORS não se aplica (mesma origem). |
| URL assinada expirada | Descartado: a URL assinada (60 s) é gerada **dentro da rota** a cada pedido; o navegador nunca a vê. |
| `Cache-Control: private, no-store` na rota | **Suspeita não confirmada** (há relatos de o iOS ser exigente com `no-store` em mídia). **Não alterei**, porque o motivo do `no-store` é segurança (revogar acesso) e eu não consigo provar o ganho sem iPhone. Fica como primeira coisa a testar se o vídeo continuar cinza depois de `#t=0.001`. |
| Formato (HEIC, MOV/H.265, WebP) | O iPhone toca MOV/H.265 e HEIC é convertido pelo WhatsApp em JPEG; WebP é suportado no iOS 14+. Sem ação. |

**Placeholder claro:** quando a mídia falha, o cartão mostra "Não foi possível exibir o arquivo aqui" com **Tentar de novo**
(recarrega a mídia com outra tentativa) e "Tentar abrir diretamente".

**Só o iPhone real confirma:** se o `#t=0.001` pinta o quadro no Safari/Opera e se alguma imagem específica (HEIC "como documento") ainda falha.

## E. iPhone: aviso honesto e app instalável (PWA)

1. **Texto verdadeiro** em Preferências (detecta iOS): no iPhone a página aberta no navegador (Safari/Opera) **não** recebe aviso do
   sistema **nem** toca som em segundo plano; só o app instalado pode receber avisos e isso exige Web Push com servidor (ainda
   não existe); hoje só funcionam título e som com a página aberta e em primeiro plano. O guia por aparelho e o resumo foram
   reescritos sem prometer avisos.
2. **Instalável:** `app/manifest.ts` (nome, `display: standalone`, `start_url: /conversas`, cores), ícones **192, 512 e maskable 512**
   (`public/icons/`), `apple-touch-icon` (`app/apple-icon.png`), meta do iOS (`apple-mobile-web-app-capable`, título, barra de status),
   `theme-color` claro/escuro, `viewport-fit=cover` (o zoom de acessibilidade continua ligado). Instrução em Preferências:
   **"Como instalar no iPhone"** (Compartilhar → Adicionar à Tela de Início), avisando que **instalar não liga os avisos** e que, se o Opera
   não oferecer a opção, é para usar o Safari.
3. **Service worker** `/sw-avisos.js`: não tem `fetch` nem cache (teste novo): **não interfere** com a instalação nem guarda páginas.
   O `proxy` deixou de interceptar `/manifest.webmanifest` (é público).
4. **Áreas seguras:** barra superior, laterais e caixa de mensagem usam `env(safe-area-inset-*)`. Barra de status "normal" no iOS
   (conteúdo não passa por baixo dela), então o topo costuma ser 0; a base e as laterais (paisagem) são as que importam.
5. Ícones: desenhei um balão de conversa branco com três linhas sobre o azul-marinho da marca. **Se o Mário preferir outra
   identidade visual, é só trocar os 4 PNGs** (192, 512, maskable 512 e `app/apple-icon.png` 180).

**Só o iPhone real confirma:** instalar pelo Opera x Safari, o ícone, a abertura em tela cheia, as áreas seguras e o comportamento do teclado no app instalado.

## F. Estudo de Web Push

Documento: [ESTUDO_WEB_PUSH.md](ESTUDO_WEB_PUSH.md) (nenhum código). Resumo: viável; no iPhone **só** com o app instalado (iOS 16.4+),
permissão por toque; recomendação em duas fases e só se a equipe **não** tiver o celular do número; esforço ~5 dias; decisões listadas no fim.

## Decisões registradas (padrão mais seguro)

- Cabeçalho do celular: prazo **compacto** (tempo) em vez de sumir, para o telefone caber.
- Teclado: cabeçalho some só em paisagem com teclado; abas a 32 px só com teclado aberto.
- Instalar o app **não** promete aviso.
- `Cache-Control: no-store` dos anexos mantido (segurança) até haver prova no aparelho.

## Verificação

(preenchida ao terminar a rodada de regressão; ver abaixo)

## Mini reteste no iPhone (5 minutos)

1. **Teclado:** abra uma conversa, toque na caixa de mensagem. A caixa deve ficar **colada** no teclado, sem faixa vazia, e a
   última mensagem visível. Feche o teclado: volta ao normal. Gire o aparelho.
2. **Cabeçalho:** a conversa mostra só ← nome/telefone, 🔍 e ⋮. Toque em ⋮: estão lá Informações, Responsáveis (Atribuir a…),
   Criar oportunidade, Prazo, Marcar como lida, Fixar, Arquivar.
3. **Menu ☰:** toque no fundo escuro: fecha.
4. **Imagens/vídeos:** abra uma conversa com foto e vídeo recebidos: a foto aparece; o vídeo mostra o primeiro quadro. Se algo falhar, aparece "Tentar de novo".
5. **Preferências:** o painel diz a verdade sobre o iPhone; "Como instalar no iPhone" está visível.
6. **Instalar:** (pelo Safari) Compartilhar → Adicionar à Tela de Início; abra pelo ícone: tela cheia, sem barras; teste o teclado de novo lá.
