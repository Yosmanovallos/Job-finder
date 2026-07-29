import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Mail, Check, X } from "lucide-react";
import { Job } from "../sources/types.js";
import { useAuth } from "../auth/auth-provider.js";
import { translateAuthError } from "../lib/auth-error-messages.js";
import { Button } from "./ui/button.js";
import { GoogleIcon } from "./ui/google-icon.js";

export interface ApplyGateModalProps {
  job: Job;
  onClose: () => void;
}

// Shown instead of sending an anonymous visitor straight to the external
// posting when they click "Aplicar" — captures the lead at the moment of
// real intent, same pattern JobLeads uses. Dismissible (X, backdrop, Esc)
// unlike RoleOnboardingModal: this interrupts one action, not the whole app.
export function ApplyGateModal({ job, onClose }: ApplyGateModalProps) {
  const { loginWithGoogle, signUpWithEmail } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
    } catch (e: any) {
      setError(translateAuthError(e?.message));
      setBusy(false);
    }
  };

  const handleEmail = () => {
    navigate(`/login?return_to=${encodeURIComponent(returnTo)}`);
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ background: "rgba(14,15,16,0.45)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="hud-corners w-full max-w-md rounded-2xl border border-border bg-card p-6 sm:p-8 shadow-lg relative">
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar"
          className="absolute top-4 right-4 text-muted-foreground hover:text-foreground"
        >
          <X className="h-5 w-5" />
        </button>

        <p className="text-xs font-mono text-ink-faint mb-1 pr-8">
          Para aplicar a
        </p>
        <h2 className="font-heading font-semibold text-xl text-foreground mb-1 leading-snug pr-8">
          {job.title}
        </h2>
        <p className="text-sm text-muted-foreground mb-6">
          {job.company || "Confidencial"} · Crea tu cuenta gratis, sin tarjeta.
        </p>

        {error && (
          <p className="text-xs text-destructive font-mono mb-4">{error}</p>
        )}

        <Button
          type="button"
          variant="google"
          size="lg"
          className="w-full mb-3"
          onClick={handleGoogle}
          disabled={busy}
        >
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white">
            <GoogleIcon className="h-3.5 w-3.5" />
          </span>
          Continuar con Google
        </Button>

        <Button
          type="button"
          variant="outline"
          size="lg"
          className="w-full mb-6"
          onClick={handleEmail}
          disabled={busy}
        >
          <Mail className="h-4 w-4" />
          Continuar con correo electrónico
        </Button>

        <ul className="space-y-2 mb-6">
          {[
            "Vacantes sin duplicados de LinkedIn, Computrabajo, Elempleo y más.",
            "Te mostramos primero lo que coincide con lo que buscas.",
            "Es gratis — el plan Pro es opcional, nunca obligatorio."
          ].map((line) => (
            <li key={line} className="flex items-start gap-2 text-xs text-muted-foreground">
              <Check className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
              {line}
            </li>
          ))}
        </ul>

        <p className="text-[11px] text-ink-faint text-center">
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
  );
}
