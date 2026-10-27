import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/auth-provider.js";
import { translateAuthError } from "../lib/auth-error-messages.js";
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
  // ?mode=signup opens the "Crear cuenta" tab directly (the apply gate's
  // "Crear cuenta con correo" button links here with it).
  const [mode, setMode] = useState<"login" | "signup" | "forgot">(
    searchParams.get("mode") === "signup" ? "signup" : "login"
  );
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
    } catch (e) {
      setError(translateAuthError((e as Error)?.message));
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
    } catch (e) {
      // signInWithPassword/signUp normally resolve with { error } rather than
      // rejecting, but a network failure (offline, CORS, DNS) does reject —
      // without this catch the button was stuck on "Procesando..." forever.
      setError(translateAuthError((e as Error)?.message));
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
  // Sent here by a star/check on a job (src/lib/saved-jobs.tsx) or by
  // "Guardadas": say why, the job is saved once they're in.
  const savingIntent = searchParams.get("intent") === "save" || returnTo.startsWith("/cuenta");
  const subtitle =
    mode === "forgot"
      ? "Te enviamos un enlace para elegir una nueva contraseña."
      : savingIntent
        ? "Así guardamos tus vacantes y las ves desde cualquier dispositivo."
        : null;

  const inputClass =
    "h-12 w-full rounded-xl border-2 border-foreground bg-[#fbfaf6] px-4 text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-4 focus:ring-gold-1/60";
  const tabClass = (tab: "login" | "signup") =>
    `flex-1 h-11 rounded-lg text-sm font-bold transition-colors ${
      mode === tab ? "bg-foreground text-white" : "text-[#3d413e] hover:bg-white"
    }`;

  return (
    <section className="min-h-[calc(100vh-4rem)] bg-gradient-to-b from-green-soft to-white px-4 py-8 md:py-14">
      <div className="mx-auto grid max-w-[1040px] items-stretch gap-6 lg:grid-cols-[1fr_1.05fr]">
        {/* Why sign up — only facts about what an account does today. */}
        <aside className="relative hidden overflow-hidden rounded-[28px] bg-green-deep p-10 text-white lg:flex lg:flex-col lg:justify-between">
          <div aria-hidden="true" className="absolute -right-24 -top-32 h-[420px] w-[420px] rounded-full bg-[radial-gradient(circle,rgba(212,165,55,0.45),rgba(212,165,55,0)_65%)]" />
          <div className="relative">
            <img src="/BT.png" alt="" className="h-8 w-auto rounded bg-white p-1" />
            <p className="mt-10 font-heading text-[40px] font-bold leading-[1.05] tracking-[-0.03em]">
              Tu búsqueda de empleo, en un solo lugar
            </p>
          </div>
          <ul className="relative mt-10 space-y-4 text-[17px] leading-snug text-[#cfe7da]">
            {[
              "Vacantes de LinkedIn, Computrabajo, Elempleo y más, sin duplicados.",
              "Guarda vacantes y marca las que ya aplicaste.",
              "Gratis. Te postulas siempre en la oferta original."
            ].map((line) => (
              <li key={line} className="flex gap-3">
                <span aria-hidden="true" className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-gold-2 text-sm font-bold text-[#2a1d06]">✓</span>
                {line}
              </li>
            ))}
          </ul>
        </aside>

        <div className="ink-card rounded-[28px] bg-white p-6 md:p-9 md:shadow-[8px_8px_0_hsl(var(--foreground))]">
          <img src="/BT.png" alt="BuscoTrabajo.co" className="mb-6 h-7 w-auto lg:hidden" />

          {mode !== "forgot" && (
            <div role="tablist" aria-label="Acceso" className="mb-6 flex gap-1 rounded-xl border-2 border-foreground bg-[#f4f5f2] p-1">
              <button type="button" role="tab" aria-selected={mode === "login"} onClick={() => switchMode("login")} className={tabClass("login")}>
                Iniciar sesión
              </button>
              <button type="button" role="tab" aria-selected={mode === "signup"} onClick={() => switchMode("signup")} className={tabClass("signup")}>
                Crear cuenta
              </button>
            </div>
          )}

          <h1 className={`font-heading text-[28px] font-bold leading-tight tracking-[-0.03em] text-foreground md:text-[32px] ${subtitle || mode === "signup" ? "mb-1.5" : "mb-6"}`}>
            {title}
          </h1>
          {subtitle && <p className="mb-6 text-[15px] text-[#3d413e]">{subtitle}</p>}
          {mode === "signup" && !subtitle && (
            <p className="mb-6 text-[15px] text-[#3d413e]">Es gratis y toma menos de un minuto.</p>
          )}

          {configError && (
            <div className="mb-4 rounded-xl border-2 border-destructive/40 bg-destructive/10 px-4 py-3">
              <p className="text-sm text-destructive">
                El servicio de acceso está teniendo un problema de configuración en el servidor. No
                es algo que puedas arreglar desde aquí — ya quedó registrado, intenta de nuevo en
                unos minutos.
              </p>
            </div>
          )}

          {mode !== "forgot" && (
            <>
              <button
                type="button"
                onClick={handleGoogle}
                className="ink-card-sm ink-lift flex h-12 w-full items-center justify-center gap-3 rounded-xl bg-white text-base font-bold text-foreground"
              >
                <GoogleIcon className="h-5 w-5" />
                {mode === "signup" ? "Registrarme con Google" : "Continuar con Google"}
              </button>

              <div className="my-5 flex items-center gap-3">
                <div className="h-0.5 flex-1 bg-foreground/10" />
                <span className="text-sm text-muted-foreground">o con tu correo</span>
                <div className="h-0.5 flex-1 bg-foreground/10" />
              </div>
            </>
          )}

          {mode === "signup" && signupSent ? (
            <div className="space-y-4 rounded-xl border-2 border-foreground bg-green-soft p-5">
              <p className="font-bold text-primary">
                Revisa tu correo para confirmar la cuenta antes de iniciar sesión.
              </p>
              <button
                onClick={handleResend}
                disabled={resendCooldown > 0}
                className="text-sm font-semibold text-foreground underline disabled:opacity-50 disabled:no-underline"
              >
                {resendCooldown > 0
                  ? `Reenviar correo (${resendCooldown}s)`
                  : "¿No te llegó? Reenviar correo de confirmación"}
              </button>
            </div>
          ) : mode === "forgot" && resetSent ? (
            <p className="rounded-xl border-2 border-foreground bg-green-soft p-5 font-bold text-primary">
              Si ese correo tiene una cuenta, te llegó un enlace para elegir una nueva contraseña.
              Revisa tu bandeja (y spam).
            </p>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="login-email" className="mb-1.5 block text-sm font-bold text-foreground">
                  Correo electrónico
                </label>
                <input
                  id="login-email"
                  type="email"
                  autoComplete="email"
                  required
                  placeholder="tucorreo@ejemplo.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={inputClass}
                />
              </div>
              {mode !== "forgot" && (
                <div>
                  <div className="mb-1.5 flex items-baseline justify-between">
                    <label htmlFor="login-password" className="block text-sm font-bold text-foreground">
                      Contraseña
                    </label>
                    {mode === "login" && (
                      <button
                        type="button"
                        onClick={() => switchMode("forgot")}
                        className="text-sm font-semibold text-primary hover:underline"
                      >
                        ¿La olvidaste?
                      </button>
                    )}
                  </div>
                  <input
                    id="login-password"
                    type="password"
                    autoComplete={mode === "signup" ? "new-password" : "current-password"}
                    required
                    minLength={mode === "signup" ? 8 : undefined}
                    placeholder={mode === "signup" ? "Mínimo 8 caracteres" : "Tu contraseña"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className={inputClass}
                  />
                </div>
              )}

              {error && (
                <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={busy}
                className={`ink-card-sm ink-lift flex h-12 w-full items-center justify-center rounded-xl text-base font-bold disabled:opacity-60 ${
                  mode === "signup" ? "bg-gold-2 text-[#2a1d06]" : "bg-primary text-white"
                }`}
              >
                {busy
                  ? "Procesando..."
                  : mode === "login"
                    ? "Iniciar sesión"
                    : mode === "signup"
                      ? "Crear cuenta gratis"
                      : "Enviar enlace de recuperación"}
              </button>
            </form>
          )}

          {mode === "forgot" ? (
            <button
              onClick={() => switchMode("login")}
              className="mt-5 w-full text-sm font-semibold text-primary hover:underline"
            >
              ← Volver a iniciar sesión
            </button>
          ) : mode === "signup" ? (
            <p className="mt-5 text-center text-xs text-muted-foreground">
              Al crear tu cuenta aceptas los{" "}
              <Link to="/legal/terminos" className="underline hover:text-foreground">Términos de uso</Link> y la{" "}
              <Link to="/legal/privacidad" className="underline hover:text-foreground">Política de privacidad</Link>.
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
