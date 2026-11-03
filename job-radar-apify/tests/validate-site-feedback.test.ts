import assert from "node:assert/strict";
import test from "node:test";
import { publicDisplayName, validateFeedback } from "../src/lib/site-feedback.js";
import { ROUTE_META } from "../src/lib/page-meta.js";
import { injectRouteMeta } from "../src/lib/agent-readiness.js";

test("feedback: a quick problem report needs only a valid category", () => {
  const result = validateFeedback({ kind: "problem", category: "no-carga" });
  assert.deepEqual(result, {
    ok: true,
    value: { kind: "problem", category: "no-carga", message: "", displayName: null, city: null, pagePath: null, search: null, rating: null }
  });
});

test("feedback: stars are 1–5 integers, required for opinions, optional for reports", () => {
  const report = validateFeedback({ kind: "problem", category: "otro", rating: 2 });
  assert.ok(report.ok && !("spam" in report));
  assert.equal(report.value.rating, 2);
  for (const rating of [0, 6, 4.5, "5", null]) {
    const r = validateFeedback({ kind: "problem", category: "otro", rating });
    assert.ok(r.ok && !("spam" in r));
    assert.equal(r.value.rating, null, String(rating));
  }
  const opinion = { kind: "opinion", category: "me-sirvio", message: "Me ahorra tiempo cada mañana.", displayName: "Ana M.", consentPublish: true };
  assert.equal(validateFeedback(opinion).ok, false, "opinión sin estrellas");
  assert.equal(validateFeedback({ ...opinion, rating: 7 }).ok, false, "fuera de rango");
  const ok = validateFeedback({ ...opinion, rating: 1 });
  assert.ok(ok.ok && !("spam" in ok));
  assert.equal(ok.value.rating, 1, "una estrella también se acepta");
});

test("feedback: technical context is kept only with the box ticked, without query or hash", () => {
  const body = { kind: "problem", category: "busqueda", pagePath: "/dashboard?search=x#top", search: "  contador  " };
  const without = validateFeedback(body);
  assert.ok(without.ok && !("spam" in without));
  assert.equal(without.value.pagePath, null);
  assert.equal(without.value.search, null);

  const withContext = validateFeedback({ ...body, attachContext: true });
  assert.ok(withContext.ok && !("spam" in withContext));
  assert.equal(withContext.value.pagePath, "/dashboard");
  assert.equal(withContext.value.search, "contador");

  for (const pagePath of ["https://evil.example/x", "//evil.example", "javascript:alert(1)"]) {
    const other = validateFeedback({ ...body, attachContext: true, pagePath });
    assert.ok(other.ok && !("spam" in other));
    assert.equal(other.value.pagePath, null, pagePath);
  }
});

test("feedback: unknown kinds and categories are rejected", () => {
  for (const body of [null, "x", {}, { kind: "spam", category: "otro" }, { kind: "problem", category: "encontre-trabajo" }, { kind: "opinion", category: "no-carga" }]) {
    assert.equal(validateFeedback(body).ok, false, JSON.stringify(body));
  }
});

test("feedback: an opinion needs consent and a real message; a typed name or city is ignored", () => {
  const base = { kind: "opinion", category: "me-sirvio", message: "Me ahorra tiempo cada mañana.", displayName: "Nombre inventado", city: " Medellín ", rating: 4 };
  assert.equal(validateFeedback(base).ok, false, "sin consentimiento");
  assert.equal(validateFeedback({ ...base, consentPublish: true, message: "ok" }).ok, false, "mensaje corto");
  const ok = validateFeedback({ ...base, consentPublish: true, pagePath: "/dashboard", attachContext: true });
  assert.ok(ok.ok && !("spam" in ok));
  assert.equal(ok.value.displayName, null, "el nombre público sale de la cuenta, nunca del formulario");
  assert.equal(ok.value.city, null);
  assert.equal(ok.value.pagePath, null, "las opiniones nunca guardan contexto técnico");
});

test("feedback: public name from the account is first name + last initial, never the email", () => {
  assert.equal(publicDisplayName("Ana María Pérez"), "Ana P.");
  assert.equal(publicDisplayName("  carlos  "), "Carlos");
  assert.equal(publicDisplayName("José Núñez"), "José N.");
  assert.ok(!/[<>]/.test(publicDisplayName("José <b>Núñez</b>")), "sin markup");
  assert.equal(publicDisplayName(null), "Persona registrada");
  assert.equal(publicDisplayName("ana@example.com"), "Persona registrada", "nunca una parte del correo");
});

test("feedback: control characters are stripped and text is clipped", () => {
  const result = validateFeedback({ kind: "problem", category: "otro", message: `a\u0000b\nc${"x".repeat(5000)}` });
  assert.ok(result.ok && !("spam" in result));
  assert.ok(result.value.message.startsWith("ab\nc"));
  assert.equal(result.value.message.length, 2000);
});

test("feedback: a filled honeypot is accepted silently and stored nowhere", () => {
  assert.deepEqual(validateFeedback({ kind: "problem", category: "otro", website: "http://spam.example" }), { ok: true, spam: true });
});

test("/opiniones server HTML: own head, indexable, user text escaped", () => {
  const meta = ROUTE_META["/opiniones"];
  assert.ok(meta?.heading && !meta.noindex);
  const indexHtml =
    '<html><head><title>x</title><meta name="description" content="x" /><link rel="canonical" href="https://buscotrabajo.co/" /></head><body><div id="app"></div></body></html>';
  const html = injectRouteMeta(indexHtml, "/opiniones", {
    ...meta,
    sections: [{ heading: "Opiniones publicadas", paragraphs: ['«<script>alert(1)</script>» Ana'] }]
  });
  assert.match(html, /<link rel="canonical" href="https:\/\/buscotrabajo\.co\/opiniones" \/>/);
  assert.match(html, /<h1>Opiniones sobre BuscoTrabajo<\/h1>/);
  assert.ok(!html.includes("<script>alert(1)</script>"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(!/noindex/.test(html));
  assert.ok(!/AggregateRating|"Review"/.test(html), "sin marcado de reseñas sobre BuscoTrabajo");
});
