import { useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../auth/auth-provider.js";
import { PRO_MONTHLY_PRICE_COP, formatCOP } from "../config.js";

export default function Account() {
  const { isAuthenticated, loading, user, tier, logout } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      navigate("/login");
    }
  }, [loading, isAuthenticated, navigate]);

  const handleLogout = async () => {
    await logout();
    navigate("/");
  };

  if (loading || !isAuthenticated) {
    return (
      <section
        className="min-h-screen flex items-center justify-center"
        style={{ backgroundColor: "#0A0B0D" }}
      >
        <div className="w-6 h-6 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" />
      </section>
    );
  }

  return (
    <section className="min-h-screen px-4 py-16" style={{ backgroundColor: "#0A0B0D" }}>
      <div className="max-w-lg mx-auto">
        <h1 className="text-2xl font-bold mb-8 font-heading" style={{ color: "#F4F5F7" }}>
          Mi cuenta
        </h1>

        <div className="rounded-2xl border border-[#262A31] bg-[#131519] p-6 space-y-5">
          <div>
            <p className="text-xs font-mono text-slate-500 mb-1">Correo</p>
            <p className="text-sm text-slate-100">{user?.email}</p>
          </div>

          <div className="h-px bg-[#262A31]" />

          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-mono text-slate-500 mb-1">Plan actual</p>
              <span
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-semibold ${
                  tier === "pro"
                    ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
                    : "bg-amber-500/10 text-amber-400 border border-amber-500/30"
                }`}
              >
                {tier === "pro" ? "🌟 Pro" : "FREE"}
              </span>
            </div>

            {tier === "pro" && user?.subscriptionEnd && (
              <div className="text-right">
                <p className="text-xs font-mono text-slate-500 mb-1">Renueva</p>
                <p className="text-sm text-slate-300 font-mono">
                  {new Date(user.subscriptionEnd).toLocaleDateString("es-CO", {
                    day: "2-digit",
                    month: "short",
                    year: "numeric"
                  })}
                </p>
              </div>
            )}
          </div>

          {tier === "free" && (
            <>
              <div className="h-px bg-[#262A31]" />
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <p className="text-sm text-slate-400">
                  Desbloquea acceso inmediato por {formatCOP(PRO_MONTHLY_PRICE_COP)} COP/mes.
                </p>
                <Link
                  to="/pricing"
                  className="px-4 py-2 rounded-lg bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold text-xs transition-all whitespace-nowrap"
                >
                  Ver plan Pro
                </Link>
              </div>
            </>
          )}

          {tier === "pro" && (
            <>
              <div className="h-px bg-[#262A31]" />
              <p className="text-xs text-slate-500 font-mono">
                Para cancelar tu suscripción, escríbenos a{" "}
                <a href="mailto:hola@jobradar.co" className="text-emerald-400">
                  hola@jobradar.co
                </a>
                . Aún no hay cancelación automática desde aquí.
              </p>
            </>
          )}
        </div>

        <button
          onClick={handleLogout}
          className="w-full mt-6 px-4 py-3 rounded-lg border border-[#262A31] text-slate-300 text-sm font-semibold hover:bg-[#1B1E24] hover:border-[#3A404A] transition-all"
        >
          Cerrar sesión
        </button>
      </div>
    </section>
  );
}
