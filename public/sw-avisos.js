// Service worker mínimo do ImobFlux: existe SÓ para exibir o aviso local de mensagem nova (Android/Chrome exige isso) e abrir a
// conversa ao tocar. Não guarda cache, não intercepta requisições e não usa Web Push (aba/app fechado ainda não avisa).
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = (event.notification.data && event.notification.data.path) || "/conversas";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const open = clients[0];
      if (open) {
        return open.focus().then(() => open.postMessage({ type: "imobflux:open-conversation", path }));
      }
      return self.clients.openWindow(path);
    }),
  );
});
