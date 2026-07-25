import { useEffect } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/auth-provider.js";

// Dedicated landing spot for the Google OAuth redirect. supabase-js exchanges
// the code/hash for a session automatically on load (detectSessionInUrl) —
// this just waits for that to resolve and shows a real loading/error state
// instead of dumping the user straight on /dashboard mid-exchange.
export default function AuthCallback() {
  const { isAuthenticated, loading, configError } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    if (loading || !isAuthenticated) return;
    const returnTo = searchParams.get("return_to") || "/dashboard";
    navigate(returnTo, { replace: true });
  }, [loading, isAuthenticated, navigate, searchParams]);

  if (!loading && !isAuthenticated) {
    return (
      <section
        className="min-h-screen flex items-center justify-center px-4"
        style={{ backgroundColor: "#0A0B0D" }}
      >
        <div className="w-full max-w-sm p-6 rounded-2xl border border-[#262A31] bg-[#131519] text-center">
          <h1 className="text-xl font-bold text-slate-100 mb-2 font-heading">
            No se pudo iniciar sesión
          </h1>
          <p className="text-xs text-slate-400 mb-6 font-mono">
            {configError
              ? "El servicio de acceso tuvo un problema de configuración en el servidor. Intenta de nuevo en unos minutos."
              : "El enlace de autenticación no es válido o expiró. Intenta iniciar sesión de nuevo."}
          </p>
          <Link
            to="/login"
            className="block w-full px-4 py-3 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm transition-all"
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
      style={{ backgroundColor: "#0A0B0D" }}
    >
      <div className="w-6 h-6 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" />
    </section>
  );
}
