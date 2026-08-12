// Prueba la lógica de filtrado de scripts/sync-model-catalog.ts (Fase 12,
// docs/CV-GENERATION-PLAN.md §6.5.1) contra un fixture local con la MISMA
// forma real de models.dev/api.json (verificada en vivo, no inventada) —
// sin red, determinístico. Importar `extractCandidates` no dispara el
// fetch real gracias al guard de `import.meta.url` en el script.
import type { ModelsDevProvider } from "../scripts/sync-model-catalog.js";
import { extractCandidates } from "../scripts/sync-model-catalog.js";

let failed = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (ok) {
    console.log(`✅ [PASSED] ${label}`);
  } else {
    console.error(`❌ [FAILED] ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
};

// Subconjunto real, con la misma forma exacta que devolvió
// models.dev/api.json en vivo (2026-08-09) para el proveedor "google",
// más un proveedor no configurado (anthropic) para probar el filtro de
// proveedor.
const FIXTURE: Record<string, ModelsDevProvider> = {
  google: {
    id: "google",
    name: "Google",
    models: {
      "gemini-2.5-flash-lite": {
        id: "gemini-2.5-flash-lite",
        name: "Gemini 2.5 Flash-Lite",
        structured_output: true,
        tool_call: true,
        open_weights: false,
        limit: { context: 1048576, output: 65536 },
        cost: { input: 0.1, output: 0.4 }
      },
      "gemini-3.1-pro-preview": {
        id: "gemini-3.1-pro-preview",
        name: "Gemini 3.1 Pro Preview",
        structured_output: true,
        tool_call: true,
        open_weights: false,
        limit: { context: 1048576, output: 65536 },
        cost: {
          input: 2,
          output: 12,
          tiers: [{ input: 4, output: 18, tier: { type: "context", size: 200000 } }]
        }
      },
      // Sin structured_output — debe excluirse (§3/§7: filtro DURO).
      "gemini-3.1-flash-image": {
        id: "gemini-3.1-flash-image",
        name: "Gemini 3.1 Flash Image",
        structured_output: false,
        tool_call: false,
        cost: { input: 0.5, output: 60 }
      },
      // Sin precio real (música/TTS/etc.) — debe excluirse, no se puede
      // calcular créditos sin costo.
      "lyria-3-pro-preview": {
        id: "lyria-3-pro-preview",
        name: "Lyria 3 Pro Preview",
        structured_output: true,
        tool_call: true,
        cost: { input: 0, output: 0 }
      },
      // cost ausente por completo (algunos modelos gemma en la data real)
      // — debe excluirse.
      "gemma-4-31b-it": {
        id: "gemma-4-31b-it",
        name: "Gemma 4 31B IT",
        structured_output: true,
        tool_call: true
      }
    }
  },
  // Proveedor NO configurado en este proyecto (sin API key real,
  // `enabled: false` en ambos config/models.*.yaml) — cualquier modelo
  // aquí debe excluirse sin importar cuán bueno sea el candidato.
  anthropic: {
    id: "anthropic",
    name: "Anthropic",
    models: {
      "claude-opus-4-8": {
        id: "claude-opus-4-8",
        name: "Claude Opus 4.8",
        structured_output: true,
        tool_call: true,
        cost: { input: 5, output: 25 }
      }
    }
  }
};

async function main() {
  console.log(`\n==================================================`);
  console.log(`🧪 SUITE DE VALIDACIÓN — Filtrado del catálogo de modelos (scripts/sync-model-catalog.ts, sin red)`);
  console.log(`==================================================\n`);

  const candidates = extractCandidates(FIXTURE);
  const ids = candidates.map((c) => c.id);

  check("Exactamente 2 candidatos sobreviven el filtro completo", candidates.length === 2, `ids=${JSON.stringify(ids)}`);
  check("gemini-2.5-flash-lite (structured_output+tool_call+precio, proveedor configurado) pasa", ids.includes("gemini-2.5-flash-lite"));
  check("gemini-3.1-pro-preview pasa", ids.includes("gemini-3.1-pro-preview"));
  check("gemini-3.1-flash-image (sin structured_output/tool_call) se excluye", !ids.includes("gemini-3.1-flash-image"));
  check("lyria-3-pro-preview (costo $0/$0) se excluye", !ids.includes("lyria-3-pro-preview"));
  check("gemma-4-31b-it (sin campo cost) se excluye", !ids.includes("gemma-4-31b-it"));
  check("claude-opus-4-8 (proveedor Anthropic, sin cuenta configurada) se excluye SIEMPRE, sin importar su precio/calidad", !ids.includes("claude-opus-4-8"));

  const sorted = candidates.every((c, i) => i === 0 || candidates[i - 1]!.costOutputPerMtok <= c.costOutputPerMtok);
  check("Los candidatos quedan ordenados por costo de output ascendente", sorted);

  const flashLite = candidates.find((c) => c.id === "gemini-2.5-flash-lite")!;
  check(
    "gemini-2.5-flash-lite: sin tier de precio distinto, worstCaseTier == base",
    flashLite.worstCaseTierCostInputPerMtok === 0.1 &&
      flashLite.worstCaseTierCostOutputPerMtok === 0.4 &&
      flashLite.worstCaseTierAppliesAboveContextTokens === null,
    JSON.stringify(flashLite)
  );

  const proPreview = candidates.find((c) => c.id === "gemini-3.1-pro-preview")!;
  check(
    "gemini-3.1-pro-preview: el tier de contexto grande se expone aparte, NUNCA se ignora en silencio (§6.3)",
    proPreview.worstCaseTierCostInputPerMtok === 4 &&
      proPreview.worstCaseTierCostOutputPerMtok === 18 &&
      proPreview.worstCaseTierAppliesAboveContextTokens === 200000,
    JSON.stringify(proPreview)
  );

  if (failed > 0) {
    console.error(`\n❌ [TEST SUITE FAILED] ${failed} caso(s) fallaron.`);
    process.exit(1);
  }

  console.log(`\n==================================================`);
  console.log(`🎉 [TEST SUITE PASSED] Filtrado del catálogo de modelos verificado contra un fixture real, sin red.`);
  console.log(`==================================================\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ [FAILED] Error inesperado en la suite:", err);
  process.exit(1);
});
