/**
 * Deterministic HTML → plain text for job descriptions. This is not a
 * sanitizer for rendering — the output is data for matching and display as
 * text. External content is never interpreted as instructions.
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  eacute: "é",
  aacute: "á",
  iacute: "í",
  oacute: "ó",
  uacute: "ú",
  ntilde: "ñ",
  uuml: "ü",
  bull: "•",
  middot: "·"
};

export function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity: string) => {
    if (entity.startsWith("#x") || entity.startsWith("#X")) {
      const code = Number.parseInt(entity.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (entity.startsWith("#")) {
      const code = Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

const BLOCK_TAGS = /<\/(?:p|div|li|ul|ol|h[1-6]|tr|table|br|section|article)>|<br\s*\/?>/gi;

/** Strips tags, converts block boundaries to newlines, collapses whitespace. */
export function htmlToText(html: string): string {
  const withBreaks = html.replace(BLOCK_TAGS, "\n");
  // Inline tags vanish without a space so "<strong>x</strong>." stays "x.";
  // block-level separation was already turned into newlines above.
  const withoutTags = withBreaks.replace(/<[^>]*>/g, "");
  const decoded = decodeHtmlEntities(withoutTags);
  return decoded
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n");
}
