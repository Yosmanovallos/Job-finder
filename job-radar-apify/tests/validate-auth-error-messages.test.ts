import assert from "node:assert/strict";
import test from "node:test";
import { translateAuthError } from "../src/lib/auth-error-messages.js";

const GENERIC = "No se pudo completar la acción. Intenta de nuevo o escríbenos si el problema persiste.";

/**
 * Raw strings are the exact messages Supabase Auth (GoTrue) returns; the
 * weak/pwned one is the 422 a real signup hit on 2026-10-27.
 */
test("auth errors: every password rule Supabase enforces gets its own Spanish message", () => {
  const pwned = translateAuthError(
    "Password is known to be weak and easy to guess, please choose a different one."
  );
  assert.notEqual(pwned, GENERIC);
  assert.match(pwned, /filtrad|común/i);

  assert.equal(
    translateAuthError("Password should be at least 8 characters."),
    "La contraseña debe tener al menos 8 caracteres."
  );
  assert.equal(
    translateAuthError("Password should be at least 6 characters"),
    "La contraseña debe tener al menos 6 caracteres."
  );

  const chars = translateAuthError(
    "Password should contain at least one character of each: abcdefghijklmnopqrstuvwxyz, ABCDEFGHIJKLMNOPQRSTUVWXYZ, 0123456789"
  );
  assert.notEqual(chars, GENERIC);
  assert.match(chars, /minúscula/);
  assert.match(chars, /mayúscula/);
  assert.match(chars, /número/);
  assert.doesNotMatch(chars, /símbolo/);

  const withSymbols = translateAuthError(
    "Password should contain at least one character of each: abcdefghijklmnopqrstuvwxyz, ABCDEFGHIJKLMNOPQRSTUVWXYZ, 0123456789, !@#$%^&*()_+-=[]{};':\"|<>?,./`~"
  );
  assert.match(withSymbols, /símbolo/);

  assert.notEqual(translateAuthError("New password should be different from the old password."), GENERIC);
});

test("auth errors: signup email problems are explained instead of the generic fallback", () => {
  assert.notEqual(translateAuthError('Email address "foo@example" is invalid'), GENERIC);
  assert.notEqual(translateAuthError("Unable to validate email address: invalid format"), GENERIC);
  assert.notEqual(translateAuthError("Signups not allowed for this instance"), GENERIC);
});

test("auth errors: existing mappings and fallback are preserved", () => {
  assert.equal(translateAuthError("Invalid login credentials"), "Correo o contraseña incorrectos.");
  assert.equal(translateAuthError("User already registered"), "Ya existe una cuenta con este correo. Intenta iniciar sesión.");
  assert.equal(translateAuthError("email rate limit exceeded"), "Demasiados intentos. Espera unos segundos e intenta de nuevo.");
  assert.equal(translateAuthError(undefined), "Ocurrió un error inesperado. Intenta de nuevo.");
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(translateAuthError("something brand new"), GENERIC);
  } finally {
    console.warn = warn;
  }
});
