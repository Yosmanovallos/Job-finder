import { useEffect, useRef, useState } from "react";
import {
  X,
  Upload,
  FileText,
  Loader2,
  CheckCircle2,
  ChevronUp,
  ChevronDown,
  EyeOff,
  Trash2,
  Download,
  RefreshCw,
  Check
} from "lucide-react";
import { Job } from "../sources/types.js";
import { useAuth } from "../auth/auth-provider.js";
import { Button } from "./ui/button.js";
import type { CvDocument, Claim } from "../cv/cv-document-schema.js";
import type { CvFacts } from "../cv/cv-facts-schema.js";
import type { ModelOption } from "../cv/quota.js";

export interface CvAdjustOverlayProps {
  job: Job;
  onClose: () => void;
}

interface CvProfileStatus {
  exists: boolean;
  hasFacts: boolean;
  updatedAt: string | null;
}

interface QuotaStatus {
  used: number;
  limit: number;
  remaining: number;
  tier: "pro" | "pro_max";
}

// Fase 11 (docs/CV-GENERATION-PLAN.md §6.5.2, §10 fila 11) — mismos
// costos en créditos que `MODEL_OPTION_CREDIT_COST` en src/cv/quota.ts.
// Duplicado a propósito: quota.ts importa `pg` (solo Node), así que este
// archivo de UI no puede importarlo en runtime — solo el tipo
// `ModelOption` cruza la frontera (import type, se elimina al compilar,
// nunca entra al bundle del navegador). Si §6.5.2 cambia estos números,
// hay que actualizar los dos lugares.
const MODEL_OPTION_INFO: Record<
  ModelOption,
  { label: string; credits: number; blurb: string }
> = {
  standard: { label: "Estándar", credits: 3, blurb: "La opción disponible hoy." },
  // Blurbs de "premium"/"compare" describen a propósito una capacidad
  // EN CONSTRUCCIÓN, nunca una ya disponible (revisado con el asesor,
  // Fase 11): sin esto, el badge "Disponible en Pro Max" que ve un Pro
  // (upsell real, §9.1) se leería junto a una promesa de algo que hoy no
  // corre para nadie, ni siquiera para quien ya paga Pro Max.
  premium: { label: "Premium", credits: 5, blurb: "En construcción — un modelo más potente para redactar." },
  compare: {
    label: "Comparar",
    credits: 6,
    blurb: "En construcción — generará con dos modelos y se quedará con el mejor."
  }
};
const MODEL_OPTION_ORDER: ModelOption[] = ["standard", "premium", "compare"];
// Fase 11 decidió (2026-08-09, con el usuario) dejar Premium/Comparar
// visibles-pero-deshabilitadas: no hay cliente Anthropic para "Premium"
// (`reasoning_high` resuelve a "none", verificado en vivo que ningún
// modelo Gemini de la cuenta real es más fuerte que el que ya usa
// "Estándar" en producción) y "Comparar" necesita la Etapa C (score ATS
// determinístico) que no existe en este subproyecto. El backend sigue
// reservando créditos reales para las tres opciones (defensa en
// profundidad), pero la UI nunca deja elegir más que "Estándar".
const RUNNABLE_MODEL_OPTIONS = new Set<ModelOption>(["standard"]);

interface GenerationLookup {
  id: string | null;
  status: string | null;
  document: CvDocument | null;
  facts: CvFacts | null;
}

type Step = "loading" | "setup" | "editor";

// Sondea GET /api/cv/profile mientras el CV subido no tiene facts_json
// todavía — la Etapa A corre fire-and-forget del lado del servidor
// (server.ts, tras POST /api/cv/profile), así que este es el único punto
// donde el cliente se entera de que terminó. Mismo patrón de polling con
// tope de intentos que ya usa Dashboard.tsx para refreshTier tras checkout.
const POLL_INTERVAL_MS = 3000;
const POLL_MAX_ATTEMPTS = 20; // ~60s

function sanitizeDownloadName(input: string): string {
  return input.replace(/[/\\:*?"<>|]/g, "").trim().slice(0, 80) || "CV";
}

interface ModelDropdownProps {
  tier: "pro" | "pro_max";
  value: ModelOption;
  onChange: (option: ModelOption) => void;
  creditsRemaining: number | null;
  label?: string;
}

// Selector estilo Cursor/Claude Code (§6.5, §9.3) — dropdown, no una
// grilla de tarjetas (rediseño 2026-08-09 a pedido explícito, con
// referencia visual del propio Claude Code: botón con la selección
// actual, abre un menú con las opciones, ✓ en la elegida). Pro: solo
// "Estándar" es seleccionable, Premium/Comparar aparecen con el mismo
// lenguaje visual dorado de PaywallCard ("🔒 Disponible en Pro Max" —
// superficie de upsell real). Pro Max: las tres son suyas por plan, pero
// Premium/Comparar no corren un pipeline real todavía (Fase 11, ver
// RUNNABLE_MODEL_OPTIONS) — badge "Próximamente", deliberadamente
// distinto del badge de upsell (no es un gate de tier, es una pieza no
// construida). Un solo componente, reusado en Vista 1 y en "Regenerar
// desde cero" — antes eran dos tratamientos visuales distintos para la
// misma elección.
function ModelDropdown({ tier, value, onChange, creditsRemaining, label }: ModelDropdownProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

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

  const selectedInfo = MODEL_OPTION_INFO[value];
  const selectedCost = tier === "pro_max" ? selectedInfo.credits : null;
  const insufficientCredits =
    tier === "pro_max" && creditsRemaining !== null && selectedCost !== null && creditsRemaining < selectedCost;

  return (
    <div>
      {label && <p className="text-xs font-mono text-muted-foreground mb-1.5">{label}</p>}
      <div ref={containerRef} className="relative inline-block">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="listbox"
          aria-expanded={open}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-foreground hover:border-primary/50 transition-colors"
        >
          <span>{selectedInfo.label}</span>
          {selectedCost !== null && <span className="text-xs font-mono text-muted-foreground">{selectedCost}c</span>}
          <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
        </button>

        {open && (
          <div
            role="listbox"
            className="absolute z-20 mt-1 w-80 rounded-lg border border-border bg-card shadow-lg overflow-hidden hud-corners"
          >
            {MODEL_OPTION_ORDER.map((option) => {
              const info = MODEL_OPTION_INFO[option];
              const runnable = RUNNABLE_MODEL_OPTIONS.has(option);
              const requiresProMax = tier === "pro" && option !== "standard";
              const selectable = runnable && !requiresProMax;
              const selected = value === option;
              return (
                <button
                  key={option}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  disabled={!selectable}
                  onClick={() => {
                    if (!selectable) return;
                    onChange(option);
                    setOpen(false);
                  }}
                  className={`w-full text-left px-3 py-2.5 flex items-start justify-between gap-3 transition-colors border-b border-border last:border-b-0 ${
                    selectable ? "hover:bg-muted/60 cursor-pointer" : "opacity-50 cursor-not-allowed"
                  } ${selected ? "bg-primary/5" : ""}`}
                >
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5">
                      <span className="text-sm font-medium text-foreground">{info.label}</span>
                      {selected && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
                    </span>
                    <span className="block text-xs text-muted-foreground mt-0.5">{info.blurb}</span>
                    {requiresProMax && (
                      <span className="inline-flex items-center gap-1 mt-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide bg-gradient-to-br from-gold-1 to-gold-2 text-gold-ink">
                        🔒 Disponible en Pro Max
                      </span>
                    )}
                    {tier === "pro_max" && !runnable && (
                      <span className="inline-flex items-center px-2 py-0.5 mt-1.5 rounded-full text-[10px] font-semibold uppercase tracking-wide bg-muted text-muted-foreground">
                        Próximamente
                      </span>
                    )}
                  </span>
                  {tier === "pro_max" && (
                    <span className="text-xs font-mono text-muted-foreground shrink-0">{info.credits}c</span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
      {insufficientCredits && (
        <p className="text-xs text-destructive font-mono mt-1.5">
          Te faltan créditos para "{selectedInfo.label}" (tienes {creditsRemaining}, necesitas {selectedCost}).
        </p>
      )}
    </div>
  );
}

// Vista 1 (Setup, §9.3) + Vista 2 (Editor, §9.4) de
// docs/CV-GENERATION-PLAN.md, Fase 7. Overlay de pantalla completa (§9.2)
// — NO un diálogo centrado como ApplyGateModal. Al abrir, GET
// /api/cv/generations?jobId= decide si arranca en el editor (ya existe una
// generación 'completed') o en el setup — nunca vuelve a gastar cuota solo
// por reabrir.
export function CvAdjustOverlay({ job, onClose }: CvAdjustOverlayProps) {
  const { accessToken, tier: sessionTier } = useAuth();
  // Vista 1 (§9.3) solo llega aquí para Pro/Pro Max (JobDetailPanel ya
  // bloquea free) — "pro" es el fallback seguro si el tier todavía no
  // resolvió de la sesión.
  const tier: "pro" | "pro_max" = sessionTier === "pro_max" ? "pro_max" : "pro";
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>("loading");
  const [profile, setProfile] = useState<CvProfileStatus | null>(null);
  const [quota, setQuota] = useState<QuotaStatus | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [pollTimedOut, setPollTimedOut] = useState(false);
  const [modelOption, setModelOption] = useState<ModelOption>("standard");
  const [regenerateModelOption, setRegenerateModelOption] = useState<ModelOption>("standard");

  const [generationId, setGenerationId] = useState<string | null>(null);
  const [cvDocument, setCvDocument] = useState<CvDocument | null>(null);
  const [facts, setFacts] = useState<CvFacts | null>(null);

  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const [downloading, setDownloading] = useState<"pdf" | "docx" | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [regenerateError, setRegenerateError] = useState<string | null>(null);

  const authHeaders = accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined;
  const jsonHeaders = { ...authHeaders, "Content-Type": "application/json" };

  const fetchProfile = async (): Promise<CvProfileStatus | null> => {
    try {
      const res = await fetch("/api/cv/profile", { headers: authHeaders });
      if (!res.ok) return null;
      return (await res.json()) as CvProfileStatus;
    } catch {
      return null;
    }
  };

  const fetchQuota = async (): Promise<QuotaStatus | null> => {
    try {
      const res = await fetch("/api/cv/quota", { headers: authHeaders });
      if (!res.ok) return null;
      return (await res.json()) as QuotaStatus;
    } catch {
      return null;
    }
  };

  // Un solo request en vez de 3 en paralelo (perf, 2026-08-09): cada uno de
  // /api/cv/profile + /api/cv/quota + /api/cv/generations paga por separado
  // el costo de verifySession (red a Supabase Auth + upsert) — medido en
  // vivo, el más lento tardaba >2s solo, y el overlay esperaba a los tres.
  // Solo para la apertura inicial; fetchProfile/fetchQuota individuales
  // siguen usándose para refrescos puntuales (tras subir CV, tras generar).
  const fetchOverlayBootstrap = async (): Promise<{
    profile: CvProfileStatus | null;
    quota: QuotaStatus | null;
    generation: GenerationLookup | null;
  }> => {
    try {
      const res = await fetch(`/api/cv/overlay-bootstrap?jobId=${encodeURIComponent(job.jobId)}`, {
        headers: authHeaders
      });
      if (!res.ok) return { profile: null, quota: null, generation: null };
      return (await res.json()) as { profile: CvProfileStatus; quota: QuotaStatus; generation: GenerationLookup };
    } catch {
      return { profile: null, quota: null, generation: null };
    }
  };

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    (async () => {
      const { profile: p, quota: q, generation: g } = await fetchOverlayBootstrap();
      if (cancelled) return;
      setProfile(p);
      setQuota(q);
      if (g && g.status === "completed" && g.document) {
        setGenerationId(g.id);
        setCvDocument(g.document);
        setFacts(g.facts);
        setStep("editor");
      } else {
        setStep("setup");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  useEffect(() => {
    if (step !== "setup" || !profile || !profile.exists || profile.hasFacts) return;
    let attempts = 0;
    setPollTimedOut(false);
    const interval = setInterval(async () => {
      attempts += 1;
      const p = await fetchProfile();
      if (p) setProfile(p);
      if ((p && p.hasFacts) || attempts >= POLL_MAX_ATTEMPTS) {
        clearInterval(interval);
        if (!p || !p.hasFacts) setPollTimedOut(true);
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, profile?.exists, profile?.hasFacts]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const handleFileSelected = async (file: File) => {
    setUploadError(null);
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/cv/profile", {
        method: "POST",
        headers: authHeaders,
        body: formData
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}) as { error?: string });
        setUploadError(body.error || "No se pudo subir el CV.");
        return;
      }
      setPollTimedOut(false);
      setProfile(await fetchProfile());
    } catch {
      setUploadError("No se pudo subir el CV. Intenta de nuevo.");
    } finally {
      setUploading(false);
    }
  };

  const handleGenerate = async () => {
    setGenerating(true);
    setGenerateError(null);
    try {
      const res = await fetch("/api/cv/generate", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          jobId: job.jobId,
          jobTitle: job.title,
          jobCompany: job.company,
          jobLocation: job.location,
          jobDateText: job.dateText,
          modelOption
        })
      });
      const body = await res.json().catch(() => ({}) as { error?: string; id?: string; document?: CvDocument; facts?: CvFacts });
      if (!res.ok) {
        setGenerateError((body as { error?: string }).error || "No se pudo generar el CV.");
        setQuota(await fetchQuota());
        return;
      }
      setGenerationId(body.id ?? null);
      setCvDocument(body.document ?? null);
      setFacts(body.facts ?? null);
      setQuota(await fetchQuota());
      setStep("editor");
    } catch {
      setGenerateError("No se pudo generar el CV. Intenta de nuevo.");
    } finally {
      setGenerating(false);
    }
  };

  const handleSave = async () => {
    if (!generationId || !cvDocument) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/cv/generations/${generationId}`, {
        method: "PATCH",
        headers: jsonHeaders,
        body: JSON.stringify(cvDocument)
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}) as { error?: string });
        setSaveError(body.error || "No se pudo guardar el CV.");
        return;
      }
      setSavedAt(Date.now());
    } catch {
      setSaveError("No se pudo guardar el CV. Intenta de nuevo.");
    } finally {
      setSaving(false);
    }
  };

  const handleDownload = async (kind: "pdf" | "docx") => {
    if (!generationId) return;
    setDownloading(kind);
    setDownloadError(null);
    try {
      const res = await fetch(`/api/cv/generations/${generationId}/${kind}`, { headers: authHeaders });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}) as { error?: string });
        setDownloadError(body.error || "No se pudo descargar el archivo.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = window.document.createElement("a");
      link.href = url;
      link.download = `CV - ${sanitizeDownloadName(job.title)}.${kind}`;
      window.document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      setDownloadError("No se pudo descargar el archivo. Intenta de nuevo.");
    } finally {
      setDownloading(null);
    }
  };

  const handleRegenerate = async () => {
    if (!generationId) return;
    setRegenerating(true);
    setRegenerateError(null);
    try {
      const res = await fetch(`/api/cv/generations/${generationId}/regenerate`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          jobLocation: job.location,
          jobDateText: job.dateText,
          modelOption: regenerateModelOption
        })
      });
      const body = await res.json().catch(() => ({}) as { error?: string; document?: CvDocument; facts?: CvFacts });
      if (!res.ok) {
        setRegenerateError((body as { error?: string }).error || "No se pudo regenerar el CV.");
        setQuota(await fetchQuota());
        return;
      }
      setCvDocument(body.document ?? null);
      if (body.facts) setFacts(body.facts);
      setQuota(await fetchQuota());
      setConfirmRegenerate(false);
      setSavedAt(null);
    } catch {
      setRegenerateError("No se pudo regenerar el CV. Intenta de nuevo.");
    } finally {
      setRegenerating(false);
    }
  };

  const hasCvReady = !!profile?.exists && !!profile?.hasFacts;
  // Fase 11 (§9.3): el costo real de la opción elegida, no un umbral fijo
  // de "queda algo" — para Pro solo hay "standard" (1 unidad plana, ya
  // reflejada en `quota.remaining`); para Pro Max el costo varía por
  // opción (§6.5.2).
  const selectedCost = tier === "pro_max" ? MODEL_OPTION_INFO[modelOption].credits : 1;
  const hasEnoughQuota = !!quota && quota.remaining >= selectedCost;
  const canGenerate = hasCvReady && hasEnoughQuota && !generating;

  let disabledReason: string | null = null;
  if (!hasCvReady) {
    disabledReason = "Sube tu CV base y espera a que termine de procesarse para poder generar uno adaptado a esta vacante.";
  } else if (quota && !hasEnoughQuota) {
    disabledReason =
      tier === "pro_max"
        ? `Te faltan créditos para "${MODEL_OPTION_INFO[modelOption].label}" (necesitas ${selectedCost}, te quedan ${quota.remaining}).`
        : "Ya usaste todas tus generaciones de este período.";
  }

  return (
    <div className="fixed inset-0 z-[100] bg-background overflow-y-auto" role="dialog" aria-modal="true">
      <div className="max-w-2xl mx-auto p-6 sm:p-10">
        <div className="flex items-start justify-between gap-4 mb-2">
          <div className="min-w-0">
            <p className="text-xs font-mono text-ink-faint mb-1">Ajustar CV para</p>
            <h2 className="font-heading font-semibold text-xl text-foreground leading-snug">{job.title}</h2>
            <p className="text-sm text-muted-foreground">
              {job.company || "Confidencial"} · {job.location || "Ubicación no especificada"}
              {job.dateText ? ` · ${job.dateText}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="text-muted-foreground hover:text-foreground shrink-0"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {step === "loading" && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-10">
            <Loader2 className="h-4 w-4 animate-spin" />
            Cargando...
          </div>
        )}

        {step === "setup" && (
          <>
            <p className="text-xs text-muted-foreground mb-8">
              La descripción completa de la vacante está en la página de {job.source} — no la tenemos
              guardada aquí, así que el CV se adapta con el título, la empresa, la ubicación y la fecha
              de esta vacante, más lo que ya sabemos de tu perfil.
            </p>

            <div className="hud-corners rounded-lg border border-border bg-card p-6 mb-6">
              <h3 className="font-heading font-semibold text-sm text-foreground mb-4">Tu CV base</h3>
              {profile === null ? (
                <p className="text-sm text-muted-foreground mb-4">Cargando...</p>
              ) : hasCvReady ? (
                <div className="flex items-center gap-2 text-sm text-foreground mb-4">
                  <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
                  CV listo — actualizado el{" "}
                  {profile?.updatedAt ? new Date(profile.updatedAt).toLocaleDateString("es-CO") : "—"}
                </div>
              ) : profile?.exists ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
                  <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                  {pollTimedOut
                    ? "Esto está tardando más de lo normal. Puedes intentar subir el archivo de nuevo."
                    : "Procesando tu CV, esto puede tardar unos segundos..."}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground mb-4">Todavía no has subido un CV base.</p>
              )}

              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.doc,.docx"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleFileSelected(file);
                  e.target.value = "";
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {profile?.exists ? "Reemplazar CV" : "Subir CV (PDF o DOCX)"}
              </Button>
              {uploadError && <p className="text-xs text-destructive font-mono mt-2">{uploadError}</p>}
            </div>

            <div className="hud-corners rounded-lg border border-border bg-card p-6 mb-8 flex flex-wrap items-end justify-between gap-4">
              <ModelDropdown
                label="Modelo"
                tier={tier}
                value={modelOption}
                onChange={setModelOption}
                creditsRemaining={tier === "pro_max" ? (quota?.remaining ?? null) : null}
              />
              <p className="text-xs text-muted-foreground text-right">
                {quota
                  ? tier === "pro_max"
                    ? `${quota.remaining} de ${quota.limit} créditos restantes`
                    : `${quota.remaining} de ${quota.limit} generaciones restantes`
                  : "Cargando cuota..."}
              </p>
            </div>

            <Button type="button" size="lg" className="w-full font-mono" disabled={!canGenerate} onClick={() => void handleGenerate()}>
              {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
              {generating ? "Generando..." : "Generar CV para esta vacante"}
            </Button>
            {disabledReason && !generateError && <p className="text-xs text-muted-foreground mt-2">{disabledReason}</p>}
            {generateError && <p className="text-xs text-destructive font-mono mt-2">{generateError}</p>}
          </>
        )}

        {step === "editor" && cvDocument && (
          <CvEditor
            document={cvDocument}
            facts={facts}
            onChange={setCvDocument}
            onSave={() => void handleSave()}
            saving={saving}
            saveError={saveError}
            savedAt={savedAt}
            onDownload={(kind) => void handleDownload(kind)}
            downloading={downloading}
            downloadError={downloadError}
            confirmRegenerate={confirmRegenerate}
            onRequestRegenerate={() => {
              setRegenerateModelOption("standard");
              setConfirmRegenerate(true);
            }}
            onCancelRegenerate={() => setConfirmRegenerate(false)}
            onConfirmRegenerate={() => void handleRegenerate()}
            regenerating={regenerating}
            regenerateError={regenerateError}
            quota={quota}
            tier={tier}
            regenerateModelOption={regenerateModelOption}
            onRegenerateModelOptionChange={setRegenerateModelOption}
          />
        )}
      </div>
    </div>
  );
}

interface CvEditorProps {
  document: CvDocument;
  facts: CvFacts | null;
  onChange: (doc: CvDocument) => void;
  onSave: () => void;
  saving: boolean;
  saveError: string | null;
  savedAt: number | null;
  onDownload: (kind: "pdf" | "docx") => void;
  downloading: "pdf" | "docx" | null;
  downloadError: string | null;
  confirmRegenerate: boolean;
  onRequestRegenerate: () => void;
  onCancelRegenerate: () => void;
  onConfirmRegenerate: () => void;
  regenerating: boolean;
  regenerateError: string | null;
  quota: QuotaStatus | null;
  tier: "pro" | "pro_max";
  regenerateModelOption: ModelOption;
  onRegenerateModelOptionChange: (option: ModelOption) => void;
}

// Vista 2 (§9.4) — formulario por secciones sobre CvDocument. Opera
// directo sobre el JSON estructurado, nunca sobre un PDF renderizado.
// "Guardar cambios" nunca re-corre el validador de factualidad (§11) — el
// usuario edita su propio documento, igual que en un procesador de texto.
function CvEditor(props: CvEditorProps) {
  const { document: doc, facts, onChange } = props;

  const updateClaim = (field: "headline" | "summary", text: string) => {
    onChange({ ...doc, [field]: { ...doc[field], text } });
  };

  const regenerateCost = props.tier === "pro_max" ? MODEL_OPTION_INFO[props.regenerateModelOption].credits : 1;
  // Fail-safe igual que Vista 1's `hasEnoughQuota` — si `quota` es null
  // (fetchQuota falló), el botón se deshabilita en vez de asumir que hay
  // cupo.
  const hasEnoughForRegenerate = !!props.quota && props.quota.remaining >= regenerateCost;

  const experienceById = new Map((facts?.experience ?? []).map((e) => [e.id, e]));
  const skillById = new Map((facts?.skills ?? []).map((s) => [s.id, { id: s.id, label: s.name }]));
  const educationById = new Map(
    (facts?.education ?? []).map((e) => [e.id, { id: e.id, label: `${e.institution} — ${e.degree}` }])
  );
  const certificationById = new Map(
    (facts?.certifications ?? []).map((c) => [c.id, { id: c.id, label: [c.name, c.issuer].filter(Boolean).join(" — ") }])
  );

  return (
    <div className="pb-24">
      {facts && (
        <div className="hud-corners rounded-lg border border-border bg-card p-4 mb-6 text-sm text-muted-foreground">
          {facts.contact.name}
          {facts.contact.email ? ` · ${facts.contact.email}` : ""}
          {facts.contact.phone ? ` · ${facts.contact.phone}` : ""}
          {facts.contact.location ? ` · ${facts.contact.location}` : ""}
        </div>
      )}

      <Field label="Titular (headline)">
        <textarea
          value={doc.headline.text}
          onChange={(e) => updateClaim("headline", e.target.value)}
          rows={2}
          className={TEXTAREA_CLASS}
        />
      </Field>

      <Field label="Resumen">
        <textarea
          value={doc.summary.text}
          onChange={(e) => updateClaim("summary", e.target.value)}
          rows={3}
          className={TEXTAREA_CLASS}
        />
      </Field>

      <Field label="Experiencia">
        <div className="space-y-4">
          {doc.experience.map((exp, i) => {
            const source = experienceById.get(exp.source_id);
            return (
              <div key={exp.source_id} className="hud-corners rounded-lg border border-border bg-card p-4">
                <p className="text-sm font-semibold text-foreground">{source?.title ?? "(experiencia)"}</p>
                <p className="text-xs text-muted-foreground mb-3">
                  {source?.company ?? "—"}
                  {source ? ` · ${source.start_date ?? "?"} – ${source.end_date ?? "Actual"}` : ""}
                </p>
                <BulletsEditor
                  bullets={exp.bullets}
                  onChange={(bullets) => {
                    const nextExperience = doc.experience.map((e, idx) => (idx === i ? { ...e, bullets } : e));
                    onChange({ ...doc, experience: nextExperience });
                  }}
                />
              </div>
            );
          })}
        </div>
      </Field>

      <Field label="Habilidades">
        <ReorderHideList
          items={[...skillById.values()]}
          includedIds={doc.reordered_skill_ids}
          onChange={(ids) => onChange({ ...doc, reordered_skill_ids: ids })}
        />
      </Field>

      <Field label="Educación">
        <ReorderHideList
          items={[...educationById.values()]}
          includedIds={doc.reordered_education_ids}
          onChange={(ids) => onChange({ ...doc, reordered_education_ids: ids })}
        />
      </Field>

      <Field label="Certificaciones">
        <ReorderHideList
          items={[...certificationById.values()]}
          includedIds={doc.reordered_certification_ids}
          onChange={(ids) => onChange({ ...doc, reordered_certification_ids: ids })}
        />
      </Field>

      {facts && facts.languages.length > 0 && (
        <Field label="Idiomas">
          <p className="text-sm text-muted-foreground">
            {facts.languages.map((l) => (l.level ? `${l.name} (${l.level})` : l.name)).join(", ")}
          </p>
        </Field>
      )}

      {doc.gaps_not_to_claim.length > 0 && (
        <Field label="Requisitos que este CV no reclama (honesto por diseño)">
          <ul className="text-xs text-muted-foreground list-disc pl-4 space-y-1">
            {doc.gaps_not_to_claim.map((g, i) => (
              <li key={i}>{g}</li>
            ))}
          </ul>
        </Field>
      )}

      <div className="fixed bottom-0 left-0 right-0 bg-background border-t border-border p-4">
        <div className="max-w-2xl mx-auto flex flex-wrap items-center gap-3">
          <Button type="button" onClick={props.onSave} disabled={props.saving} className="font-mono">
            {props.saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {props.saving ? "Guardando..." : "Guardar cambios"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => props.onDownload("pdf")}
            disabled={props.downloading !== null}
          >
            {props.downloading === "pdf" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            PDF
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => props.onDownload("docx")}
            disabled={props.downloading !== null}
          >
            {props.downloading === "docx" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            DOCX
          </Button>

          {!props.confirmRegenerate ? (
            <Button type="button" variant="ghost" onClick={props.onRequestRegenerate} className="ml-auto text-muted-foreground">
              <RefreshCw className="h-4 w-4" />
              Regenerar desde cero
            </Button>
          ) : (
            <div className="ml-auto flex flex-col items-end gap-2">
              {/* Fase 11 (§9.4): "deja elegir de nuevo la opción de
                  modelo" — mismo ModelDropdown de Vista 1, mismas reglas
                  de bloqueo (RUNNABLE_MODEL_OPTIONS, tier). Antes esto era
                  un tratamiento visual distinto (chips) para la misma
                  elección — unificado en el rediseño de 2026-08-09. */}
              <ModelDropdown
                tier={props.tier}
                value={props.regenerateModelOption}
                onChange={props.onRegenerateModelOptionChange}
                creditsRemaining={props.tier === "pro_max" ? (props.quota?.remaining ?? null) : null}
              />
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  Esto reemplaza tus ediciones y consume cuota. ¿Confirmar?
                </span>
                <Button type="button" variant="outline" size="sm" onClick={props.onCancelRegenerate} disabled={props.regenerating}>
                  Cancelar
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={props.onConfirmRegenerate}
                  disabled={props.regenerating || !hasEnoughForRegenerate}
                >
                  {props.regenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Sí, regenerar
                </Button>
              </div>
            </div>
          )}
        </div>
        {props.saveError && <p className="max-w-2xl mx-auto text-xs text-destructive font-mono mt-2">{props.saveError}</p>}
        {props.savedAt && !props.saveError && (
          <p className="max-w-2xl mx-auto text-xs text-primary font-mono mt-2">Guardado.</p>
        )}
        {props.downloadError && <p className="max-w-2xl mx-auto text-xs text-destructive font-mono mt-2">{props.downloadError}</p>}
        {props.regenerateError && <p className="max-w-2xl mx-auto text-xs text-destructive font-mono mt-2">{props.regenerateError}</p>}
        {props.quota && (
          <p className="max-w-2xl mx-auto text-xs text-muted-foreground mt-2">
            {props.tier === "pro_max"
              ? `Créditos: ${props.quota.remaining} de ${props.quota.limit} restantes este período.`
              : `Cuota: ${props.quota.remaining} de ${props.quota.limit} restantes este período.`}
          </p>
        )}
      </div>
    </div>
  );
}

const TEXTAREA_CLASS =
  "flex w-full rounded-lg border border-border bg-muted/50 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground transition-colors focus-visible:outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h3 className="font-heading font-semibold text-sm text-foreground mb-2">{label}</h3>
      {children}
    </div>
  );
}

const MAX_BULLETS = 5;
const MIN_BULLETS = 1;

function BulletsEditor({ bullets, onChange }: { bullets: Claim[]; onChange: (bullets: Claim[]) => void }) {
  const update = (i: number, text: string) => {
    onChange(bullets.map((b, idx) => (idx === i ? { ...b, text } : b)));
  };
  const remove = (i: number) => {
    if (bullets.length <= MIN_BULLETS) return;
    onChange(bullets.filter((_, idx) => idx !== i));
  };
  const move = (i: number, dir: -1 | 1) => {
    const target = i + dir;
    if (target < 0 || target >= bullets.length) return;
    const next = [...bullets];
    [next[i], next[target]] = [next[target]!, next[i]!];
    onChange(next);
  };
  const add = () => {
    if (bullets.length >= MAX_BULLETS) return;
    onChange([...bullets, { text: "", supporting_fact_ids: [] }]);
  };

  return (
    <div className="space-y-2">
      {bullets.map((b, i) => (
        <div key={i} className="flex items-start gap-2">
          <textarea value={b.text} onChange={(e) => update(i, e.target.value)} rows={2} className={`${TEXTAREA_CLASS} flex-1`} />
          <div className="flex flex-col gap-1 shrink-0 pt-1">
            <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Subir" className="text-muted-foreground hover:text-foreground disabled:opacity-30">
              <ChevronUp className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => move(i, 1)}
              disabled={i === bullets.length - 1}
              aria-label="Bajar"
              className="text-muted-foreground hover:text-foreground disabled:opacity-30"
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => remove(i)}
              disabled={bullets.length <= MIN_BULLETS}
              aria-label="Eliminar"
              className="text-muted-foreground hover:text-destructive disabled:opacity-30"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={add} disabled={bullets.length >= MAX_BULLETS}>
        + Agregar logro
      </Button>
    </div>
  );
}

interface NamedFact {
  id: string;
  label: string;
}

// §9.4: reordenar/ocultar lo que el usuario realmente tiene en CvFacts —
// nunca agrega un id que `items` no traiga ya. "Ocultar" solo saca el id
// de la lista incluida (reordered_*_ids); "mostrar" lo vuelve a agregar al
// final — el dato real nunca se pierde, solo su presencia en el CV.
function ReorderHideList({ items, includedIds, onChange }: { items: NamedFact[]; includedIds: string[]; onChange: (ids: string[]) => void }) {
  const byId = new Map(items.map((i) => [i.id, i]));
  const included = includedIds.filter((id) => byId.has(id));
  const hidden = items.filter((item) => !included.includes(item.id));

  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= included.length) return;
    const next = [...included];
    [next[index], next[target]] = [next[target]!, next[index]!];
    onChange(next);
  };
  const hide = (id: string) => onChange(included.filter((i) => i !== id));
  const show = (id: string) => onChange([...included, id]);

  if (items.length === 0) {
    return <p className="text-xs text-muted-foreground">Tu CV base no tiene nada en esta sección.</p>;
  }

  return (
    <div>
      {included.length === 0 && <p className="text-xs text-muted-foreground mb-2">Nada incluido — todo está oculto.</p>}
      <ul className="space-y-1 mb-2">
        {included.map((id, i) => (
          <li key={id} className="flex items-center justify-between gap-2 text-sm bg-muted/40 rounded px-2 py-1.5">
            <span className="truncate">{byId.get(id)?.label}</span>
            <span className="flex items-center gap-1 shrink-0">
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Subir" className="text-muted-foreground hover:text-foreground disabled:opacity-30">
                <ChevronUp className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => move(i, 1)}
                disabled={i === included.length - 1}
                aria-label="Bajar"
                className="text-muted-foreground hover:text-foreground disabled:opacity-30"
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
              <button type="button" onClick={() => hide(id)} aria-label="Ocultar" className="text-muted-foreground hover:text-destructive">
                <EyeOff className="h-3.5 w-3.5" />
              </button>
            </span>
          </li>
        ))}
      </ul>
      {hidden.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {hidden.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => show(item.id)}
              className="text-xs text-muted-foreground border border-dashed border-border rounded px-2 py-1 hover:text-foreground"
            >
              + {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
