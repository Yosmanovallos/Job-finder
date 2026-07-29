import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/auth-provider.js";
import { translateAuthError } from "../lib/auth-error-messages.js";
import { Button } from "../components/ui/button.js";
import { Input } from "../components/ui/input.js";
import { GoogleIcon } from "../components/ui/google-icon.js";

const RESEND_COOLDOWN_S = 30;

export default function Login() {
  const {
    loginWithGoogle,
    loginWithEmail,
    signUpWithEmail,
    sendPasswordReset,
    resendConfirmation,
    configError
  } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const returnTo = searchParams.get("return_to") || "/dashboard";
  const [mode, setMode] = useState<"login" | "signup" | "forgot">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [signupSent, setSignupSent] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  const switchMode = (next: "login" | "signup" | "forgot") => {
    setMode(next);
    setError(null);
    setSignupSent(false);
    setResetSent(false);
  };

  const handleGoogle = async () => {
    setError(null);
    try {
      await loginWithGoogle(returnTo);
    } catch (e: any) {
      setError(translateAuthError(e?.message));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);

    try {
      if (mode === "forgot") {
        const result = await sendPasswordReset(email);
        if (result.error) {
          setError(translateAuthError(result.error));
          return;
        }
        setResetSent(true);
        return;
      }

      const result =
        mode === "login"
          ? await loginWithEmail(email, password)
          : await signUpWithEmail(email, password, returnTo);

      if (result.error) {
        setError(translateAuthError(result.error));
        return;
      }

      if (mode === "signup") {
        setSignupSent(true);
      } else {
        navigate(returnTo);
      }
    } catch (e: any) {
      // signInWithPassword/signUp normally resolve with { error } rather than
      // rejecting, but a network failure (offline, CORS, DNS) does reject —
      // without this catch the button was stuck on "Procesando..." forever.
      setError(translateAuthError(e?.message));
    } finally {
      setBusy(false);
    }
  };

  const handleResend = async () => {
    if (resendCooldown > 0) return;
    setError(null);
    setResendCooldown(RESEND_COOLDOWN_S);
    const result = await resendConfirmation(email);
    if (result.error) setError(translateAuthError(result.error));
  };

  const title =
    mode === "login"
      ? "Inicia sesión"
      : mode === "signup"
        ? "Crea tu cuenta"
        : "Recupera tu contraseña";
  const subtitle =
    mode === "forgot" ? "Te enviamos un enlace para elegir una nueva contraseña." : null;

  return (
    <section className="min-h-screen flex items-center justify-center px-4 bg-background">
      <div className="hud-corners w-full max-w-sm rounded-2xl border border-border bg-card overflow-hidden">
        {/* Same top rail treatment as JobCard/PaywallCard, adapted to a
            horizontal strip — the auth screen is most people's first
            interaction with the product, so it should carry the same
            identity as the rest of the app, not fall back to a bare form. */}
        <div className="h-1.5 bg-gradient-to-r from-green-soft via-primary to-gold-2" />
        <div className="p-6">
          <img src="/BT.png" alt="BuscoTrabajo.co" className="h-6 w-auto mb-4" />
          <h1
            className={`text-xl font-bold text-foreground font-heading ${subtitle ? "mb-1" : "mb-6"}`}
          >
            {title}
          </h1>
          {subtitle && <p className="text-xs text-muted-foreground mb-6 font-mono">{subtitle}</p>}

          {configError && (
            <div className="mb-4 px-3 py-2.5 rounded-lg border border-destructive/30 bg-destructive/10">
              <p className="text-xs text-destructive font-mono">
                El servicio de acceso está teniendo un problema de configuración en el servidor. No
                es algo que puedas arreglar desde aquí — ya quedó registrado, intenta de nuevo en
                unos minutos.
              </p>
            </div>
          )}

          {mode !== "forgot" && (
            <>
              <Button
                type="button"
                variant="google"
                size="lg"
                className="w-full"
                onClick={handleGoogle}
              >
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white">
                  <GoogleIcon className="h-3.5 w-3.5" />
                </span>
                Continuar con Google
              </Button>

              <div className="flex items-center gap-2 mb-4">
                <div className="flex-1 h-px bg-border" />
                <span className="text-[11px] text-ink-faint font-mono">o con tu correo</span>
                <div className="flex-1 h-px bg-border" />
              </div>
            </>
          )}

          {mode === "signup" && signupSent ? (
            <div className="space-y-3">
              <p className="text-sm text-primary font-mono">
                Revisa tu correo para confirmar la cuenta antes de iniciar sesión.
              </p>
              <button
                onClick={handleResend}
                disabled={resendCooldown > 0}
                className="text-xs text-muted-foreground hover:text-foreground font-mono disabled:opacity-50"
              >
                {resendCooldown > 0
                  ? `Reenviar correo (${resendCooldown}s)`
                  : "¿No te llegó? Reenviar correo de confirmación"}
              </button>
            </div>
          ) : mode === "forgot" && resetSent ? (
            <p className="text-sm text-primary font-mono">
              Si ese correo tiene una cuenta, te llegó un enlace para elegir una nueva contraseña.
              Revisa tu bandeja (y spam).
            </p>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-3">
              <Input
                type="email"
                required
                placeholder="tucorreo@ejemplo.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              {mode !== "forgot" && (
                <Input
                  type="password"
                  required
                  minLength={mode === "signup" ? 8 : undefined}
                  placeholder={
                    mode === "signup" ? "Contraseña (mínimo 8 caracteres)" : "Contraseña"
                  }
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              )}

              {mode === "login" && (
                <button
                  type="button"
                  onClick={() => switchMode("forgot")}
                  className="text-xs text-muted-foreground hover:text-foreground font-mono"
                >
                  ¿Olvidaste tu contraseña?
                </button>
              )}

              {error && <p className="text-xs text-destructive font-mono">{error}</p>}

              <Button type="submit" size="lg" className="w-full" disabled={busy}>
                {busy
                  ? "Procesando..."
                  : mode === "login"
                    ? "Iniciar sesión"
                    : mode === "signup"
                      ? "Crear cuenta"
                      : "Enviar enlace de recuperación"}
              </Button>
            </form>
          )}

          {mode === "forgot" ? (
            <button
              onClick={() => switchMode("login")}
              className="w-full mt-4 text-xs text-muted-foreground hover:text-foreground font-mono"
            >
              ¿Ya la recordaste? Inicia sesión
            </button>
          ) : (
            <button
              onClick={() => switchMode(mode === "login" ? "signup" : "login")}
              className="w-full mt-4 text-xs text-muted-foreground hover:text-foreground font-mono"
            >
              {mode === "login"
                ? "¿No tienes cuenta? Regístrate"
                : "¿Ya tienes cuenta? Inicia sesión"}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
