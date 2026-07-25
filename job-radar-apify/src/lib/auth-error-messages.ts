// Supabase's auth error strings arrive in English straight from its API.
// This maps the handful that actually occur in this app to Spanish, and
// flags the one that means "the deployed Supabase key/project is wrong"
// rather than anything the user did.

const ERROR_MAP: Array<[RegExp, string]> = [
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
  [/password should be at least/i, "La contraseña debe tener al menos 6 caracteres."],
  [
    /rate limit|too many requests|only request this after/i,
    "Demasiados intentos. Espera unos segundos e intenta de nuevo."
  ],
  [/failed to fetch|networkerror/i, "No se pudo conectar. Revisa tu conexión a internet e intenta de nuevo."]
];

export function translateAuthError(rawMessage: string | undefined | null): string {
  if (!rawMessage) return "Ocurrió un error inesperado. Intenta de nuevo.";
  const match = ERROR_MAP.find(([pattern]) => pattern.test(rawMessage));
  if (match) return match[1];
  console.warn("[Auth] Mensaje de error de Supabase sin traducir:", rawMessage);
  return "No se pudo completar la acción. Intenta de nuevo o escríbenos si el problema persiste.";
}

export function isSupabaseConfigError(rawMessage: string | undefined | null): boolean {
  return !!rawMessage && /invalid api key/i.test(rawMessage);
}
