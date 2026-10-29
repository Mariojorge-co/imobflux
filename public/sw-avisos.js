// Service worker do ImobFlux: (1) exibe o aviso local de mensagem nova (Android/Chrome exige o worker) e (2) trata o Web Push do servidor
// (aviso com o app fechado). Abre ou foca a conversa certa ao tocar. NÃO guarda cache e NÃO intercepta requisições (sem `fetch`).
//
// Regras do push:
//  - Sempre mostra UMA notificação por push (o iOS revoga a assinatura de quem recebe push e não mostra nada: promessa "userVisibleOnly").
//  - Título "Nova mensagem de {nome}", SEM prévia: o servidor nunca manda o texto da mensagem.
//  - A etiqueta (tag) é a da conversa, a mesma do aviso local: um aviso substitui o outro em vez de empilhar. Se já havia um aviso da mesma
//    conversa há poucos segundos (o local, com a aba aberta), a troca é silenciosa para não tocar duas vezes.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

const RECENT_MS = 6000;
const ICON = "/icons/icon-192.png";

function safePath(value) {
  // Só caminhos do próprio app (começam com uma barra, mas não com duas).
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") ? value : "/conversas";
}

function readPayload(event) {
  try {
    return event.data ? event.data.json() : {};
  } catch {
    return {};
  }
}

self.addEventListener("push", (event) => {
  const data = readPayload(event);
  const title = typeof data.title === "string" && data.title.trim() ? data.title.slice(0, 120) : "Nova mensagem";
  const tag = typeof data.tag === "string" && data.tag ? data.tag.slice(0, 80) : "imobflux-aviso";
  const body = typeof data.body === "string" ? data.body.slice(0, 160) : "";
  event.waitUntil(
    self.registration
      .getNotifications({ tag })
      .then((existing) => existing.some((item) => Date.now() - item.timestamp < RECENT_MS))
      .catch(() => false)
      .then((recent) =>
        self.registration.showNotification(title, {
          body,
          tag,
          renotify: !recent,
          icon: ICON,
          badge: ICON,
          data: { path: safePath(data.path) },
        }),
      ),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = safePath(event.notification.data && event.notification.data.path);
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const open = clients.find((client) => client.visibilityState === "visible") || clients[0];
      if (open) {
        // focar pode ser recusado em alguns aparelhos: abrir a conversa não depende disso
        return open
          .focus()
          .catch(() => undefined)
          .then(() => open.postMessage({ type: "imobflux:open-conversation", path }));
      }
      return self.clients.openWindow(path);
    }),
  );
});
