/**
 * Next.js App Router pages stream their data to the browser as
 * self.__next_f.push([1, "..."]) strings. Shared by the Magneto readers
 * (src/sources/magneto.ts, src/direct/ats/magneto.ts).
 */

function safeJson(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
}

/** The page's flight data: every pushed string, decoded and concatenated in order. */
export function flightStream(html: string): string {
  let stream = "";
  for (const match of html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)) {
    const chunk = safeJson(match[1]);
    if (typeof chunk === "string") stream += chunk;
  }
  return stream;
}

/** The JSON object value of `"key":{...}` in `source`, brackets matched outside strings. */
export function objectAfter(source: string, key: string): unknown {
  const at = source.indexOf(`"${key}":{`);
  if (at < 0) return undefined;
  const start = source.indexOf("{", at);
  let depth = 0;
  let inString = false;
  for (let index = start; index < source.length; index++) {
    const char = source[index];
    if (inString) {
      if (char === "\\") index++;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === "{" || char === "[") depth++;
    else if (char === "}" || char === "]") {
      depth--;
      if (depth === 0) return safeJson(source.slice(start, index + 1));
    }
  }
  return undefined;
}
