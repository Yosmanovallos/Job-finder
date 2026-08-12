import { useEffect, useRef, useState } from "react";
import { ChevronDown, Check, Search, Lock } from "lucide-react";
import { useAuth } from "../../auth/auth-provider.js";
import type { ModelDescriptor, ProviderId } from "../../ai-gateway/types.js";

/**
 * Fase 11 de docs/RESUME-STUDIO-PLAN.md — selector "Choose a model" del
 * header del Studio, conectado al Provider/Model Registry (Fase 4) + al
 * estado de conexión BYOK real (Fase 5/6, mismo `GET /api/ai/providers`
 * que ya usa `AccountAiProviders.tsx`, más un `GET /api/ai/models` nuevo
 * que trae el catálogo real de cada proveedor CONECTADO — nunca un
 * catálogo inventado para uno que no lo está).
 *
 * `value === null` es siempre válido y es el default: "el único modelo
 * Gemini operador-financiado de siempre" — decisión explícita del plan
 * aprobado, cambiar de modelo NUNCA debe requerir tener BYOK conectado.
 * Cambiar la selección aquí no toca `document_json` ni dispara ninguna
 * llamada — solo afecta qué modelo usará la PRÓXIMA acción de IA
 * (reescritura de sección o "Regenerar desde cero").
 *
 * Persistencia (decisión documentada en docs/RESUME-STUDIO-PLAN.md, fila
 * 11): 100% client-side, vive en el `useState` de `ResumeStudio.tsx` — no
 * en una columna nueva de `cv_generations`. Ambos call sites reales
 * (reescritura de sección, regenerar) ya son stateless y reciben sus
 * parámetros del cliente en cada request; no hay ningún camino
 * server-initiated que necesite sobrevivir un refresh sin que el cliente
 * se lo repita. Perder la selección al recargar la página es aceptable
 * (vuelve al default seguro, nunca a un estado roto) y evita una
 * migración + columna aditiva para un dato puramente de presentación de
 * la sesión actual del modal.
 */
export interface SelectedByokModel {
  providerId: ProviderId;
  modelId: string;
}

interface ModelPickerGroup {
  providerId: ProviderId;
  connected: boolean;
  models: ModelDescriptor[];
}

const PROVIDER_NAMES: Record<string, string> = {
  google: "Google Gemini",
  anthropic: "Anthropic (Claude)",
  openai: "OpenAI",
  openrouter: "OpenRouter",
  ollama: "Ollama (local)"
};

const OPERATOR_DEFAULT_LABEL = "Gemini — incluido";

export interface ModelPickerProps {
  value: SelectedByokModel | null;
  onChange: (value: SelectedByokModel | null) => void;
}

export function ModelPicker({ value, onChange }: ModelPickerProps) {
  const { accessToken } = useAuth();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [groups, setGroups] = useState<ModelPickerGroup[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || groups !== null) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/ai/models", {
          headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined
        });
        if (cancelled) return;
        if (!res.ok) {
          setLoadError("No se pudieron cargar tus proveedores conectados.");
          return;
        }
        const body = (await res.json()) as { providers: ModelPickerGroup[] };
        if (!cancelled) setGroups(body.providers);
      } catch {
        if (!cancelled) setLoadError("No se pudieron cargar tus proveedores conectados.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, groups, accessToken]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const selectedModel = value
    ? groups?.find((g) => g.providerId === value.providerId)?.models.find((m) => m.modelId === value.modelId)
    : undefined;
  const selectedLabel = value ? (selectedModel?.displayName ?? value.modelId) : OPERATOR_DEFAULT_LABEL;

  const q = query.trim().toLowerCase();
  const matches = (text: string) => !q || text.toLowerCase().includes(q);

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Modelo para la próxima acción de IA — nunca cambia el documento actual"
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-mono font-medium text-foreground hover:border-primary/50 transition-colors max-w-[200px]"
      >
        <span className="truncate">{selectedLabel}</span>
        <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute z-30 mt-1 right-0 w-80 rounded-lg border border-border bg-card shadow-lg overflow-hidden hud-corners"
        >
          <div className="p-2 border-b border-border">
            <div className="flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-1.5">
              <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar modelo..."
                className="flex-1 min-w-0 bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
              />
            </div>
          </div>

          <div className="max-h-80 overflow-y-auto">
            {matches(OPERATOR_DEFAULT_LABEL) && (
              <button
                type="button"
                role="option"
                aria-selected={value === null}
                onClick={() => {
                  onChange(null);
                  setOpen(false);
                }}
                className={`w-full text-left px-3 py-2 flex items-center justify-between gap-2 hover:bg-muted/60 border-b border-border ${
                  value === null ? "bg-primary/5" : ""
                }`}
              >
                <span className="min-w-0">
                  <span className="block text-xs font-medium text-foreground">{OPERATOR_DEFAULT_LABEL}</span>
                  <span className="block text-[10px] text-muted-foreground">Sin conectar nada — siempre disponible</span>
                </span>
                {value === null && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
              </button>
            )}

            {loadError && <p className="px-3 py-2 text-xs text-destructive font-mono">{loadError}</p>}
            {groups === null && !loadError && <p className="px-3 py-2 text-xs text-muted-foreground">Cargando...</p>}

            {groups?.map((group) => {
              const name = PROVIDER_NAMES[group.providerId] ?? group.providerId;
              if (!group.connected) {
                if (!matches(name)) return null;
                return (
                  <div key={group.providerId} className="px-3 py-2 border-b border-border last:border-b-0">
                    <p className="text-[10px] font-mono uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                      <Lock className="h-3 w-3" /> {name}
                    </p>
                    <a
                      href="/cuenta/ai/providers"
                      target="_blank"
                      rel="noreferrer"
                      className="text-[11px] text-primary hover:underline"
                    >
                      Conectar tu API key →
                    </a>
                  </div>
                );
              }
              const filtered = group.models.filter((m) => matches(`${name} ${m.displayName} ${m.modelId}`));
              if (filtered.length === 0) return null;
              return (
                <div key={group.providerId} className="border-b border-border last:border-b-0">
                  <p className="px-3 pt-2 pb-1 text-[10px] font-mono uppercase tracking-wide text-muted-foreground">{name}</p>
                  {filtered.map((m) => {
                    const selected = value?.providerId === group.providerId && value?.modelId === m.modelId;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        onClick={() => {
                          onChange({ providerId: group.providerId, modelId: m.modelId });
                          setOpen(false);
                        }}
                        className={`w-full text-left px-3 py-2 flex items-center justify-between gap-2 hover:bg-muted/60 ${
                          selected ? "bg-primary/5" : ""
                        }`}
                      >
                        <span className="text-xs text-foreground truncate">{m.displayName}</span>
                        {selected && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
