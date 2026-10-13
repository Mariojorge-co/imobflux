// Neutraliza o marcador 'server-only' para os módulos de servidor rodarem nos testes em Node.
// Importe este arquivo ANTES de qualquer módulo de `lib/` (import de efeito colateral, primeira linha).
try {
  const serverOnlyPath = require.resolve("server-only");
  require.cache[serverOnlyPath] = {
    id: serverOnlyPath,
    filename: serverOnlyPath,
    loaded: true,
    exports: { __esModule: true },
  } as never;
} catch {
  // Pacote ausente: nada a neutralizar.
}

export {};
