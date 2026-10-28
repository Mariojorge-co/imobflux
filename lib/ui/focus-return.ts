// Para onde o foco volta quando uma folha/menu fecha. Em telas de toque o botão tocado muitas vezes NÃO recebe foco (iOS), então
// `document.activeElement` seria o <body>; por isso guardamos o último botão/link tocado, antes de qualquer folha abrir.

let lastTrigger: HTMLElement | null = null;
let installed = false;

function install() {
  if (installed || typeof document === "undefined") return;
  installed = true;
  document.addEventListener(
    "pointerdown",
    (event) => {
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>("button, a[href], [role='button']") : null;
      // Itens de dentro de uma folha ou menu não contam: o foco volta a quem ABRIU.
      if (target && !target.closest("[data-bottom-sheet], [role='menu'], [data-floating-menu]")) lastTrigger = target;
    },
    true,
  );
}

install();

/** O elemento para onde devolver o foco: o que tinha foco ao abrir ou, se era o <body>, o último botão tocado. */
export function captureFocusTarget(): HTMLElement | null {
  install();
  const active = document.activeElement as HTMLElement | null;
  if (active && active !== document.body) return active;
  return lastTrigger && lastTrigger.isConnected ? lastTrigger : null;
}
