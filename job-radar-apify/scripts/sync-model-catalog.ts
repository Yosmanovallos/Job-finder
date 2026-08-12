/**
 * Fase 12 (docs/CV-GENERATION-PLAN.md §6.5.1) — trae el catálogo público
 * de Models.dev (la misma fuente que usa OpenCode, models.dev/api.json),
 * filtra por soporte de `structured_output`/`tool_call` (§3/§7: la
 * salida siempre schema-locked, sin excepción) y por proveedores con
 * cuenta REAL ya configurada en este proyecto, y deja una lista de
 * candidatos para revisión humana.
 *
 * Nunca invoca el binario `opencode` (§6.5.1: OpenCode es una
 * herramienta de agente interactiva, no una librería de servidor) y
 * nunca agrega nada al selector de producto — este script solo escribe
 * `docs/model-catalog-candidates.json` (regenerado en cada corrida,
 * SOLO para lectura humana). Promover un candidato al catálogo real
 * (`config/model-catalog.yaml`) es un paso manual aparte: ese archivo
 * nunca lo escribe este script (mismo principio de revisión humana que
 * `active: false` para prompts, §0/§10 Fase 8).
 *
 * `npx tsx scripts/sync-model-catalog.ts` — sin argumentos, sin
 * escritura a ningún archivo de config real, solo red (GET público) +
 * el archivo de candidatos.
 */
import { writeFileSync } from "node:fs";

const MODELS_DEV_URL = "https://models.dev/api.json";
const OUTPUT_PATH = "docs/model-catalog-candidates.json";

/**
 * Único(s) proveedor(es) con cuenta REAL configurada en este proyecto —
 * verificado 2026-08-09 (Fase 12): `GEMINI_API_KEY` es la única env var
 * de proveedor referenciada en todo `src/` (`openai-compatible-client.ts`);
 * `anthropic`/`ollama` están `enabled: false` en ambos
 * `config/models.*.yaml` y no existe key para ninguno de los dos. Esto
 * NO es una preferencia hardcodeada — es lo que el proyecto realmente
 * puede facturar hoy (AGENTS.md regla 5: nunca inventar datos, aplicado
 * aquí a "qué proveedor está disponible", no solo a hechos de un CV).
 * Ampliar esta lista el día que un segundo proveedor tenga key real.
 */
const CONFIGURED_PROVIDERS = new Set(["google"]);

export interface ModelsDevCostTier {
  input: number;
  output: number;
  tier: { type: string; size: number };
}

export interface ModelsDevCost {
  input?: number;
  output?: number;
  tiers?: ModelsDevCostTier[];
}

export interface ModelsDevModel {
  id: string;
  name: string;
  structured_output?: boolean;
  tool_call?: boolean;
  open_weights?: boolean;
  limit?: { context?: number; output?: number };
  cost?: ModelsDevCost;
}

export interface ModelsDevProvider {
  id: string;
  name: string;
  models: Record<string, ModelsDevModel>;
}

export interface Candidate {
  provider: string;
  id: string;
  name: string;
  costInputPerMtok: number;
  costOutputPerMtok: number;
  /** Si Models.dev reporta un tier más caro para contextos grandes, se
   * expone aparte — nunca se ignora en silencio (§6.3 ya documentó este
   * riesgo real para gemini-3.1-pro-preview: "si el prompt crece cerca de
   * ese límite, este pricing quedaría silenciosamente subestimado"). */
  worstCaseTierCostInputPerMtok: number;
  worstCaseTierCostOutputPerMtok: number;
  worstCaseTierAppliesAboveContextTokens: number | null;
  contextLimit: number | null;
  outputLimit: number | null;
  openWeights: boolean;
}

export function extractCandidates(data: Record<string, ModelsDevProvider>): Candidate[] {
  const candidates: Candidate[] = [];
  for (const [providerKey, provider] of Object.entries(data)) {
    if (!CONFIGURED_PROVIDERS.has(providerKey)) continue;
    for (const model of Object.values(provider.models ?? {})) {
      // §3/§7: salida siempre schema-locked — un modelo sin las dos
      // capacidades no puede garantizar el JSON que este pipeline exige,
      // sin importar cuán barato o popular sea (§6.5.1, filtro DURO).
      if (model.structured_output !== true || model.tool_call !== true) continue;
      const cost = model.cost;
      // Sin precio real (cost ausente, o $0 en ambos campos — música/
      // TTS/otros modos raros de Models.dev, no chat de texto priceable)
      // no se puede calcular la fórmula de créditos de §6.5.2 — se
      // descarta, no se inventa un precio.
      if (!cost || ((cost.input ?? 0) <= 0 && (cost.output ?? 0) <= 0)) continue;

      const baseInput = cost.input ?? 0;
      const baseOutput = cost.output ?? 0;
      let worstTier = { input: baseInput, output: baseOutput, size: null as number | null };
      for (const t of cost.tiers ?? []) {
        if (t.input + t.output > worstTier.input + worstTier.output) {
          worstTier = { input: t.input, output: t.output, size: t.tier.size };
        }
      }

      candidates.push({
        provider: providerKey,
        id: model.id,
        name: model.name,
        costInputPerMtok: baseInput,
        costOutputPerMtok: baseOutput,
        worstCaseTierCostInputPerMtok: worstTier.input,
        worstCaseTierCostOutputPerMtok: worstTier.output,
        worstCaseTierAppliesAboveContextTokens: worstTier.size,
        contextLimit: model.limit?.context ?? null,
        outputLimit: model.limit?.output ?? null,
        openWeights: model.open_weights ?? false
      });
    }
  }
  candidates.sort((a, b) => a.costOutputPerMtok - b.costOutputPerMtok);
  return candidates;
}

async function main() {
  console.log(`[sync-model-catalog] Fetching ${MODELS_DEV_URL}...`);
  const res = await fetch(MODELS_DEV_URL);
  if (!res.ok) {
    throw new Error(`Models.dev respondió ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as Record<string, ModelsDevProvider>;

  const candidates = extractCandidates(data);

  console.log(
    `\n[sync-model-catalog] ${candidates.length} candidatos reales — proveedor(es) configurado(s): ` +
      `${[...CONFIGURED_PROVIDERS].join(", ")}; structured_output && tool_call; con precio real:\n`
  );
  for (const c of candidates) {
    const tierNote =
      c.worstCaseTierAppliesAboveContextTokens !== null
        ? ` [peor caso >${c.worstCaseTierAppliesAboveContextTokens} tokens de contexto: $${c.worstCaseTierCostInputPerMtok}/$${c.worstCaseTierCostOutputPerMtok}]`
        : "";
    console.log(`- ${c.id} (${c.provider}) — $${c.costInputPerMtok}/$${c.costOutputPerMtok} por Mtok${tierNote}`);
  }

  const output = {
    generatedAt: new Date().toISOString(),
    source: MODELS_DEV_URL,
    configuredProviders: [...CONFIGURED_PROVIDERS],
    filter: "structured_output === true && tool_call === true && precio real (> $0 en input u output)",
    candidateCount: candidates.length,
    candidates
  };
  writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2) + "\n");
  console.log(
    `\n[sync-model-catalog] Escrito ${OUTPUT_PATH} — SOLO para revisión humana. ` +
      "Este archivo se regenera en cada corrida y nunca se lee en producción. " +
      "Para adoptar un candidato: revisarlo a mano, calcular créditos con la fórmula de §6.5.2 " +
      "(créditos = redondear_arriba(costo_peor_caso_usd / $0.10)), y agregarlo manualmente a " +
      "config/model-catalog.yaml — este script nunca escribe ahí."
  );
}

// Guard: `extractCandidates` es importado directamente por
// tests/validate-model-catalog-sync.ts (fixture local, sin red) — sin
// esto, importarlo dispararía un fetch real de red como efecto
// colateral de la sola importación.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("❌ [sync-model-catalog] Fatal error:", err);
    process.exit(1);
  });
}
