import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Mail, X } from "lucide-react";
import { Job } from "../sources/types.js";
import { useAuth } from "../auth/auth-provider.js";
import { translateAuthError } from "../lib/auth-error-messages.js";
import { GoogleIcon } from "./ui/google-icon.js";
import { jobAnalyticsParams, trackEvent } from "../lib/analytics.js";

export interface ApplyGateModalProps {
  job: Job;
  onClose: () => void;
}

// Shown instead of sending an anonymous visitor straight to the external
// posting when they click "Aplicar" — captures the lead at the moment of
// real intent, same pattern JobLeads uses. Dismissible (X, backdrop, Esc)
// unlike RoleOnboardingModal: this interrupts one action, not the whole app.
export function ApplyGateModal({ job, onClose }: ApplyGateModalProps) {
  const { loginWithGoogle } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const openTracked = useRef(false);

  // Internal route, never the external job.url — loginWithGoogle round-trips
  // this through Supabase's OAuth redirect, and an attacker-supplied
  // external URL there would be an open-redirect after a trusted auth flow.
  // Dashboard reads apply_job on load and opens the *real* job.url itself
  // from its own already-loaded corpus, never from a URL that traveled
  // through the redirect chain.
  const returnTo = `/dashboard?apply_job=${encodeURIComponent(job.jobId)}`;

  const handleGoogle = async () => {
    setError(null);
    setBusy(true);
    try {
      await loginWithGoogle(returnTo);
    } catch (e) {
      setError(translateAuthError((e as Error)?.message));
      setBusy(false);
    }
  };

  const handleEmail = (mode: "signup" | "login") => {
    const params = new URLSearchParams({ return_to: returnTo });
    if (mode === "signup") params.set("mode", "signup");
    navigate(`/login?${params}`);
  };

  useEffect(() => {
    if (!openTracked.current) {
      openTracked.current = true;
      const surface = window.location.pathname.includes("/empleos/")
        ? "job_page"
        : "dashboard_detail";
      trackEvent("apply_gate_open", jobAnalyticsParams(job, surface));
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [job, onClose]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-foreground/50 p-4 backdrop-blur-[2px]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="apply-gate-title"
        className="relative w-full max-w-md overflow-hidden rounded-[24px] border-2 border-foreground bg-white shadow-[8px_8px_0_hsl(var(--foreground))]"
      >
        <div className="bg-gradient-to-b from-green-soft to-white px-6 pb-4 pt-6 sm:px-8 sm:pt-8">
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="absolute right-4 top-4 grid h-10 w-10 place-items-center rounded-xl border-2 border-foreground bg-white text-foreground hover:bg-[#f4f5f2]"
          >
            <X className="h-5 w-5" />
          </button>
          <p className="ink-card-sm mb-3 inline-flex items-center gap-2 rounded-full bg-[#fdf1d3] py-1 pl-2 pr-3 font-mono text-xs font-semibold uppercase tracking-wider shadow-none">
            <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-primary" />
            Para aplicar a
          </p>
          <h2 id="apply-gate-title" className="pr-10 font-heading text-[22px] font-bold leading-snug tracking-[-0.02em] text-foreground">
            {job.title}
          </h2>
          <p className="mt-1.5 text-[15px] text-[#3d413e]">
            {job.company || "Confidencial"} · Crea tu cuenta gratis o inicia sesión para continuar a la oferta original.
          </p>
        </div>

        <div className="px-6 pb-6 sm:px-8 sm:pb-8">
          {error && <p role="alert" className="mb-4 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

          <button
            type="button"
            onClick={handleGoogle}
            disabled={busy}
            className="ink-card-sm ink-lift mb-3 flex h-12 w-full items-center justify-center gap-3 rounded-xl bg-white text-base font-bold text-foreground disabled:opacity-60"
          >
            <GoogleIcon className="h-5 w-5" />
            Continuar con Google
          </button>
          <button
            type="button"
            onClick={() => handleEmail("signup")}
            disabled={busy}
            className="ink-card-sm ink-lift mb-3 flex h-12 w-full items-center justify-center gap-2.5 rounded-xl bg-gold-2 text-base font-bold text-[#2a1d06] disabled:opacity-60"
          >
            <Mail className="h-5 w-5" />
            Crear cuenta con correo
          </button>
          <p className="mb-5 text-center text-sm text-[#3d413e]">
            ¿Ya tienes cuenta?{" "}
            <button type="button" onClick={() => handleEmail("login")} className="font-bold text-primary hover:underline">
              Inicia sesión
            </button>
          </p>

          <ul className="mb-5 space-y-2.5 rounded-xl bg-[#f4f5f2] p-4">
            {[
              "Vacantes sin duplicados de LinkedIn, Computrabajo, Elempleo y más.",
              "Te mostramos primero lo que coincide con lo que buscas.",
              "Es gratis."
            ].map((line) => (
              <li key={line} className="flex items-start gap-2.5 text-sm text-[#3d413e]">
                <span aria-hidden="true" className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-primary text-[11px] font-bold text-white">✓</span>
                {line}
              </li>
            ))}
          </ul>

          <p className="text-center text-xs text-muted-foreground">
            Al crear tu cuenta aceptas nuestros{" "}
            <Link to="/legal/terminos" className="underline hover:text-foreground">
              Términos
            </Link>{" "}
            y la{" "}
            <Link to="/legal/privacidad" className="underline hover:text-foreground">
              Política de Privacidad
            </Link>
            .
          </p>
        </div>
      </div>
    </div>
  );
}
