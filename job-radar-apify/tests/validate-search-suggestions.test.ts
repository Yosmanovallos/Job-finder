import { test } from "node:test";
import assert from "node:assert/strict";
import { boundedEditDistance, suggestSearch } from "../src/lib/search-suggestions.js";

test("errores de escritura frecuentes → palabra del diccionario cerrado", () => {
  assert.equal(suggestSearch("markerting"), "marketing");
  assert.equal(suggestSearch("Markerting"), "marketing");
  assert.equal(suggestSearch("comunity manajer"), "community manager");
  assert.equal(suggestSearch("desarollador react"), "desarrollador react");
  assert.equal(suggestSearch("auxiliar adminstrativo"), "auxiliar administrativo");
  assert.equal(suggestSearch("pyhton"), "python");
  // The accented spelling is what a literal search needs to match.
  assert.equal(suggestSearch("ingeneria civil"), "ingeniería civil");
  assert.equal(suggestSearch("medelin"), "medellín");
});

test("sin sugerencia cuando no hay nada que corregir", () => {
  assert.equal(suggestSearch("marketing"), null);
  assert.equal(suggestSearch("ingenieria civil"), null);
  assert.equal(suggestSearch("AI Engineer"), null);
  assert.equal(suggestSearch(""), null);
  assert.equal(suggestSearch(null), null);
  // Nothing close in the dictionary: no guess.
  assert.equal(suggestSearch("xyzzy"), null);
  assert.equal(suggestSearch("Accenture"), null);
  // Numbers and short words are never "corrected".
  assert.equal(suggestSearch("3001234567"), null);
  assert.equal(suggestSearch("qa"), null);
  // Long or many-word input is not processed.
  assert.equal(suggestSearch("a b c d e f g markerting"), null);
});

test("distancia acotada: transposición = 1 y corte temprano", () => {
  assert.equal(boundedEditDistance("pyhton", "python", 2), 1);
  assert.equal(boundedEditDistance("markerting", "marketing", 2), 1);
  assert.equal(boundedEditDistance("abc", "xyzxyz", 2), 3);
});

test("barato en CPU: una consulta sin coincidencia tarda menos de 5 ms", () => {
  suggestSearch("warmup");
  const started = performance.now();
  for (let i = 0; i < 20; i++) suggestSearch("zzqqwwxxyyzzqqww administracion");
  assert.ok((performance.now() - started) / 20 < 5);
});
