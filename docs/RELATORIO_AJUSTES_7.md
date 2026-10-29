# Relatório — Ajustes 7 (iPhone: zoom nos campos e faixa de baixo no app instalado) — branch local `fix/ajustes-7`

> Estado: **pronto e testado localmente; NADA publicado.** Parte da `main` (`d8215fe`). **Não há migration** (nada de Trava A): só a
> **Trava B** (app) quando houver "autorizo". Não mexi em Evolution, webhook, banco de produção, variáveis da Vercel, fila de envio, SLA nem permissões.
>
> **Aviso importante:** não há iPhone nem WebKit do Playwright neste ambiente; os testes usam **Chrome com tela de 360/390/430 px e
> toque**. O Chrome **não emula o modo "app instalado" (standalone)** nem a barra de início do iPhone. Por isso este pacote traz,
> além das correções, o **diagnóstico de tela** (item C) para você me mandar os números reais do aparelho. Duas das causas abaixo
> são **hipóteses**, e digo claramente quais.

## A. Zoom ao tocar na caixa de mensagem (app instalado)

### O que a auditoria mostrou (evidência)

- Auditei **todos os campos visíveis** (input, textarea, select, contenteditable; exceto checkbox/rádio/arquivo/cor/botões) em
  **360, 390 e 430 px**, com toque, em: login, lista de conversas, conversa (mensagem, nota interna, busca na conversa, painel de
  respostas rápidas, folha ⋯, busca global), contatos, Kanban, tarefas, Hoje, Prioridades, Preferências, respostas rápidas, equipe,
  prazos, grupos, WhatsApp, auditoria e exportação (`tests/ajustes-7.spec.ts`, ajudante `tests/helpers/field-audit.ts`).
  **Resultado com o código atual: nenhum campo abaixo de 16 px computados** nos três tamanhos. Também conferi **a produção**
  (`/login` em 390 px): todos os campos com 16 px e `text-size-adjust: 100%`.
- A regra de CSS dos Ajustes 5 **está na produção** (conferi o arquivo de CSS publicado), fora de qualquer `@layer`, e vence as
  classes do Tailwind (`text-body` = 14 px) no Chrome.
- Não há `!important`, `style="font-size"` nem outra regra que reduza a fonte de campos no código (busquei).

### Causa

**Não consegui reproduzir no Chrome: a causa exata no iPhone NÃO está confirmada.** O que o seu teste mostra (sem zoom quando o
"Tamanho do texto" do Safari é aumentado; zoom no tamanho normal) indica que o tamanho **efetivo** na caixa fica **abaixo de 16 px no
iOS**, mesmo com o CSS pedindo 16 px. Hipóteses, da mais para a menos provável:

1. A regra de 16 px **perde para outra regra no iOS** que eu não enxergo no Chrome (ou é descartada por um detalhe do WebKit do
   seu iOS, ex.: lista de seletores dentro de `:not()` ou a combinação de media queries). Por isso a regra nova **não depende de nada
   disso**: ver correção.
2. O iOS aplicando seu **ajuste automático de tamanho do texto** (`-webkit-text-size-adjust`) sobre a caixa.
3. Folha de estilo antiga em cache no app instalado (menos provável: os arquivos têm nome com hash).

O **diagnóstico de tela (item C)** mostra o tamanho computado de um campo igual à caixa de mensagem **no seu iPhone** — com isso
a causa deixa de ser hipótese.

### Correção (pela causa, em camadas)

1. **CSS** (`app/globals.css`): `font-size: 16px !important` com seletor `html input… / html textarea / html select / html [contenteditable]`
   (especificidade maior que qualquer classe de componente, vence estilo inline e regra de ID), válido **por largura
   (`max-width: 767px`) e por aparelho de toque (`(hover: none) and (pointer: coarse)` e `(pointer: coarse)`)**, e `-webkit-text-size-adjust: 100%`
   fixo no `html`. Não usa `maximum-scale` nem `user-scalable=no`: o zoom de acessibilidade continua funcionando (teste).
2. **Guarda no foco/toque** (`FieldFontGuard`, `lib/ui/field-font-guard.ts`): se, mesmo assim, o tamanho computado de um campo de
   texto estiver abaixo de 16 px quando a pessoa o toca (por exemplo, por uma regra mais específica com `!important`), o campo é
   corrigido na hora — **antes** de o iOS decidir dar zoom. A guarda conta quantas correções fez (aparece no diagnóstico).
3. No computador com mouse nada muda: os campos compactos continuam compactos (teste).

### Testes (`tests/ajustes-7.spec.ts`)

- Auditoria de todos os campos nas telas acima em 360/390/430: nenhum < 16 px (passa também com o código antigo — é a prova de que
  no Chrome o antigo já cumpria).
- **Teste que FALHA com o código atual e passa com o novo:** campos com estilo hostil (ID `font-size: 11px`, classe com `!important`, inline
  12 px, caixa de mensagem com 13 px inline, e uma regra de especificidade maior com `!important`) continuam com 16 px em 360/390/430
  (rodei contra o código antigo: **falhou**; com o novo: **passa**).
- Tablet de 1024 px com toque também é coberto; computador com mouse continua compacto; o viewport não tem `maximum-scale`/`user-scalable`.

**Só o iPhone real confirma:** que o zoom parou. Se ainda der zoom, o diagnóstico dirá o tamanho que o iOS enxerga.

## B. Faixa escura de ~33 px abaixo da caixa (app instalado)

### Investigação

- `viewport-fit=cover` já estava ativo (Ajustes 6). A moldura da conversa tinha **`height: calc(100dvh − barra)`** e a raiz do app
  **`min-h-screen`**. No iPhone instalado, `100dvh`/`100vh` **não é garantido** igual à área até a borda de baixo (que inclui a
  barra de início, ~34 px): se a moldura termina antes, aparece o **fundo da página** (a cor do `body`, mais escura que a caixa
  de mensagem, que usa a cor de "superfície"). O valor da faixa (~33 px) é o de `safe-area-inset-bottom` de um iPhone com barra de início.
- O padding de safe-area da base **já estava dentro da caixa** (`.composer-safe`, com a cor da caixa), então a faixa vinha de a
  moldura **não chegar** à borda.
- Fundos: `body` já usava o fundo do app; `html` não tinha fundo próprio. Rolagem elástica: não havia `overscroll-behavior`.

**Causa (provável, não confirmável no Chrome):** altura calculada por `dvh` menor que a tela no app instalado + página que pode ser
puxada (rolagem elástica) mostrando o fundo.

### Correção

- **Raiz do app fixa na tela inteira** na conversa, no celular/tablet (`position: fixed; inset: 0` em `[data-app-root]`, só quando a tela da
  conversa está aberta e até `lg`) e a moldura ocupa o que sobra abaixo da barra superior (`h-full`): não depende de `dvh`. Com
  `viewport-fit=cover` a borda de baixo é a da tela, e a caixa de mensagem pinta a área da barra de início **dentro dela**
  (`padding-bottom: max(…, env(safe-area-inset-bottom))`, na cor da caixa). No computador (≥ lg) segue a conta com `dvh` ao lado da barra lateral.
  **Aprendizado:** a 1ª versão fixava só a moldura; isso criou um contexto de empilhamento e a barra superior passou a ficar **por cima** do fundo dos painéis
  (o painel de respostas rápidas não fechava ao tocar na faixa de cima — a auditoria do Ajustes 6 pegou). Fixar a **raiz** mantém a barra e os painéis no mesmo contexto, como antes.
- `html` e `body` com o **fundo do app** (claro/escuro) e **`overscroll-behavior: none`**; na conversa, **até 1023 px**, `html` fica `overflow: hidden`
  (a página não rola; só a lista de mensagens, a lista de conversas e os painéis rolam por dentro). **Aprendizado:** a 1ª versão aplicava isso
  também no computador e a regressão pegou dois testes antigos quebrando no desktop (`atalhos` Alt+seta e `send-files` vídeo curto); a regra ficou só
  até `lg`, o mesmo limite da moldura fixa, e os dois voltaram a passar.
- Raiz do app `min-h-dvh` em vez de `min-h-screen`.

### Testes (Chrome, 390 × 844, claro e escuro)

`scrollHeight` do documento == altura da janela; fundo da moldura e da caixa de mensagem terminam **exatamente** na borda de baixo;
fundo de `html` e `body` == cor do app; `overscroll-behavior: none`; a página não rola (`scrollTo` não move); a lista de mensagens **continua
rolando por dentro**; lista de conversas sem sobra; regra da área de segurança dentro da caixa.

**Só o iPhone real confirma** (o Chrome não emula standalone): que a faixa sumiu, que a barra de início fica com a cor da caixa e a
rolagem elástica. O diagnóstico mostra `scrollHeight/clientHeight`, `innerHeight`, `visualViewport`, `screen` e as áreas seguras medidas.

## C. Diagnóstico de tela (TEMPORÁRIO)

Preferências → seção **"Diagnóstico de tela"** (recolhida; marcada como **temporária** no código e aqui): janela (innerWidth/innerHeight),
`visualViewport` (largura, altura, zoom, offsetTop), `screen`, `devicePixelRatio`, `navigator.standalone` e `display-mode: standalone`,
áreas seguras `env(safe-area-inset-*)` medidas por um elemento de prova, tamanho da fonte de um campo **igual à caixa de mensagem** e de
um **igual à busca** (e o da caixa/busca reais, quando estão na tela), quantas correções a guarda de 16 px fez, se as regras de largura/toque/sem hover
casam, `text-size-adjust`, `scrollHeight/clientHeight` do documento e do corpo, fundo de `html` e `body`, `overscroll-behavior`, tema e user agent.
Botão **Copiar** (com alternativa quando a área de transferência é recusada) e **Atualizar**. **Nada é enviado a servidor** (teste confere que
nenhuma requisição sai ao copiar) e **não há dados de clientes**. Para remover depois: apagar `components/notifications/screen-diagnostics.tsx`
e a seção em `app/(app)/preferencias/page.tsx`.

## Decisões registradas (padrão mais seguro)

- A regra de 16 px usa `!important` só em campos de texto no celular/toque (antes era sem `!important`); no computador com mouse nada muda.
- A moldura da conversa fica fixa só até `lg`; no desktop mantém o cálculo antigo.
- A causa do zoom **não** foi dada como confirmada: o relatório diz isso e o diagnóstico fecha a dúvida.

## Verificação

(preenchida ao terminar a rodada de regressão)

## Mini reteste no iPhone (app instalado, tamanho de texto normal)

1. Abra **Preferências → Diagnóstico de tela**, toque em **Copiar** e me mande o texto (sem dados de clientes). Confira se "Fonte de um campo como a caixa de mensagem" mostra **16px**.
2. Abra uma conversa e toque na caixa de mensagem: **não deve dar zoom**. Repita na busca da conversa, na busca global e no "Atribuir a…".
3. Olhe a base da conversa: **sem faixa escura** abaixo da caixa; a área da barra de início está com a cor da caixa.
4. Puxe a tela para cima/baixo fora das listas: a página **não balança**; as mensagens rolam normalmente.
5. Gire o aparelho e abra o teclado: a caixa continua colada no teclado.
