if (!process.argv.includes("--allow-live-sources")) {
  throw new Error("[P0] Canario externo desactivado. Requiere autorización explícita y --allow-live-sources; no forma parte de test:unit ni test:integration.");
}

export {};
