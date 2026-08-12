export function htmlEntities(str: string): string {
  if (!str) return '';
  return str
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&apos;', "'")
    .replaceAll('&#225;', 'á')
    .replaceAll('&#233;', 'é')
    .replaceAll('&#237;', 'í')
    .replaceAll('&#243;', 'ó')
    .replaceAll('&#250;', 'ú')
    .replaceAll('&#241;', 'ñ')
    .replaceAll('&#193;', 'Á')
    .replaceAll('&#201;', 'É')
    .replaceAll('&#205;', 'Í')
    .replaceAll('&#211;', 'Ó')
    .replaceAll('&#218;', 'Ú')
    .replaceAll('&#209;', 'Ñ')
    .replaceAll('&#252;', 'ü')
    .replaceAll('&#220;', 'Ü')
    .replaceAll('&#231;', 'ç')
    .replaceAll('&#199;', 'Ç')
    .replaceAll('&#x2F;', '/')
    .replaceAll('&#xF1;', 'ñ')
    .replaceAll('&#xE1;', 'á')
    .replaceAll('&#xE9;', 'é')
    .replaceAll('&#xED;', 'í')
    .replaceAll('&#xF3;', 'ó')
    .replaceAll('&#xFA;', 'ú')
    .replaceAll('&#xC1;', 'Á')
    .replaceAll('&#xC9;', 'É')
    .replaceAll('&#xCD;', 'Í')
    .replaceAll('&#xD3;', 'Ó')
    .replaceAll('&#xDA;', 'Ú')
    .replaceAll('&#xD1;', 'Ñ')
    // Bug real encontrado 2026-08-12 verificando datos en vivo: faltaba
    // este entity, así que descripciones scrapeadas (ej. Magneto) mostraban
    // "&nbsp;" literal en vez de un espacio en el texto renderizado.
    .replaceAll('&nbsp;', ' ');
}

/**
 * Deterministic HTML -> plain-text extraction for job descriptions coming
 * from source APIs (RemoteOK/Remotive/GetOnBoard all return `description`
 * as an HTML blob with <ul><li> bullet lists inside). Splits `<li>` items
 * out as `requirements` (real content the source itself structured as a
 * list — not an LLM guess) and returns the rest of the text, tags stripped,
 * as `description`. No LLM involved (AGENTS.md #4 — LLMs only where
 * rules/parsers genuinely can't do the job; here they can).
 *
 * Never used with dangerouslySetInnerHTML on the frontend — both returned
 * strings are plain text, so there is no stored-HTML/XSS surface from
 * scraped content reaching the DOM as markup.
 */
// Bug real encontrado y corregido 2026-08-12, verificado contra el JSON-LD
// crudo de una vacante real de Magneto: su propio campo `description` trae
// frases pegadas SIN ningún tag ni separador entre ellas —
// "...ContableAsistente ContableAuxiliar ContableAuxiliar
// AdministrativaContapyme..." existe exactamente así en el string fuente
// (confirmado leyendo el HTML crudo directo, no es un artefacto de este
// parser). No hay frontera de tag que detectar porque no hay tag — es un
// bug de generación de datos del lado de Magneto (su "Palabras clave" se
// concatena sin separador). Sin una etiqueta que parsear, la única señal
// disponible es la frontera minúscula->mayúscula, que en español nunca
// ocurre dentro de una palabra real (a diferencia del inglés con camelCase
// legítimo — "iPhone", "eBay" — este proyecto solo scrapea fuentes en
// español/Colombia-Venezuela, así que el riesgo de falso positivo es bajo).
// Inserta espacio, nunca cambia ni borra una letra — es una corrección de
// espaciado, no de contenido.
// Encontrado el mismo día en el mismo texto real ("...ti:Vivir
// actualmente...", "Condiciones laborales:Contrato a término..."): dos
// puntos pegados directo a la palabra siguiente, sin espacio. A diferencia
// del punto (que sí puede ser parte de una abreviatura real como "S.A.S.",
// por eso ESE caso no se corrige — ver comentario más abajo), los dos
// puntos en español nunca son parte de una palabra ni de una abreviatura;
// siempre son un separador de rótulo ("Etiqueta:contenido"). Excluye
// dígitos a propósito para no tocar notación de hora/proporción ("3:00",
// "16:9").
function splitGluedSpanishWords(text: string): string {
  return text
    .replace(/([a-zñáéíóúü])([A-ZÑÁÉÍÓÚÜ])/g, '$1 $2')
    .replace(/:([A-Za-zÁÉÍÓÚÑáéíóúñ])/g, ': $1');
}

// Bug real encontrado y corregido 2026-08-12, verificado leyendo el JSON-LD
// crudo de una vacante real de Magneto ("Jefe De Tienda Ara"): su
// `description` trae saltos de línea (`\n` reales, no HTML) en puntos
// completamente arbitrarios a mitad de frase — "...trabajamos cada día con
// un\npropósito claro..." — un artefacto de wrap a ~75-80 caracteres, no
// una frontera real de párrafo (confirmado: rompe en medio de oraciones sin
// relación con puntuación). Tratar cada uno como salto de línea real (lo
// que la versión anterior hacía) producía un muro de líneas cortas y
// picadas en vez de prosa fluida. Se normalizan a espacio ANTES de
// cualquier otro procesamiento, para que sobrevivan a `\n` únicamente los
// que ESTE parser inserta a propósito por una frontera de tag real.
const NORMALIZE_RAW_WHITESPACE = /[\r\n\t]+/g;

// Encontrado el mismo día en otra vacante real de Magneto ("Asistente
// Administrativa y Contable"): esa fuente no trae NINGÚN separador entre
// secciones — ni tag, ni `\n`, nada — solo esta lista fija de etiquetas que
// Magneto agrega siempre, en el mismo orden, como resumen estructurado
// auto-generado (confirmado en dos vacantes de rubros distintos con la
// misma lista exacta). Insertar un salto de línea justo antes de cada una,
// dondequiera que aparezcan, es seguro porque son literales conocidos de
// la plantilla de Magneto, no un patrón adivinado sobre texto libre.
const KNOWN_SECTION_LABELS = [
  'Palabras clave:',
  'Responsabilidades:',
  'Requerimientos:',
  'Nivel de educación:',
  'Sectores laborales:',
  'Cargo:',
  'Otras habilidades:',
  'Habilidades técnicas:',
  'Habilidades interpersonales:'
];
const SECTION_LABEL_PATTERN = new RegExp(
  `\\s*(${KNOWN_SECTION_LABELS.map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`,
  'g'
);
function insertKnownSectionBreaks(text: string): string {
  return text.replace(SECTION_LABEL_PATTERN, '\n$1');
}

export function extractStructuredFromHtml(html: string): {
  description: string;
  requirements: string[];
} {
  if (!html) return { description: '', requirements: [] };
  const flattened = html.replace(NORMALIZE_RAW_WHITESPACE, ' ');

  const stripTags = (s: string) =>
    splitGluedSpanishWords(htmlEntities(s.replace(/<[^>]+>/g, ' ')))
      .replace(/\s+/g, ' ')
      .trim();

  const requirements: string[] = [];
  const liMatches = flattened.match(/<li[^>]*>[^]*?<\/li>/gi) || [];
  for (const li of liMatches) {
    const text = stripTags(li.replace(/^<li[^>]*>/i, '').replace(/<\/li>$/i, ''));
    if (text) requirements.push(text);
  }

  // Strip out the <ul>/<ol> blocks already captured as requirements, then
  // convert paragraph/line-break boundaries to newlines before stripping
  // remaining tags, so prose doesn't collapse into one unreadable line.
  //
  // Bug real encontrado y corregido 2026-08-12 (verificado contra HTML real
  // de Magneto): la versión anterior solo convertía tags de CIERRE
  // (</p>/</div>/</h1-6>) a salto de línea. HTML real, pegado desde un
  // editor de texto enriquecido, suele traer <p> mal anidados/sin cerrar
  // ("...tu tienda,<p>liderar un equipo...") — el <p> de APERTURA ahí caía
  // directo en el catch-all final (borrado, sin separador), pegando
  // "tienda.Liderar" sin espacio. Ahora tanto apertura como cierre de
  // p/div/h1-6 cuentan como frontera de línea, sin depender de que el
  // tag esté bien cerrado.
  const withoutLists = flattened.replace(/<(ul|ol)[^>]*>[^]*?<\/\1>/gi, '\n');
  const withBreaks = withoutLists
    .replace(/<\/?\s*(p|div|h[1-6])(?:\s[^>]*)?\/?>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n');
  // Catch-all for any remaining inline tag (<strong>, <em>, <span>, ...):
  // a SPACE, not empty string — an inline tag glued directly onto an
  // adjacent word with no whitespace ("Berrio<strong>Tendrás") must not
  // silently concatenate into "BerrioTendrás". Extra whitespace this
  // introduces around normally-spaced tags is harmless: every line gets
  // collapsed via /\s+/g below.
  const withSections = insertKnownSectionBreaks(
    splitGluedSpanishWords(htmlEntities(withBreaks.replace(/<[^>]+>/g, ' ')))
  );
  const description = withSections
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');

  return { description, requirements };
}

// Known, literal employment-type markers that RemoteOK puts directly inside
// its `tags` array (confirmed live, 2026-08-11: e.g. tags containing the
// exact string "full time" alongside skill tags). Exact-match only — this is
// reading a value the source already published, not inferring/guessing one.
const EMPLOYMENT_TYPE_TAG_MAP: Record<string, string> = {
  "full time": "Tiempo completo",
  "part time": "Medio tiempo",
  contract: "Contrato",
  freelance: "Freelance",
  internship: "Prácticas"
};

export function mapEmploymentTypeTag(tags: string[]): string | undefined {
  for (const tag of tags) {
    const match = EMPLOYMENT_TYPE_TAG_MAP[tag.trim().toLowerCase()];
    if (match) return match;
  }
  return undefined;
}
