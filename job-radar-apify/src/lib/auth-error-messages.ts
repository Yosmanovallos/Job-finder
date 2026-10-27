// Supabase's auth error strings arrive in English straight from its API.
// This maps the handful that actually occur in this app to Spanish, and
// flags the one that means "the deployed Supabase key/project is wrong"
// rather than anything the user did.

type Translation = string | ((match: RegExpMatchArray) => string);

// Supabase lists the required character classes literally, e.g.
// "abcdefghijklmnopqrstuvwxyz, ABCDEFGHIJKLMNOPQRSTUVWXYZ, 0123456789".
function describeRequiredCharacters(list: string): string {
  const groups = list.split(/,\s*/).filter(Boolean);
  const required = groups.map((group) =>
    /^[a-z]+$/.test(group)
      ? "una minúscula"
      : /^[A-Z]+$/.test(group)
        ? "una mayúscula"
        : /^[0-9]+$/.test(group)
          ? "un número"
          : "un símbolo (por ejemplo ! @ # $)"
  );
  const unique = [...new Set(required)];
  const text =
    unique.length > 1 ? `${unique.slice(0, -1).join(", ")} y ${unique[unique.length - 1]}` : unique[0];
  return `La contraseña debe incluir al menos ${text ?? "un carácter de cada tipo requerido"}.`;
}

const ERROR_MAP: Array<[RegExp, Translation]> = [
  [
    /invalid api key/i,
    "Error de configuración del servidor (no es tu culpa). Ya quedó registrado — vuelve a intentar en unos minutos."
  ],
  [/invalid login credentials/i, "Correo o contraseña incorrectos."],
  [
    /email not confirmed/i,
    "Debes confirmar tu correo antes de iniciar sesión. Revisa tu bandeja de entrada (y spam)."
  ],
  [/user already registered/i, "Ya existe una cuenta con este correo. Intenta iniciar sesión."],
  [
    /password is known to be weak|easy to guess|pwned/i,
    "Esta contraseña es demasiado común o apareció en filtraciones de datos. Elige otra más difícil de adivinar (por ejemplo, varias palabras con números)."
  ],
  [
    /password should be at least (\d+)/i,
    (m) => `La contraseña debe tener al menos ${m[1]} caracteres.`
  ],
  [/password should contain at least one character of each:\s*(.+)$/i, (m) => describeRequiredCharacters(m[1])],
  [/should be different from the old password/i, "La nueva contraseña debe ser distinta a la anterior."],
  [
    /email address .* is invalid|unable to validate email address|invalid format/i,
    "Ese correo no es válido. Revisa que esté bien escrito (por ejemplo, nombre@dominio.com)."
  ],
  [/signups? not allowed/i, "El registro no está disponible en este momento. Intenta más tarde o escríbenos."],
  [
    /rate limit|too many requests|only request this after/i,
    "Demasiados intentos. Espera unos segundos e intenta de nuevo."
  ],
  [/failed to fetch|networkerror/i, "No se pudo conectar. Revisa tu conexión a internet e intenta de nuevo."]
];

export function translateAuthError(rawMessage: string | undefined | null): string {
  if (!rawMessage) return "Ocurrió un error inesperado. Intenta de nuevo.";
  for (const [pattern, translation] of ERROR_MAP) {
    const match = rawMessage.match(pattern);
    if (match) return typeof translation === "string" ? translation : translation(match);
  }
  console.warn("[Auth] Mensaje de error de Supabase sin traducir:", rawMessage);
  return "No se pudo completar la acción. Intenta de nuevo o escríbenos si el problema persiste.";
}

export function isSupabaseConfigError(rawMessage: string | undefined | null): boolean {
  return !!rawMessage && /invalid api key/i.test(rawMessage);
}
