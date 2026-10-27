import { useEffect } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/auth-provider.js";
import { RoleOnboardingModal } from "../components/RoleOnboardingModal.js";
import { trackEvent } from "../lib/analytics.js";
import { AuthShell, AuthSpinner, AuthText, AuthTitle, authPrimaryButtonClass } from "../components/AuthShell.js";

// Dedicated landing spot for the Google OAuth redirect AND the email
// confirmation link — supabase-js exchanges the code/hash for a session
// automatically on load (detectSessionInUrl). This waits for that to
// resolve, then — for a brand new user (preferredRoles still null) — shows
// the "¿qué puestos buscas?" step once before continuing to returnTo.
export default function AuthCallback() {
  const { isAuthenticated, loading, configError, preferredRoles, profileLoaded, saveProfileRoles } =
    useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const returnTo = searchParams.get("return_to") || "/dashboard";
  const needsRoleStep = isAuthenticated && profileLoaded && preferredRoles === null;

  useEffect(() => {
    if (loading || !isAuthenticated || !profileLoaded || needsRoleStep) return;
    navigate(returnTo, { replace: true });
  }, [loading, isAuthenticated, profileLoaded, needsRoleStep, navigate, returnTo]);

  if (needsRoleStep) {
    return (
      <RoleOnboardingModal
        onDone={async (roles) => {
          const result = await saveProfileRoles(roles);
          if (!result.error) {
            trackEvent("onboarding_complete", {
              role_count: roles.length,
              skipped: roles.length === 0
            });
          }
          navigate(returnTo, { replace: true });
        }}
      />
    );
  }

  if (!loading && !isAuthenticated) {
    return (
      <AuthShell>
        <AuthTitle>No se pudo iniciar sesión</AuthTitle>
        <AuthText>
          {configError
            ? "El servicio de acceso tuvo un problema de configuración en el servidor. Intenta de nuevo en unos minutos."
            : "El enlace de autenticación no es válido o expiró. Intenta iniciar sesión de nuevo."}
        </AuthText>
        <Link to="/login" className={authPrimaryButtonClass}>
          Volver a iniciar sesión
        </Link>
      </AuthShell>
    );
  }

  return <AuthSpinner />;
}
