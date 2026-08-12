import crypto, { createHash } from "node:crypto";
import { z } from "zod";
import { pool } from "../src/db/client.js";
import { getOrCreateUser } from "../src/db/job-repository.js";
import {
  BudgetExceededError,
  InactivePromptError,
  ModelGateway,
  PromptOutputError,
  type PromptDefinition
} from "../src/cv/model-gateway.js";
import { ModelsConfigSchema, type ModelsConfig } from "../src/cv/model-config.js";
import type { CompletionRequest, CompletionResult, ModelClient } from "../src/cv/model-client.js";

// Fase 1 (docs/CV-GENERATION-PLAN.md §6.1/§10): cero llamadas a LLM
// reales — un fakeClient sustituye al proveedor, igual que
// packages/models/src/gateway.test.ts del proyecto raíz. Corre contra
// las tablas reales llm_response_cache/llm_usage_ledger (Fase 0), no un
// mock — y borra cada fila que inserta al final, para no dejar basura ni
// alterar el circuit breaker diario real.

const TEST_MODEL = "__test-model-fase1__"; // marca reconocible, nunca choca con un modelo real

function baseConfig(overrides: Partial<ModelsConfig["budgets"]> = {}): ModelsConfig {
  return ModelsConfigSchema.parse({
    aliases: { test_alias: TEST_MODEL },
    pricing: { [TEST_MODEL]: { input_per_mtok: 1, output_per_mtok: 5 } },
    tasks: { test_task: { model_alias: "test_alias", max_output_tokens: 500 } },
    budgets: { max_daily_cloud_cost_usd: 1.0, stop_on_budget_exceeded: true, ...overrides }
  });
}

const OutputSchema = z.object({ decision: z.string() }).strict();
type Output = z.infer<typeof OutputSchema>;

function makePrompt(overrides: Partial<PromptDefinition<{ text: string }, Output>> = {}): PromptDefinition<
  { text: string },
  Output
> {
  return {
    name: "test_prompt",
    version: "v1",
    task: "test_task",
    active: true,
    schema: OutputSchema,
    render: (input) => ({ system: "system prompt", user: `<INPUT>\n${input.text}\n</INPUT>` }),
    ...overrides
  };
}

function fakeClient(responses: string[]): ModelClient & { requests: CompletionRequest[] } {
  const requests: CompletionRequest[] = [];
  return {
    requests,
    async complete(request): Promise<CompletionResult> {
      requests.push(request);
      const text = responses.shift() ?? "{}";
      return { text, inputTokens: 1000, outputTokens: 200 };
    }
  };
}

const VALID_OUTPUT = JSON.stringify({ decision: "ok" });

/** Cleans up every ledger/cache row this test run touched — never leaves
 * fixtures behind in the real, shared database (no separate test DB).
 * Cache rows are looked up by their EXACT computed key, never by a broad
 * pattern — `llm_response_cache.key` is an opaque sha256 hash shared with
 * every other prompt this gateway will ever cache, so a loose `LIKE`/regex
 * filter here would delete real production cache entries from later
 * phases, not just this test's own rows. */
function cacheKeyFor(text: string): string {
  const prompt = makePrompt();
  const rendered = prompt.render({ text });
  return createHash("sha256")
    .update([prompt.name, prompt.version, TEST_MODEL, rendered.system, rendered.user].join(" "))
    .digest("hex");
}

/** Fase 2 (docs/RESUME-STUDIO-PLAN.md): misma construcción que
 * `cacheKeyFor`, más userId/providerId al final — debe coincidir EXACTO con
 * lo que `ModelGateway.run()` arma internamente cuando `credentialSource ===
 * "user_byok"`, o el test no estaría probando el código real. */
function cacheKeyForScoped(text: string, userId: string, providerId: string): string {
  const prompt = makePrompt();
  const rendered = prompt.render({ text });
  return createHash("sha256")
    .update([prompt.name, prompt.version, TEST_MODEL, rendered.system, rendered.user, userId, providerId].join(" "))
    .digest("hex");
}

// Every input text that a test below expects to succeed and therefore
// write to the cache — kept in one place so cleanup() never drifts out of
// sync with what the tests actually generate.
const CACHE_WRITING_INPUTS = [
  "hola", // Test 2
  "primer input del test de presupuesto", // Test 4, primera llamada
  "input A sin breaker", // Test 5
  "input B sin breaker, no debe fallar" // Test 5
];

// Fase 2: dos usuarios reales ficticios (la FK user_id de llm_response_cache
// exige que existan) — ids fijos para que cleanup() los pueda borrar aunque
// el proceso se corte a mitad de camino en una corrida anterior.
const BYOK_USER_A = "00000000-0000-4000-8000-000000000b41";
const BYOK_USER_B = "00000000-0000-4000-8000-000000000b42";
const BYOK_SCOPED_INPUT = "input scoped por usuario (Fase 2)";
const BYOK_PROVIDER = "google";

async function cleanup() {
  await pool.query(`DELETE FROM llm_usage_ledger WHERE model = $1`, [TEST_MODEL]);
  const keys = CACHE_WRITING_INPUTS.map(cacheKeyFor);
  const scopedKeys = [BYOK_USER_A, BYOK_USER_B].map((u) => cacheKeyForScoped(BYOK_SCOPED_INPUT, u, BYOK_PROVIDER));
  await pool.query(`DELETE FROM llm_response_cache WHERE key = ANY($1)`, [[...keys, ...scopedKeys]]);
  await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [[BYOK_USER_A, BYOK_USER_B]]);
}

async function main() {
  console.log(`\n==================================================`);
  console.log(`🧪 SUITE DE VALIDACIÓN DEL GATEWAY NATIVO DE CV (Fase 1)`);
  console.log(`==================================================\n`);

  let failed = 0;
  const check = (label: string, ok: boolean, detail = "") => {
    if (ok) {
      console.log(`✅ [PASSED] ${label}`);
    } else {
      console.error(`❌ [FAILED] ${label}${detail ? ` — ${detail}` : ""}`);
      failed++;
    }
  };

  await cleanup(); // start from a clean slate in case a previous run crashed mid-way

  try {
    console.log(`🔍 [Test 1] Rechaza prompts inactivos salvo allowInactive...`);
    {
      const gateway = new ModelGateway({ config: baseConfig(), client: fakeClient([VALID_OUTPUT]), pool, allowInactive: false });
      try {
        await gateway.run(makePrompt({ active: false }), { text: "hola" });
        check("Prompt inactivo debe lanzar InactivePromptError", false, "no lanzó nada");
      } catch (e) {
        check("Prompt inactivo lanza InactivePromptError", e instanceof InactivePromptError, String(e));
      }
    }

    console.log(`\n🔍 [Test 2] Valida el schema y cachea por hash (contra Postgres real)...`);
    {
      const client = fakeClient([VALID_OUTPUT]);
      const gateway = new ModelGateway({ config: baseConfig(), client, pool, allowInactive: true });

      const first = await gateway.run(makePrompt(), { text: "hola" });
      check("Primera corrida no viene de cache", first.cached === false);
      check("Primera corrida devuelve el output validado", first.output.decision === "ok");

      const second = await gateway.run(makePrompt(), { text: "hola" });
      check("Segunda corrida (mismo input) viene de cache", second.cached === true);
      check("Segunda corrida NO vuelve a llamar al modelo", client.requests.length === 1, `requests=${client.requests.length}`);

      const { rows } = await pool.query(`SELECT stage, model FROM llm_usage_ledger WHERE model = $1`, [TEST_MODEL]);
      check("El ledger tiene exactamente 1 fila (la corrida cacheada no logueó de nuevo)", rows.length === 1, `filas=${rows.length}`);
      check("La fila del ledger trae el stage/model correctos", rows[0]?.stage === "test_task" && rows[0]?.model === TEST_MODEL);
    }

    console.log(`\n🔍 [Test 3] Reintenta una vez ante JSON inválido, después falla ruidosamente...`);
    {
      const client = fakeClient(["esto no es json", "tampoco {esto"]);
      const gateway = new ModelGateway({ config: baseConfig(), client, pool, allowInactive: true });
      try {
        await gateway.run(makePrompt(), { text: "input distinto para no pegarle al cache de arriba" });
        check("Dos respuestas inválidas deben lanzar PromptOutputError", false, "no lanzó nada");
      } catch (e) {
        check("Lanza PromptOutputError tras 2 intentos", e instanceof PromptOutputError, String(e));
      }
      check("Hizo exactamente 2 intentos (1 reintento, nunca más)", client.requests.length === 2, `requests=${client.requests.length}`);
      check(
        "El segundo intento pide explícitamente JSON válido",
        client.requests[1]?.user.includes("Return ONLY a valid JSON object") ?? false
      );
    }

    console.log(`\n🔍 [Test 4] El circuit breaker diario detiene llamadas nuevas al superarse (Postgres real)...`);
    {
      // dailyCostUsd() suma TODO el ledger de hoy para este modelo — los
      // Tests 2-3 ya dejaron gasto real ahí, así que se limpia antes de
      // asumir "la primera llamada del test parte de $0 gastado hoy".
      await pool.query(`DELETE FROM llm_usage_ledger WHERE model = $1`, [TEST_MODEL]);
      const client = fakeClient([VALID_OUTPUT, VALID_OUTPUT]);
      // Presupuesto absurdamente bajo: la primera llamada ya lo agota.
      const gateway = new ModelGateway({ config: baseConfig({ max_daily_cloud_cost_usd: 0.000001 }), client, pool, allowInactive: true });
      await gateway.run(makePrompt(), { text: "primer input del test de presupuesto" });
      try {
        await gateway.run(makePrompt(), { text: "segundo input, nunca debería ejecutarse" });
        check("La segunda llamada debía lanzar BudgetExceededError", false, "no lanzó nada");
      } catch (e) {
        check("La segunda llamada lanza BudgetExceededError", e instanceof BudgetExceededError, String(e));
      }
    }

    console.log(`\n🔍 [Test 5] stop_on_budget_exceeded=false desactiva el circuit breaker...`);
    {
      // Mismo motivo que el Test 4: partir de $0 gastado hoy para este modelo.
      await pool.query(`DELETE FROM llm_usage_ledger WHERE model = $1`, [TEST_MODEL]);
      const client = fakeClient([VALID_OUTPUT, VALID_OUTPUT]);
      const gateway = new ModelGateway({
        config: baseConfig({ max_daily_cloud_cost_usd: 0.000001, stop_on_budget_exceeded: false }),
        client,
        pool,
        allowInactive: true
      });
      await gateway.run(makePrompt(), { text: "input A sin breaker" });
      const second = await gateway.run(makePrompt(), { text: "input B sin breaker, no debe fallar" });
      check("Con el breaker apagado, la segunda llamada corre igual", second.cached === false);
    }

    console.log(
      `\n🔍 [Test 6] Fase 2 (RESUME-STUDIO-PLAN.md): "user_byok" scopea la cache por usuario+proveedor — nunca se comparte entre usuarios...`
    );
    {
      await getOrCreateUser(BYOK_USER_A, `cv-gateway-byok-a-${Date.now()}@example-test.com`);
      await getOrCreateUser(BYOK_USER_B, `cv-gateway-byok-b-${Date.now()}@example-test.com`);

      const client = fakeClient([VALID_OUTPUT, VALID_OUTPUT, VALID_OUTPUT]);
      const gateway = new ModelGateway({ config: baseConfig(), client, pool, allowInactive: true });

      const forA = () =>
        gateway.run(makePrompt(), { text: BYOK_SCOPED_INPUT }, { userId: BYOK_USER_A, credentialSource: "user_byok", providerId: BYOK_PROVIDER });
      const forB = () =>
        gateway.run(makePrompt(), { text: BYOK_SCOPED_INPUT }, { userId: BYOK_USER_B, credentialSource: "user_byok", providerId: BYOK_PROVIDER });

      const firstA = await forA();
      check("Primera llamada de A (BYOK) no viene de cache", firstA.cached === false);

      const firstB = await forB();
      check(
        "MISMO input/modelo, pero de B — NO viene de cache de A (sin esto, la respuesta de A se filtraría a B)",
        firstB.cached === false,
        `cached=${firstB.cached}`
      );
      check("2 llamadas reales al modelo hasta acá (A y B nunca comparten cache)", client.requests.length === 2, `requests=${client.requests.length}`);

      const secondA = await forA();
      check("Repetir la MISMA llamada de A sí pega en su propia cache", secondA.cached === true);
      check("Sigue en 2 llamadas reales (la repetición de A no llamó al modelo de nuevo)", client.requests.length === 2, `requests=${client.requests.length}`);

      const keyA = cacheKeyForScoped(BYOK_SCOPED_INPUT, BYOK_USER_A, BYOK_PROVIDER);
      const keyB = cacheKeyForScoped(BYOK_SCOPED_INPUT, BYOK_USER_B, BYOK_PROVIDER);
      check("La key de A es distinta de la key de B (scoping real, no solo coincidencia de resultado)", keyA !== keyB);

      const { rows: rowA } = await pool.query<{ user_id: string; provider_id: string }>(
        `SELECT user_id, provider_id FROM llm_response_cache WHERE key = $1`,
        [keyA]
      );
      check(
        "La fila de A en Postgres trae user_id/provider_id poblados (no solo escondidos en el hash — necesarios para el ON DELETE CASCADE de retención)",
        rowA[0]?.user_id === BYOK_USER_A && rowA[0]?.provider_id === BYOK_PROVIDER,
        JSON.stringify(rowA[0])
      );

      let thrownNoProvider: unknown;
      try {
        await gateway.run(makePrompt(), { text: "input sin providerId, debe fallar" }, { userId: BYOK_USER_A, credentialSource: "user_byok" });
      } catch (e) {
        thrownNoProvider = e;
      }
      check(
        '"user_byok" sin providerId lanza error explícito, nunca cachea sin scope por accidente',
        thrownNoProvider instanceof Error && /providerId/.test(String(thrownNoProvider)),
        String(thrownNoProvider)
      );

      // Retención (§ auditoría del plan aprobado): borrar la cuenta de A
      // debe borrar su fila de cache scoped vía ON DELETE CASCADE — nunca
      // queda huérfana reteniendo el output_json indefinidamente.
      await pool.query(`DELETE FROM users WHERE id = $1`, [BYOK_USER_A]);
      const { rows: afterDelete } = await pool.query(`SELECT 1 FROM llm_response_cache WHERE key = $1`, [keyA]);
      check("Borrar el usuario A limpia su fila de cache scoped (ON DELETE CASCADE real, no solo declarado)", afterDelete.length === 0);
    }
  } finally {
    await cleanup();
    await pool.end();
  }

  if (failed > 0) {
    console.error(`\n❌ [TEST SUITE FAILED] ${failed} caso(s) fallaron.`);
    process.exit(1);
  }

  console.log(`\n==================================================`);
  console.log(`🎉 [TEST SUITE PASSED] Gateway nativo de CV (Fase 1) verificado contra Postgres real, cero llamadas a LLM reales.`);
  console.log(`==================================================\n`);
  process.exit(0);
}

main();
