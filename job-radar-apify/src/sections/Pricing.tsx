import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../auth/auth-provider.js";
import { pricingPlans } from "../lib/pricing-plans.js";
import { usePageMeta } from "../lib/use-page-meta.js";

const WOMPI_CHECKOUT_URL = "https://checkout.wompi.co/p/";

export default function Pricing() {
  usePageMeta({
    title: "Planes y precios — BuscoTrabajo",
    description:
      "Plan Gratis con acceso ilimitado a vacantes con más de 48h publicadas, o Pro para ver resultados desde el momento en que se publican."
  });

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
    <section className="min-h-screen px-4 py-16" style={{ backgroundColor: "#fafafa" }}>
      <div className="max-w-3xl mx-auto">
        <div className="text-center mb-10">
          <h1 className="text-3xl font-bold mb-2 font-heading" style={{ color: "#0e0f10" }}>
            Elige tu plan
          </h1>
          <p className="text-sm text-muted-foreground">
            Sin permanencia — activa Pro cuando lo necesites, cancela cuando quieras.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {/* Free plan card */}
          <div className="rounded-2xl border border-[#e6e8e4] bg-[#ffffff] p-6 flex flex-col">
            <span className="text-xs font-mono uppercase tracking-widest text-ink-faint mb-2">
              {freePlan.name}
            </span>
            <p className="text-3xl font-bold mb-4" style={{ color: "#0e0f10" }}>
              {freePlan.price}
            </p>
            <ul className="space-y-2.5 mb-6 flex-1">
              {freePlan.features.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm text-muted-foreground">
                  <span className="text-primary mt-0.5">✓</span>
                  {f}
                </li>
              ))}
            </ul>
            {isAuthenticated ? (
              <Link
                to="/dashboard"
                className="text-center px-4 py-3 rounded-lg border border-[#d3d6cf] text-foreground text-sm font-semibold hover:bg-[#f1f2f0] transition-all"
              >
                Ir al dashboard
              </Link>
            ) : (
              <Link
                to="/dashboard"
                className="text-center px-4 py-3 rounded-lg border border-[#d3d6cf] text-foreground text-sm font-semibold hover:bg-[#f1f2f0] transition-all"
              >
                {freePlan.cta}
              </Link>
            )}
          </div>

          {/* Pro plan card */}
          <div className="relative rounded-2xl border-2 border-primary bg-[#ffffff] p-6 flex flex-col">
            <span className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-xs font-mono font-semibold bg-primary text-primary-foreground">
              Más popular
            </span>
            <span className="text-xs font-mono uppercase tracking-widest text-primary mb-2">
              {proPlan.name}
            </span>
            <p className="text-3xl font-bold mb-4" style={{ color: "#0e0f10" }}>
              {proPlan.price}{" "}
              <span className="text-sm font-normal text-muted-foreground">{proPlan.period}</span>
            </p>
            <ul className="space-y-2.5 mb-6 flex-1">
              {proPlan.features.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm text-muted-foreground">
                  <span className="text-primary mt-0.5">✓</span>
                  {f}
                </li>
              ))}
            </ul>

            {tier === "pro" && (
              <p className="text-center text-sm text-primary font-mono py-3">
                🎉 Ya eres suscriptor Pro
              </p>
            )}
            <button
              onClick={handleSubscribe}
              disabled={busy}
              className="px-4 py-3 rounded-lg bg-primary hover:bg-primary text-primary-foreground font-bold text-sm transition-all disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {busy ? (
                <>
                  <span className="w-3.5 h-3.5 rounded-full border-2 border-primary-foreground border-t-transparent animate-spin" />
                  Redirigiendo a Wompi...
                </>
              ) : tier === "pro" ? (
                "Renovar ahora (30 días más)"
              ) : (
                proPlan.cta
              )}
            </button>
            {error && <p className="text-xs text-destructive font-mono mt-3 text-center">{error}</p>}
          </div>
        </div>

        {/* Trust row */}
        <div className="flex items-center justify-center gap-2 mt-8 text-xs font-mono text-ink-faint">
          <span>🔒</span>
          <span>Pago procesado de forma segura por Wompi</span>
          <span className="px-2 py-0.5 rounded-full bg-accent/10 text-accent border border-accent/30">
            Sandbox
          </span>
        </div>

        <button
          onClick={() => {
            refreshTier();
            navigate("/dashboard");
          }}
          className="w-full mt-6 text-xs text-muted-foreground hover:text-foreground font-mono text-center"
        >
          ← Volver al Dashboard
        </button>
      </div>
    </section>
  );
}
