import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, Lock } from "lucide-react";
import { useAuth } from "../auth/auth-provider.js";
import { RESUME_STUDIO_ENABLED } from "../config.js";
import type { ProviderConnectionStatus, ProviderId } from "../ai-gateway/types.js";

/**
 * Fase 6 de docs/RESUME-STUDIO-PLAN.md (plan aprobado 2026-08-09) —
 * primera superficie visible de BYOK. Ruta `/cuenta/ai/providers` (App.tsx),
 * literal/plana como el resto de las rutas de este proyecto (`/legal/:type`,
 * `/empresas/:slug`) — no se introduce un patrón de rutas anidadas/Outlet
 * nuevo solo para esto. Mismo lenguaje visual que Account.tsx (misma
 * paleta hex `#e6e8e4`/`#ffffff`/`#fafafa`, tarjetas `rounded-2xl`) para
 * que se sienta parte de la misma sección, no una pieza aparte.
 *
 * Solo conectar/desconectar — nunca re-muestra una key ya guardada (§3.2
 * del plan aprobado: "Credentials must NEVER be exposed again after
 * storing"). El backend (Fase 5, src/server/routes/resume-studio.ts) ya
 * hace cumplir esto del lado servidor; esta página ni siquiera pide de
 * vuelta el valor.
 */

const PROVIDER_LABELS: Record<ProviderId, { name: string; description: string }> = {
  google: { name: "Google Gemini", description: "Modelos Gemini vía tu propia API key de Google AI Studio." },
  anthropic: { name: "Anthropic (Claude)", description: "Modelos Claude vía tu propia API key de Anthropic." },
  openai: { name: "OpenAI", description: "Modelos GPT vía tu propia API key de OpenAI." },
  openrouter: { name: "OpenRouter", description: "Cientos de modelos de distintos proveedores vía una sola key de OpenRouter." },
  ollama: { name: "Ollama (local)", description: "Modelos corriendo en tu propia máquina — sin key, solo el endpoint local." }
};

function providerLabel(id: ProviderId): { name: string; description: string } {
  return PROVIDER_LABELS[id] ?? { name: id, description: "" };
}

export default function AccountAiProviders() {
  const { accessToken, tier } = useAuth();
  const hasTierAccess = tier === "pro" || tier === "pro_max";
  // RESUME_STUDIO_ENABLED es un kill-switch de entorno (config.ts, mismo
  // hardcoded-boolean que PAYWALL_ENABLED) — mientras esté en false el
  // mount point de estas rutas en server.ts nunca se ejecuta, así que un
  // fetch aquí caería en el catch-all de la SPA (HTML, no JSON) en vez de
  // un 404 limpio. Cortar antes del fetch en ese caso, no depender de que
  // el catch de la llamada lo maneje con gracia.
  const hasAccess = RESUME_STUDIO_ENABLED && hasTierAccess;

  const [providers, setProviders] = useState<ProviderConnectionStatus[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [connectingId, setConnectingId] = useState<ProviderId | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [labelInput, setLabelInput] = useState("");
  const [connectBusy, setConnectBusy] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  const [confirmDisconnectId, setConfirmDisconnectId] = useState<ProviderId | null>(null);
  const [disconnectBusy, setDisconnectBusy] = useState<ProviderId | null>(null);

  const authHeaders = accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined;

  const fetchProviders = async () => {
    try {
      const res = await fetch("/api/ai/providers", { headers: authHeaders });
      if (!res.ok) {
        setLoadError("No se pudo cargar la lista de proveedores.");
        return;
      }
      const body = (await res.json()) as { providers: ProviderConnectionStatus[] };
      setProviders(body.providers);
      setLoadError(null);
    } catch {
      setLoadError("No se pudo cargar la lista de proveedores.");
    }
  };

  useEffect(() => {
    if (!accessToken || !hasAccess) return;
    void fetchProviders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, hasAccess]);

  const startConnecting = (providerId: ProviderId) => {
    setConnectingId(providerId);
    setApiKeyInput("");
    setLabelInput("");
    setConnectError(null);
  };

  const cancelConnecting = () => {
    setConnectingId(null);
    setApiKeyInput("");
    setLabelInput("");
    setConnectError(null);
  };

  const handleConnect = async () => {
    if (!connectingId) return;
    if (!apiKeyInput.trim()) {
      setConnectError("Ingresa tu API key.");
      return;
    }
    setConnectBusy(true);
    setConnectError(null);
    try {
      const res = await fetch(`/api/ai/providers/${connectingId}/credentials`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: apiKeyInput.trim(), label: labelInput.trim() || undefined })
      });
      const body = await res.json().catch(() => ({}) as { error?: string });
      if (!res.ok) {
        setConnectError((body as { error?: string }).error || "No se pudo conectar el proveedor.");
        return;
      }
      cancelConnecting();
      await fetchProviders();
    } catch {
      setConnectError("No se pudo conectar el proveedor. Intenta de nuevo.");
    } finally {
      setConnectBusy(false);
    }
  };

  const handleDisconnect = async (providerId: ProviderId) => {
    setDisconnectBusy(providerId);
    try {
      const res = await fetch(`/api/ai/providers/${providerId}/credentials`, {
        method: "DELETE",
        headers: authHeaders
      });
      if (res.ok) {
        setConfirmDisconnectId(null);
        await fetchProviders();
      }
    } finally {
      setDisconnectBusy(null);
    }
  };

  return (
    <section className="min-h-screen px-4 py-16" style={{ backgroundColor: "#fafafa" }}>
      <div className="max-w-lg mx-auto">
        <Link to="/cuenta" className="text-xs text-primary hover:text-primary font-mono">
          ← Mi cuenta
        </Link>
        <h1 className="text-2xl font-bold mt-2 mb-2 font-heading" style={{ color: "#0e0f10" }}>
          Proveedores de IA
        </h1>
        <p className="text-sm text-muted-foreground mb-8">
          Conecta tu propia API key para generar tu CV con el modelo que prefieras. Tu key se guarda cifrada — nunca
          se vuelve a mostrar después de guardarla.
        </p>

        {!RESUME_STUDIO_ENABLED ? (
          <div className="rounded-2xl border border-[#e6e8e4] bg-[#ffffff] p-6 flex items-start gap-3">
            <Lock className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
            <p className="text-sm text-foreground font-semibold">
              Esta función todavía no está disponible.
            </p>
          </div>
        ) : !hasTierAccess ? (
          <div className="rounded-2xl border border-[#e6e8e4] bg-[#ffffff] p-6 flex items-start gap-3">
            <Lock className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
            <div>
              <p className="text-sm text-foreground font-semibold mb-1">Esta función requiere Pro o Pro Max.</p>
              <Link to="/pricing" className="text-xs text-primary hover:text-primary font-mono">
                Ver planes →
              </Link>
            </div>
          </div>
        ) : loadError ? (
          <p className="text-xs text-destructive font-mono">{loadError}</p>
        ) : providers === null ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
            <Loader2 className="h-4 w-4 animate-spin" />
            Cargando...
          </div>
        ) : (
          <div className="space-y-4">
            {providers.map((p) => {
              const label = providerLabel(p.providerId);
              const isConnecting = connectingId === p.providerId;
              const isConfirmingDisconnect = confirmDisconnectId === p.providerId;
              return (
                <div key={p.providerId} className="rounded-2xl border border-[#e6e8e4] bg-[#ffffff] p-6">
                  <div className="flex items-start justify-between gap-3 mb-1">
                    <div>
                      <p className="text-sm font-semibold text-foreground">{label.name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{label.description}</p>
                    </div>
                    <span
                      className={`shrink-0 px-2.5 py-1 rounded-full text-[11px] font-mono font-semibold border ${
                        p.connected
                          ? "bg-primary/10 text-primary border-primary/30"
                          : "bg-ink-faint/10 text-muted-foreground border-ink-faint/30"
                      }`}
                    >
                      {p.connected ? "● Conectado" : "○ No conectado"}
                    </span>
                  </div>

                  {p.connected && (
                    <p className="text-xs text-ink-faint font-mono mt-2">
                      {p.label ? `${p.label} · ` : ""}····{p.last4}
                      {p.validatedAt ? ` · validado ${new Date(p.validatedAt).toLocaleDateString("es-CO")}` : ""}
                    </p>
                  )}

                  <div className="mt-4">
                    {p.connected ? (
                      isConfirmingDisconnect ? (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">¿Desconectar {label.name}?</span>
                          <button
                            onClick={() => setConfirmDisconnectId(null)}
                            disabled={disconnectBusy === p.providerId}
                            className="px-3 py-1.5 rounded-lg border border-[#e6e8e4] text-foreground text-xs font-semibold hover:bg-[#f1f2f0]"
                          >
                            Cancelar
                          </button>
                          <button
                            onClick={() => void handleDisconnect(p.providerId)}
                            disabled={disconnectBusy === p.providerId}
                            className="px-3 py-1.5 rounded-lg bg-destructive text-white text-xs font-bold hover:opacity-90 disabled:opacity-50"
                          >
                            {disconnectBusy === p.providerId ? "Desconectando..." : "Sí, desconectar"}
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirmDisconnectId(p.providerId)}
                          className="px-3 py-1.5 rounded-lg border border-[#e6e8e4] text-foreground text-xs font-semibold hover:bg-[#f1f2f0]"
                        >
                          Desconectar
                        </button>
                      )
                    ) : isConnecting ? (
                      <div className="space-y-2">
                        <input
                          type="password"
                          value={apiKeyInput}
                          onChange={(e) => setApiKeyInput(e.target.value)}
                          placeholder="Tu API key"
                          autoComplete="off"
                          className="w-full px-3 py-2 rounded-lg bg-[#fafafa] border border-[#e6e8e4] text-foreground text-sm focus:outline-none"
                        />
                        <input
                          type="text"
                          value={labelInput}
                          onChange={(e) => setLabelInput(e.target.value)}
                          placeholder="Nombre (opcional, ej. Cuenta personal)"
                          maxLength={100}
                          className="w-full px-3 py-2 rounded-lg bg-[#fafafa] border border-[#e6e8e4] text-foreground text-sm focus:outline-none"
                        />
                        {connectError && <p className="text-xs text-destructive font-mono">{connectError}</p>}
                        <div className="flex gap-2">
                          <button
                            onClick={() => void handleConnect()}
                            disabled={connectBusy}
                            className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground font-bold text-xs disabled:opacity-50"
                          >
                            {connectBusy ? "Probando conexión..." : "Probar y conectar"}
                          </button>
                          <button
                            onClick={cancelConnecting}
                            disabled={connectBusy}
                            className="px-3 py-1.5 rounded-lg border border-[#e6e8e4] text-foreground text-xs font-semibold hover:bg-[#f1f2f0]"
                          >
                            Cancelar
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => startConnecting(p.providerId)}
                        className="px-3 py-1.5 rounded-lg border border-[#e6e8e4] text-foreground text-xs font-semibold hover:bg-[#f1f2f0]"
                      >
                        Conectar
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
