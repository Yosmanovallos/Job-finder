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
// relación con puntuación).
//
// Bug real #2 encontrado el mismo día verificando OTRA vacante de Magneto
// ("Analista Técnico I+D"): aplanar TODO `\n` a espacio (lo que esta función
// hacía hasta ahora) resuelve el bug de arriba pero destruye viñetas y
// encabezados reales de posts que sí separan secciones con `\n` puro, sin
// ningún tag — "Responsabilidades principales\n\nInvestigar tecnologías...
// \nDiseñar, desarrollar..." colapsaba en un solo párrafo ilegible. La señal
// que distingue un wrap accidental de una frontera real es la misma que ya
// usa splitGluedSpanishWords arriba: en español, minúscula-antes seguida de
// minúscula-después de cruzar el salto nunca ocurre dentro de una frase real
// bien puntuada — es la firma de una palabra/frase cortada a mitad por el
// wrap del editor de origen. Cualquier otro caso (la línea de arriba cierra
// en puntuación, o la de abajo arranca en mayúscula/símbolo, o es un salto
// doble real) es una frontera intencional y se conserva.
//
// Bug real #3 encontrado el mismo día en otra vacante de Magneto
// ("Desarrollador De Software AI First"): la regla de arriba solo cubre el
// wrap a mitad de palabra; ese mismo wrap también corta justo después de
// una coma cuando la coma cae cerca del límite de columna — "...capaz de
// diseñar,\ndesarrollar e integrar..." — dejando una coma seguida de salto
// de línea real. Una coma nunca cierra una oración ni antecede una frontera
// real de párrafo/viñeta (siempre implica que la frase continúa), así que
// cualquier `\n` inmediatamente después de una coma es wrap, sin necesitar
// mirar la línea siguiente.
function collapseWrappedNewlines(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/\t+/g, ' ')
    .replace(/,\n/g, ', ')
    .replace(/([a-zñáéíóúü])\n(?=[a-zñáéíóúü])/g, '$1 ');
}

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
// Etiquetas reales confirmadas en vivo (2026-08-12, dos vacantes distintas de
// Magneto — "Analista Técnico I+D" y "Desarrollador De Software AI First")
// que anteceden una LISTA de viñetas, no un párrafo — todo lo que sigue,
// hasta la próxima etiqueta reconocida, es un requisito/responsabilidad por
// ítem, nunca prosa. Antes esto quedaba mezclado dentro de `description`
// como texto plano sin viñetas ni sección propia — la corrección de abajo
// (`splitRequirementsSections`) lo separa a `requirements` real.
const REQUIREMENTS_SECTION_LABELS = [
  'Requisitos:',
  'Requerimientos:',
  'Responsabilidades:',
  'Perfil requerido',
  'Responsabilidades principales'
];
// Etiquetas que, si aparecen DENTRO de una zona de requirements, la cierran
// sin absorber su propio contenido — "Ofrecemos" son beneficios que ofrece
// el empleador, no algo que el candidato deba cumplir; meterlo en
// requirements sería tergiversar el dato, no solo un problema visual. Los
// KNOWN_SECTION_LABELS (Palabras clave/Cargo/etc.) son el resumen
// auto-generado de Magneto — tampoco son requirements.
//
// "Salario:"/"Horario:"/"Tipo de contrato:"/"Beneficios:" confirmados en
// vivo 2026-08-12 (Elempleo, "Auxiliar de Enfermería" — DaVita): su
// "Requisitos:" nunca cierra con una etiqueta ya conocida, así que sin
// esto la zona seguía abierta hasta el final del texto y esas 4 secciones
// (términos que ofrece el empleador, no algo que el candidato deba
// cumplir) terminaban listadas como si fueran requisitos. "Formación
// académica:"/"Experiencia:"/"Documentación requerida:" del mismo post SÍ
// se quedan dentro de la zona a propósito — son genuinamente lo que se le
// pide al candidato.
const REQUIREMENTS_STOP_LABELS = [
  'Ofrecemos',
  'Salario:',
  'Horario:',
  'Tipo de contrato:',
  'Beneficios:',
  ...KNOWN_SECTION_LABELS
];

const SECTION_LABEL_PATTERN = new RegExp(
  `\\s*(${[...KNOWN_SECTION_LABELS, ...REQUIREMENTS_SECTION_LABELS, ...REQUIREMENTS_STOP_LABELS]
    .filter((l, i, arr) => arr.indexOf(l) === i)
    .map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|')})`,
  'g'
);
function insertKnownSectionBreaks(text: string): string {
  return text.replace(SECTION_LABEL_PATTERN, '\n$1');
}

/**
 * Walks the already line-broken text and routes lines into `requirements`
 * once a REQUIREMENTS_SECTION_LABELS line opens a zone, until a
 * REQUIREMENTS_STOP_LABELS line (or the end of the text) closes it again —
 * everything outside a zone stays in `description`, in original order.
 * A line that starts with a zone-opening label but also carries content on
 * the same physical line (Magneto's "Requisitos:" case, confirmed live:
 * items separated by a double space, not a real newline, on that one line)
 * has its remainder split on 2+ spaces into individual items.
 */
function splitRequirementsSections(lines: string[]): { description: string[]; requirements: string[] } {
  const description: string[] = [];
  const requirements: string[] = [];
  let inZone = false;

  for (const line of lines) {
    const opensZone = REQUIREMENTS_SECTION_LABELS.find((label) => line.startsWith(label));
    if (opensZone) {
      inZone = true;
      const remainder = line.slice(opensZone.length).trim();
      if (remainder) {
        remainder
          .split(/\s{2,}/)
          .map((item) => item.trim())
          .filter(Boolean)
          .forEach((item) => requirements.push(item));
      }
      continue;
    }
    const closesZone = REQUIREMENTS_STOP_LABELS.some((label) => line.startsWith(label));
    if (closesZone) {
      inZone = false;
      description.push(line);
      continue;
    }
    if (inZone) {
      line
        .split(/\s{2,}/)
        .map((item) => item.trim())
        .filter(Boolean)
        .forEach((item) => requirements.push(item));
    } else {
      description.push(line);
    }
  }

  return { description, requirements };
}

export function extractStructuredFromHtml(html: string): {
  description: string;
  requirements: string[];
} {
  if (!html) return { description: '', requirements: [] };
  const flattened = collapseWrappedNewlines(html);

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
  // Trim only — NOT the usual /\s+/g single-space collapse yet.
  // splitRequirementsSections still needs to see a real double space as the
  // item separator Magneto's "Requisitos:  A.  B.  C." case relies on;
  // collapsing it here first would destroy that signal before it's read.
  // Each resulting description line / requirement item gets the normal
  // whitespace collapse applied to it individually right below instead.
  const lines = withSections
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const split = splitRequirementsSections(lines);
  const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();
  // Bug real confirmado en vivo 2026-08-12 (Elempleo, "Profesional Junior de
  // Desarrollos BI"): sus ítems de "Requisitos:" vienen con un glifo de
  // viñeta propio ("•\tFormación: Ingeniero de Sistemas") — sin esto, el
  // bullet real del <li> que ya renderiza el panel quedaría duplicado con
  // el "•" literal del texto fuente. Solo quita el glifo + espacio inicial,
  // nunca toca el resto del contenido.
  const stripBulletPrefix = (s: string) => s.replace(/^[•▪●‣·*-]\s*/, '');
  requirements.push(...split.requirements.map((s) => stripBulletPrefix(normalize(s))));

  return { description: split.description.map(normalize).join('\n'), requirements };
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
