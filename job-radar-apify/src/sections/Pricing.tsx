import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../auth/auth-provider.js";
import { pricingPlans } from "../lib/pricing-plans.js";

const WOMPI_CHECKOUT_URL = "https://checkout.wompi.co/p/";

export default function Pricing() {
  const { isAuthenticated, tier, accessToken, user, refreshTier } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const freePlan = pricingPlans.find((p) => p.id === "gratis")!;
  const proPlan = pricingPlans.find((p) => p.id === "pro")!;

  const handleSubscribe = async () => {
    if (!isAuthenticated) {
      navigate("/login");
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const res = await fetch("/api/checkout/start", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`
        }
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "No se pudo iniciar el pago.");
      }

      const data = await res.json();

      // Wompi's hosted Web Checkout is a plain GET redirect with the
      // integrity signature computed server-side (never in the frontend).
      const form = document.createElement("form");
      form.method = "GET";
      form.action = WOMPI_CHECKOUT_URL;

      const fields: Record<string, string> = {
        "public-key": data.publicKey,
        currency: data.currency,
        "amount-in-cents": String(data.amountInCents),
        reference: data.reference,
        "signature:integrity": data.signatureIntegrity,
        "redirect-url": `${window.location.origin}/dashboard?checkout=return`,
        "customer-data:email": user?.email || ""
      };

      for (const [name, value] of Object.entries(fields)) {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = name;
        input.value = value;
        form.appendChild(input);
      }

      document.body.appendChild(form);
      form.submit();
    } catch (e: any) {
      setError(e?.message || "Ocurrió un error iniciando el pago.");
      setBusy(false);
    }
  };

  return (
    <section className="min-h-screen px-4 py-16" style={{ backgroundColor: "#0A0B0D" }}>
      <div className="max-w-3xl mx-auto">
        <div className="text-center mb-10">
          <h1 className="text-3xl font-bold mb-2 font-heading" style={{ color: "#F4F5F7" }}>
            Elige tu plan
          </h1>
          <p className="text-sm text-slate-400">
            Sin permanencia — activa Pro cuando lo necesites, cancela cuando quieras.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {/* Free plan card */}
          <div className="rounded-2xl border border-[#262A31] bg-[#131519] p-6 flex flex-col">
            <span className="text-xs font-mono uppercase tracking-widest text-slate-500 mb-2">
              {freePlan.name}
            </span>
            <p className="text-3xl font-bold mb-4" style={{ color: "#F4F5F7" }}>
              {freePlan.price}
            </p>
            <ul className="space-y-2.5 mb-6 flex-1">
              {freePlan.features.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm text-slate-400">
                  <span className="text-emerald-400 mt-0.5">✓</span>
                  {f}
                </li>
              ))}
            </ul>
            {isAuthenticated ? (
              <Link
                to="/dashboard"
                className="text-center px-4 py-3 rounded-lg border border-[#3A404A] text-slate-100 text-sm font-semibold hover:bg-[#1B1E24] transition-all"
              >
                Ir al dashboard
              </Link>
            ) : (
              <Link
                to="/dashboard"
                className="text-center px-4 py-3 rounded-lg border border-[#3A404A] text-slate-100 text-sm font-semibold hover:bg-[#1B1E24] transition-all"
              >
                {freePlan.cta}
              </Link>
            )}
          </div>

          {/* Pro plan card */}
          <div className="relative rounded-2xl border-2 border-emerald-500 bg-[#131519] p-6 flex flex-col">
            <span className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-xs font-mono font-semibold bg-emerald-500 text-slate-950">
              Más popular
            </span>
            <span className="text-xs font-mono uppercase tracking-widest text-emerald-400 mb-2">
              {proPlan.name}
            </span>
            <p className="text-3xl font-bold mb-4" style={{ color: "#F4F5F7" }}>
              {proPlan.price}{" "}
              <span className="text-sm font-normal text-slate-400">{proPlan.period}</span>
            </p>
            <ul className="space-y-2.5 mb-6 flex-1">
              {proPlan.features.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm text-slate-400">
                  <span className="text-emerald-400 mt-0.5">✓</span>
                  {f}
                </li>
              ))}
            </ul>

            {tier === "pro" && (
              <p className="text-center text-sm text-emerald-400 font-mono py-3">
                🎉 Ya eres suscriptor Pro
              </p>
            )}
            <button
              onClick={handleSubscribe}
              disabled={busy}
              className="px-4 py-3 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm transition-all disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {busy ? (
                <>
                  <span className="w-3.5 h-3.5 rounded-full border-2 border-slate-950 border-t-transparent animate-spin" />
                  Redirigiendo a Wompi...
                </>
              ) : tier === "pro" ? (
                "Renovar ahora (30 días más)"
              ) : (
                proPlan.cta
              )}
            </button>
            {error && <p className="text-xs text-red-400 font-mono mt-3 text-center">{error}</p>}
          </div>
        </div>

        {/* Trust row */}
        <div className="flex items-center justify-center gap-2 mt-8 text-xs font-mono text-slate-500">
          <span>🔒</span>
          <span>Pago procesado de forma segura por Wompi</span>
          <span className="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/30">
            Sandbox
          </span>
        </div>

        <button
          onClick={() => {
            refreshTier();
            navigate("/dashboard");
          }}
          className="w-full mt-6 text-xs text-slate-400 hover:text-slate-200 font-mono text-center"
        >
          ← Volver al Dashboard
        </button>
      </div>
    </section>
  );
}
