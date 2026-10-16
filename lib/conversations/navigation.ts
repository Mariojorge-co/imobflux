// Navegação lista → conversa no celular. Ao abrir uma conversa a partir da lista, guardamos que o "voltar" da tela deve
// usar o histórico do navegador (assim o voltar do aparelho e o botão da tela fazem a mesma coisa e a lista não vira uma
// entrada nova do histórico). Sem essa marca (abriu por link direto/notificação), o botão leva à lista por URL.

const KEY = "imobflux:conv-opened-from-list";

export function markOpenedFromList(): void {
  try {
    window.sessionStorage.setItem(KEY, "1");
  } catch {
    // sem armazenamento: o botão voltar usa a URL da lista
  }
}

/** Lê e apaga a marca. */
export function consumeOpenedFromList(): boolean {
  try {
    const value = window.sessionStorage.getItem(KEY);
    window.sessionStorage.removeItem(KEY);
    return value === "1";
  } catch {
    return false;
  }
}

/** Posição de rolagem da lista, guardada enquanto a lista fica escondida (celular: a conversa ocupa a tela toda). */
let savedListScroll = 0;
export function saveListScroll(value: number): void {
  savedListScroll = value;
}
export function getSavedListScroll(): number {
  return savedListScroll;
}
