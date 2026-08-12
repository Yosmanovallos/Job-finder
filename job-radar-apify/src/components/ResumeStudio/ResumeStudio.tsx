import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X, Upload, FileText, Loader2, CheckCircle2, ChevronDown, Check, Download, RefreshCw, Undo2, Redo2, AlertCircle } from "lucide-react";
import { Job } from "../../sources/types.js";
import { Button } from "../ui/button.js";
import { useCvAdjustState, type SaveStatus } from "../../hooks/use-cv-adjust-state.js";
import type { ModelOption } from "../../cv/quota.js";
import { CvPreview } from "../CvPreview.js";
import { ContentTab } from "./ContentTab.js";
import { CompareView } from "./CompareView.js";
import { TemplateGallery } from "./TemplateGallery.js";
import { getTemplate } from "../../cv/templates/registry.js";
import { ModelPicker, type SelectedByokModel } from "./ModelPicker.js";

export interface ResumeStudioProps {
  job: Job;
  onClose: () => void;
}

// Mismos costos/reglas que MODEL_OPTION_INFO en CvAdjustOverlay.tsx —
// duplicado a propósito, ver el comentario de use-cv-adjust-state.ts.
const MODEL_OPTION_INFO: Record<ModelOption, { label: string; credits: number; blurb: string }> = {
  standard: { label: "Estándar", credits: 3, blurb: "La opción disponible hoy." },
  premium: { label: "Premium", credits: 5, blurb: "En construcción — un modelo más potente para redactar." },
  compare: {
    label: "Comparar",
    credits: 6,
    blurb: "En construcción — generará con dos modelos y se quedará con el mejor."
  }
};
const MODEL_OPTION_ORDER: ModelOption[] = ["standard", "premium", "compare"];
const RUNNABLE_MODEL_OPTIONS = new Set<ModelOption>(["standard"]);

type StudioTab = "oferta" | "contenido" | "optimizar" | "diseno" | "comparar";
const TABS: { id: StudioTab; label: string; placeholder: boolean }[] = [
  { id: "oferta", label: "Oferta", placeholder: false },
  { id: "contenido", label: "Contenido", placeholder: false },
  { id: "optimizar", label: "Optimizar", placeholder: true },
  { id: "diseno", label: "Diseño", placeholder: false },
  { id: "comparar", label: "Comparar", placeholder: false }
];

/**
 * Fase 7 de docs/RESUME-STUDIO-PLAN.md (plan aprobado 2026-08-09) — shell
 * del modal "Resume Studio". Reemplaza a `CvAdjustOverlay` SOLO cuando
 * `useAuth().resumeStudioActive` es true (gateado en Dashboard.tsx/
 * JobLanding.tsx, no aquí — este componente no vuelve a chequear el flag).
 * Corre sobre el único proveedor Gemini de hoy — el selector de modelo real
 * (Pilar B) llega en la Fase 11, este archivo no importa nada de
 * `ai-gateway/`.
 *
 * Alcance de esta fase (shell, no el producto completo): tab "Contenido"
 * es el editor real (mismos widgets que el overlay viejo, portados en
 * ContentTab.tsx); "Oferta" muestra los datos reales que sí tenemos
 * (título/empresa/ubicación/fecha) — nunca un score o requisitos
 * inventados (decisión §2 del plan aprobado: cortado de v1). "Optimizar"
 * y "Diseño" son placeholders explícitos hasta las Fases 8-10.
 */
export function ResumeStudio({ job, onClose }: ResumeStudioProps) {
  const state = useCvAdjustState(job);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [modelOption, setModelOption] = useState<ModelOption>("standard");
  const [regenerateModelOption, setRegenerateModelOption] = useState<ModelOption>("standard");
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  const [activeTab, setActiveTab] = useState<StudioTab>("contenido");
  // Fase 11 — modelo BYOK elegido en el ModelPicker del header, solo
  // client-side (ver el comentario de persistencia en ModelPicker.tsx).
  // `null` = el default operador-financiado de siempre; afecta solo la
  // PRÓXIMA acción de IA (reescritura de sección / regenerar), nunca el
  // documento ya generado.
  const [byokModel, setByokModel] = useState<SelectedByokModel | null>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      // Fase 9 — Ctrl/Cmd+Z / Ctrl/Cmd+Shift+Z para el undo/redo del
      // DOCUMENTO (historial de checkpoints), pero solo cuando el foco no
      // está dentro de un textarea — ahí el undo NATIVO del navegador ya
      // maneja caracter-por-caracter dentro del campo, y sería confuso
      // que Ctrl+Z saltara de eso a un checkpoint de documento entero a
      // mitad de que el usuario está escribiendo.
      const target = e.target as HTMLElement | null;
      const inTextField = target?.tagName === "TEXTAREA" || target?.tagName === "INPUT";
      if (inTextField) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        state.undo();
      } else if (mod && ((e.key.toLowerCase() === "z" && e.shiftKey) || e.key.toLowerCase() === "y")) {
        e.preventDefault();
        state.redo();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, state.undo, state.redo]);

  const hasCvReady = !!state.profile?.exists && !!state.profile?.hasFacts;
  const selectedCost = state.tier === "pro_max" ? MODEL_OPTION_INFO[modelOption].credits : 1;
  const hasEnoughQuota = !!state.quota && state.quota.remaining >= selectedCost;
  const canGenerate = hasCvReady && hasEnoughQuota && !state.generating;

  let disabledReason: string | null = null;
  if (!hasCvReady) {
    disabledReason = "Sube tu CV base y espera a que termine de procesarse para poder generar uno adaptado a esta vacante.";
  } else if (state.quota && !hasEnoughQuota) {
    disabledReason =
      state.tier === "pro_max"
        ? `Te faltan créditos para "${MODEL_OPTION_INFO[modelOption].label}" (necesitas ${selectedCost}, te quedan ${state.quota.remaining}).`
        : "Ya usaste todas tus generaciones de este período.";
  }

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[100] bg-black/60" />
        <Dialog.Content
          className="fixed z-[101] top-[2vh] left-[2vw] w-[96vw] h-[96vh] bg-background rounded-xl border border-border overflow-hidden flex flex-col shadow-2xl focus:outline-none"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div className="flex items-center justify-between gap-4 px-6 py-4 border-b border-border shrink-0">
            <div className="min-w-0">
              <Dialog.Title className="font-heading font-semibold text-base text-foreground leading-snug truncate">
                {job.title}
              </Dialog.Title>
              <Dialog.Description className="text-xs text-muted-foreground truncate">
                {job.company || "Confidencial"} · {job.location || "Ubicación no especificada"}
              </Dialog.Description>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              {state.step === "editor" && <ModelPicker value={byokModel} onChange={setByokModel} />}
              <Dialog.Close asChild>
                <button type="button" aria-label="Cerrar" className="text-muted-foreground hover:text-foreground">
                  <X className="h-5 w-5" />
                </button>
              </Dialog.Close>
            </div>
          </div>

          {state.step === "loading" && (
            <div className="flex-1 flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Cargando...
            </div>
          )}

          {state.step === "setup" && (
            <div className="flex-1 overflow-y-auto">
              <div className="max-w-2xl mx-auto p-6 sm:p-10">
                <p className="text-xs text-muted-foreground mb-8">
                  La descripción completa de la vacante está en la página de {job.source} — no la tenemos
                  guardada aquí, así que el CV se adapta con el título, la empresa, la ubicación y la fecha
                  de esta vacante, más lo que ya sabemos de tu perfil.
                </p>

                <div className="hud-corners rounded-lg border border-border bg-card p-6 mb-6">
                  <h3 className="font-heading font-semibold text-sm text-foreground mb-4">Tu CV base</h3>
                  {state.profile === null ? (
                    <p className="text-sm text-muted-foreground mb-4">Cargando...</p>
                  ) : hasCvReady ? (
                    <div className="flex items-center gap-2 text-sm text-foreground mb-4">
                      <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
                      CV listo — actualizado el{" "}
                      {state.profile?.updatedAt ? new Date(state.profile.updatedAt).toLocaleDateString("es-CO") : "—"}
                    </div>
                  ) : state.profile?.exists ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
                      <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                      {state.pollTimedOut
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
                      if (file) void state.handleFileSelected(file);
                      e.target.value = "";
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={state.uploading}
                  >
                    {state.uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                    {state.profile?.exists ? "Reemplazar CV" : "Subir CV (PDF o DOCX)"}
                  </Button>
                  {state.uploadError && <p className="text-xs text-destructive font-mono mt-2">{state.uploadError}</p>}
                </div>

                <div className="hud-corners rounded-lg border border-border bg-card p-6 mb-8 flex flex-wrap items-end justify-between gap-4">
                  <ModelDropdown
                    label="Modelo"
                    tier={state.tier}
                    value={modelOption}
                    onChange={setModelOption}
                    creditsRemaining={state.tier === "pro_max" ? (state.quota?.remaining ?? null) : null}
                  />
                  <p className="text-xs text-muted-foreground text-right">
                    {state.quota
                      ? state.tier === "pro_max"
                        ? `${state.quota.remaining} de ${state.quota.limit} créditos restantes`
                        : `${state.quota.remaining} de ${state.quota.limit} generaciones restantes`
                      : "Cargando cuota..."}
                  </p>
                </div>

                <Button
                  type="button"
                  size="lg"
                  className="w-full font-mono"
                  disabled={!canGenerate}
                  onClick={() => void state.handleGenerate(modelOption)}
                >
                  {state.generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                  {state.generating ? "Generando..." : "Generar CV para esta vacante"}
                </Button>
                {disabledReason && !state.generateError && (
                  <p className="text-xs text-muted-foreground mt-2">{disabledReason}</p>
                )}
                {state.generateError && <p className="text-xs text-destructive font-mono mt-2">{state.generateError}</p>}
              </div>
            </div>
          )}

          {state.step === "editor" && state.cvDocument && state.generationId && (
            <div className="flex-1 min-h-0 flex">
              <div className="w-full sm:w-[45%] lg:w-[40%] flex flex-col border-r border-border min-h-0">
                <div className="flex items-center justify-between gap-1 px-4 pt-3 border-b border-border shrink-0">
                  <div className="flex items-center gap-1">
                    {TABS.map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setActiveTab(tab.id)}
                        className={`px-3 py-2 text-xs font-mono font-semibold border-b-2 -mb-px transition-colors ${
                          activeTab === tab.id
                            ? "text-foreground border-primary"
                            : "text-muted-foreground border-transparent hover:text-foreground"
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-1 pb-2 shrink-0">
                    <button
                      type="button"
                      onClick={state.undo}
                      disabled={!state.canUndo}
                      aria-label="Deshacer"
                      title="Deshacer"
                      className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <Undo2 className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={state.redo}
                      disabled={!state.canRedo}
                      aria-label="Rehacer"
                      title="Rehacer"
                      className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <Redo2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-5">
                  {activeTab === "oferta" && (
                    <div className="space-y-3 text-sm">
                      <InfoRow label="Puesto" value={job.title} />
                      <InfoRow label="Empresa" value={job.company || "Confidencial"} />
                      <InfoRow label="Ubicación" value={job.location || "No especificada"} />
                      <InfoRow label="Publicada" value={job.dateText || "Reciente"} />
                      <p className="text-xs text-muted-foreground pt-2">
                        No guardamos la descripción completa de la vacante — solo estos datos. El CV se
                        adapta con esto más lo que ya sabemos de tu perfil.
                      </p>
                    </div>
                  )}
                  {activeTab === "contenido" && (
                    <ContentTab
                      document={state.cvDocument}
                      facts={state.facts}
                      onChange={state.setCvDocument}
                      generationId={state.generationId}
                      byokModel={byokModel}
                    />
                  )}
                  {activeTab === "optimizar" && <PlaceholderTab label="Optimizar" />}
                  {activeTab === "diseno" && (
                    <TemplateGallery
                      selectedId={state.templateId}
                      onSelect={(id) => void state.setTemplate(id)}
                      error={state.templateError}
                    />
                  )}
                  {activeTab === "comparar" &&
                    (state.generatedDocument ? (
                      <CompareView
                        document={state.cvDocument}
                        generatedDocument={state.generatedDocument}
                        onChange={state.setCvDocument}
                        facts={state.facts}
                      />
                    ) : (
                      <p className="text-sm text-muted-foreground text-center mt-20">
                        No hay una versión original de la IA con la que comparar.
                      </p>
                    ))}
                </div>

                <div className="border-t border-border p-4 shrink-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <SaveStatusIndicator status={state.saveStatus} onRetry={() => void state.handleSave()} />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void state.handleDownload("pdf")}
                      disabled={state.downloading !== null}
                    >
                      {state.downloading === "pdf" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                      PDF
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void state.handleDownload("docx")}
                      disabled={state.downloading !== null}
                    >
                      {state.downloading === "docx" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                      DOCX
                    </Button>
                    {!confirmRegenerate ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setRegenerateModelOption("standard");
                          setConfirmRegenerate(true);
                        }}
                        className="ml-auto text-muted-foreground"
                      >
                        <RefreshCw className="h-4 w-4" />
                        Regenerar
                      </Button>
                    ) : null}
                  </div>

                  {confirmRegenerate && (
                    <div className="mt-3 flex flex-col items-end gap-2">
                      <ModelDropdown
                        tier={state.tier}
                        value={regenerateModelOption}
                        onChange={setRegenerateModelOption}
                        creditsRemaining={state.tier === "pro_max" ? (state.quota?.remaining ?? null) : null}
                      />
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">Esto reemplaza tus ediciones. ¿Confirmar?</span>
                        <Button type="button" variant="outline" size="sm" onClick={() => setConfirmRegenerate(false)} disabled={state.regenerating}>
                          Cancelar
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          onClick={async () => {
                            const ok = await state.handleRegenerate(regenerateModelOption, byokModel);
                            if (ok) setConfirmRegenerate(false);
                          }}
                          disabled={state.regenerating}
                        >
                          {state.regenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                          Sí, regenerar
                        </Button>
                      </div>
                    </div>
                  )}

                  {state.downloadError && <p className="text-xs text-destructive font-mono mt-2">{state.downloadError}</p>}
                  {state.regenerateError && <p className="text-xs text-destructive font-mono mt-2">{state.regenerateError}</p>}
                </div>
              </div>

              <div className="hidden sm:block flex-1 min-h-0 overflow-y-auto bg-muted/30 p-8">
                {state.facts ? (
                  <CvPreview document={state.cvDocument} facts={state.facts} template={getTemplate(state.templateId)} />
                ) : (
                  <p className="text-sm text-muted-foreground text-center mt-20">Sin datos de perfil para previsualizar.</p>
                )}
              </div>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground text-right">{value}</span>
    </div>
  );
}

function PlaceholderTab({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 text-muted-foreground">
      <p className="text-sm font-semibold mb-1">{label}</p>
      <p className="text-xs">Próximamente.</p>
    </div>
  );
}

// Fase 9 — reemplaza el botón "Guardar cambios" de siempre-clickeable por
// un indicador de estado del autosave. "Guardar ahora" sigue disponible
// SOLO en el estado "dirty" (cambios en cola que todavía no dispararon el
// debounce) — no como acción principal, como forzar el guardado sin
// esperar. En "error" es la única forma de reintentar.
function SaveStatusIndicator({ status, onRetry }: { status: SaveStatus; onRetry: () => void }) {
  if (status === "saving") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-mono text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Guardando...
      </span>
    );
  }
  if (status === "saved") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-mono text-primary">
        <CheckCircle2 className="h-3.5 w-3.5" /> Guardado
      </span>
    );
  }
  if (status === "error") {
    return (
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex items-center gap-1.5 text-xs font-mono text-destructive hover:underline"
      >
        <AlertCircle className="h-3.5 w-3.5" /> Error al guardar — reintentar
      </button>
    );
  }
  if (status === "dirty") {
    return (
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex items-center gap-1.5 text-xs font-mono text-muted-foreground hover:text-foreground"
      >
        Cambios sin guardar — Guardar ahora
      </button>
    );
  }
  return <span className="text-xs font-mono text-muted-foreground">Sin cambios</span>;
}

interface ModelDropdownProps {
  tier: "pro" | "pro_max";
  value: ModelOption;
  onChange: (option: ModelOption) => void;
  creditsRemaining: number | null;
  label?: string;
}

// Duplicado del ModelDropdown de CvAdjustOverlay.tsx — mismo criterio de
// no tocar ese archivo (ver use-cv-adjust-state.ts). Reemplazado del todo
// en la Fase 11 por el selector real conectado al Provider Registry.
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
          <div role="listbox" className="absolute z-20 mt-1 w-80 rounded-lg border border-border bg-card shadow-lg overflow-hidden hud-corners">
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
                  {tier === "pro_max" && <span className="text-xs font-mono text-muted-foreground shrink-0">{info.credits}c</span>}
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
