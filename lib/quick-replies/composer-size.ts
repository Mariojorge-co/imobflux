// Altura da caixa de mensagem: cresce com o texto até ~40% da tela (rolagem interna depois); "expandir" leva a ~60%.

export const COMPOSER_MAX_RATIO = 0.4;
export const COMPOSER_EXPANDED_RATIO = 0.6;
export const COMPOSER_MIN_HEIGHT_PX = 44;

export function composerMaxHeight(viewportHeight: number, expanded: boolean): number {
  const ratio = expanded ? COMPOSER_EXPANDED_RATIO : COMPOSER_MAX_RATIO;
  return Math.max(COMPOSER_MIN_HEIGHT_PX, Math.round(viewportHeight * ratio));
}

export type ComposerHeight = { height: number; scrolls: boolean };

/** Altura da caixa para o conteúdo atual. Expandida, ocupa a altura máxima; fechada, só o que o texto precisa. */
export function composerHeight(contentHeight: number, viewportHeight: number, expanded: boolean): ComposerHeight {
  const max = composerMaxHeight(viewportHeight, expanded);
  const wanted = expanded ? max : Math.max(COMPOSER_MIN_HEIGHT_PX, contentHeight);
  const height = Math.min(wanted, max);
  return { height, scrolls: contentHeight > height };
}
