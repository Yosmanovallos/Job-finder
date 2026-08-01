// Shared by merco.ts and gptw.ts — both sources emit accented/special
// characters as numeric HTML entities (e.g. "&#201;" = "É", "&#8211;" =
// "–") in otherwise-plain-text fields (company names). Deliberately narrow
// (numeric entities only, no named-entity table) — that's the only pattern
// observed in either source's real responses this session.
export function decodeNumericHtmlEntities(text: string): string {
  return text.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}
