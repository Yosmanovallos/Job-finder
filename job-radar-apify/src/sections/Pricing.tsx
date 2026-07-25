import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/auth-provider.js";
import { PRO_MONTHLY_PRICE_COP, formatCOP } from "../config.js";

const WOMPI_CHECKOUT_URL = "https://checkout.wompi.co/p/";

export default function Pricing() {
  const { isAuthenticated, tier, accessToken, user, refreshTier } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubscribe = async () => {
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const res = await fetch('/api/checkout/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`
        }
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'No se pudo iniciar el pago.');
      }

      const data = await res.json();

      // Wompi's hosted Web Checkout is a plain GET redirect with the
      // integrity signature computed server-side (never in the frontend).
      const form = document.createElement('form');
      form.method = 'GET';
      form.action = WOMPI_CHECKOUT_URL;

      const fields: Record<string, string> = {
        'public-key': data.publicKey,
        currency: data.currency,
        'amount-in-cents': String(data.amountInCents),
        reference: data.reference,
        'signature:integrity': data.signatureIntegrity,
        'redirect-url': `${window.location.origin}/dashboard`,
        'customer-data:email': user?.email || ''
      };

      for (const [name, value] of Object.entries(fields)) {
        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = name;
        input.value = value;
        form.appendChild(input);
      }

      document.body.appendChild(form);
      form.submit();
    } catch (e: any) {
      setError(e?.message || 'Ocurrió un error iniciando el pago.');
      setBusy(false);
    }
  };

  return (
    <section className="min-h-screen flex items-center justify-center px-4" style={{ backgroundColor: "#0A0B0D" }}>
      <div className="w-full max-w-md p-6 rounded-2xl border border-[#262A31] bg-[#131519] text-center">
        <span className="inline-block px-3 py-1 rounded-full text-xs font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 mb-4">
          Plan Pro
        </span>
        <h1 className="text-3xl font-bold text-slate-100 mb-2 font-heading">
          {formatCOP(PRO_MONTHLY_PRICE_COP)} <span className="text-base text-slate-400 font-normal">COP / mes</span>
        </h1>
        <p className="text-sm text-slate-400 mb-6">
          Acceso 100% ilimitado a todas las vacantes desde el minuto cero, sin esperar las 48h de gracia.
        </p>

        {tier === 'pro' ? (
          <p className="text-sm text-emerald-400 font-mono">Ya eres suscriptor Pro 🎉</p>
        ) : (
          <>
            <button
              onClick={handleSubscribe}
              disabled={busy}
              className="w-full px-4 py-3 rounded-lg bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold text-sm transition-all disabled:opacity-50"
            >
              {busy ? 'Redirigiendo a Wompi...' : '🔓 Suscribirme con Wompi'}
            </button>
            {error && <p className="text-xs text-red-400 font-mono mt-3">{error}</p>}
            <p className="text-[11px] text-slate-500 font-mono mt-3">
              Pasarela de pago en modo de prueba (sandbox).
            </p>
          </>
        )}

        <button
          onClick={() => { refreshTier(); navigate('/dashboard'); }}
          className="w-full mt-4 text-xs text-slate-400 hover:text-slate-200 font-mono"
        >
          Volver al Dashboard
        </button>
      </div>
    </section>
  );
}
