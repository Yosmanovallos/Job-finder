import { useEffect } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/auth-provider.js";
import { RoleOnboardingModal } from "../components/RoleOnboardingModal.js";

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
          await saveProfileRoles(roles);
          navigate(returnTo, { replace: true });
        }}
      />
    );
  }

  if (!loading && !isAuthenticated) {
    return (
      <section
        className="min-h-screen flex items-center justify-center px-4"
        style={{ backgroundColor: "#fafafa" }}
      >
        <div className="w-full max-w-sm p-6 rounded-2xl border border-[#e6e8e4] bg-[#ffffff] text-center">
          <h1 className="text-xl font-bold text-foreground mb-2 font-heading">
            No se pudo iniciar sesión
          </h1>
          <p className="text-xs text-muted-foreground mb-6 font-mono">
            {configError
              ? "El servicio de acceso tuvo un problema de configuración en el servidor. Intenta de nuevo en unos minutos."
              : "El enlace de autenticación no es válido o expiró. Intenta iniciar sesión de nuevo."}
          </p>
          <Link
            to="/login"
            className="block w-full px-4 py-3 rounded-lg bg-primary hover:bg-primary text-primary-foreground font-bold text-sm transition-all"
          >
            Volver a iniciar sesión
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section
      className="min-h-screen flex items-center justify-center"
      style={{ backgroundColor: "#fafafa" }}
    >
      <div className="w-6 h-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
    </section>
  );
}
