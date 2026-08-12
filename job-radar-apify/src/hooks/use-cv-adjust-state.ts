import { useEffect, useRef, useState } from "react";
import { Job } from "../sources/types.js";
import { useAuth } from "../auth/auth-provider.js";
import type { CvDocument } from "../cv/cv-document-schema.js";
import type { CvFacts } from "../cv/cv-facts-schema.js";
import type { ModelOption } from "../cv/quota.js";
import { DEFAULT_TEMPLATE_ID } from "../cv/templates/registry.js";
import type { SelectedByokModel } from "../components/ResumeStudio/ModelPicker.js";

/**
 * Fase 7 de docs/RESUME-STUDIO-PLAN.md (plan aprobado 2026-08-09) — misma
 * lógica de red/estado que ya vive inline en `CvAdjustOverlay.tsx`
 * (bootstrap, polling de facts, subir CV, generar, guardar, descargar,
 * regenerar), extraída a un hook nuevo para que Resume Studio la use SIN
 * tocar `CvAdjustOverlay.tsx` — el plan aprobado (§4, "Archivos críticos")
 * es explícito: ese archivo no se toca hasta la Fase 13 (rollback trivial:
 * apagar el flag deja el overlay viejo 100% intacto). Esto es duplicación
 * deliberada de la lógica, no un refactor del overlay viejo para que la
 * comparta — el mismo criterio que ya aceptó este proyecto para
 * `MODEL_OPTION_INFO` entre `quota.ts` y `CvAdjustOverlay.tsx`.
 */

export interface CvProfileStatus {
  exists: boolean;
  hasFacts: boolean;
  updatedAt: string | null;
}

export interface QuotaStatus {
  used: number;
  limit: number;
  remaining: number;
  tier: "pro" | "pro_max";
}

interface GenerationLookup {
  id: string | null;
  status: string | null;
  document: CvDocument | null;
  /** Fase 12 — el original inmutable de la IA, para el modo Comparar. */
  generatedDocument: CvDocument | null;
  facts: CvFacts | null;
  templateId?: string;
}

export type CvAdjustStep = "loading" | "setup" | "editor";
export type SaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";

const POLL_INTERVAL_MS = 3000;
const POLL_MAX_ATTEMPTS = 20; // ~60s
// Fase 9 de docs/RESUME-STUDIO-PLAN.md — autosave espera esta pausa sin
// más cambios antes de guardar. Bastante corto para sentirse automático,
// bastante largo para no mandar un PATCH por cada tecla mientras el
// usuario todavía está escribiendo una frase.
const AUTOSAVE_DEBOUNCE_MS = 1200;

export function useCvAdjustState(job: Job) {
  const { accessToken, tier: sessionTier } = useAuth();
  const tier: "pro" | "pro_max" = sessionTier === "pro_max" ? "pro_max" : "pro";

  const [step, setStep] = useState<CvAdjustStep>("loading");
  const [profile, setProfile] = useState<CvProfileStatus | null>(null);
  const [quota, setQuota] = useState<QuotaStatus | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [pollTimedOut, setPollTimedOut] = useState(false);

  const [generationId, setGenerationId] = useState<string | null>(null);
  const [cvDocument, setCvDocument] = useState<CvDocument | null>(null);
  // Fase 12 — original inmutable de la IA, nunca editado por el cliente;
  // solo se reemplaza cuando una generación/regeneración NUEVA corre (en
  // ese momento document === generatedDocument, igual que en Postgres).
  const [generatedDocument, setGeneratedDocument] = useState<CvDocument | null>(null);
  const [facts, setFacts] = useState<CvFacts | null>(null);
  // Fase 10 — qué CvTemplateSpec.id usar al renderizar. Presentación
  // pura, nunca pasa por el historial de undo/redo ni por el autosave
  // debounced del documento (se guarda al instante en el click, ver
  // setTemplate abajo) — cambiar de plantilla no es una "edición".
  const [templateId, setTemplateId] = useState<string>(DEFAULT_TEMPLATE_ID);
  const [templateError, setTemplateError] = useState<string | null>(null);

  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const [downloading, setDownloading] = useState<"pdf" | "docx" | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const [regenerating, setRegenerating] = useState(false);
  const [regenerateError, setRegenerateError] = useState<string | null>(null);

  // Fase 9 — autosave (dirty/saving/saved/error) + undo/redo cliente,
  // ambos por-sesión-del-modal, nunca persistidos aparte: el "historial"
  // es una pila de snapshots de `CvDocument` en memoria, un checkpoint
  // por cada guardado automático (no por cada tecla — deshacer opera al
  // grano de "lo último que se guardó", igual que la mayoría de editores
  // con autosave, no carácter por carácter dentro de un campo, donde el
  // undo NATIVO del textarea ya cubre eso).
  const [dirty, setDirty] = useState(false);
  const [history, setHistory] = useState<{ entries: CvDocument[]; index: number }>({ entries: [], index: -1 });
  // true justo después de fijar un documento "base" nuevo (bootstrap,
  // generar, regenerar) — ese primer set no es una edición del usuario,
  // nunca debe disparar el debounce de autosave.
  const skipNextAutosaveRef = useRef(true);
  // true mientras undo()/redo() está restaurando un snapshot — evita que
  // ese mismo cambio de `cvDocument` se vuelva a empujar al historial
  // como si fuera una edición nueva.
  const isRestoringRef = useRef(false);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const authHeaders = accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined;
  const jsonHeaders = { ...authHeaders, "Content-Type": "application/json" };

  /** Un nuevo documento "base" (bootstrap/generar/regenerar) reinicia el
   * historial a un solo checkpoint — deshacer nunca cruza hacia una
   * versión de ANTES de la generación/regeneración actual. */
  const resetHistory = (doc: CvDocument) => {
    setHistory({ entries: [doc], index: 0 });
    setDirty(false);
    skipNextAutosaveRef.current = true;
  };

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
        resetHistory(g.document);
        setGeneratedDocument(g.generatedDocument ?? g.document);
        setFacts(g.facts);
        setTemplateId(g.templateId ?? DEFAULT_TEMPLATE_ID);
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

  const handleFileSelected = async (file: File) => {
    setUploadError(null);
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/cv/profile", { method: "POST", headers: authHeaders, body: formData });
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

  const handleGenerate = async (modelOption: ModelOption) => {
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
      const body = await res
        .json()
        .catch(() => ({}) as { error?: string; id?: string; document?: CvDocument; facts?: CvFacts });
      if (!res.ok) {
        setGenerateError((body as { error?: string }).error || "No se pudo generar el CV.");
        setQuota(await fetchQuota());
        return;
      }
      setGenerationId(body.id ?? null);
      setCvDocument(body.document ?? null);
      if (body.document) resetHistory(body.document);
      setGeneratedDocument(body.document ?? null);
      setFacts(body.facts ?? null);
      // Fila nueva en cv_generations, template_id = su default de columna
      // ('ats_classic') — nunca hereda un templateId que hubiera quedado
      // seleccionado de una sesión anterior en el mismo modal.
      setTemplateId(DEFAULT_TEMPLATE_ID);
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

  /** Autosave (Fase 9): guarda vía `handleSave()` y, si tuvo éxito,
   * empuja un checkpoint nuevo al historial de undo/redo — un guardado
   * fallido NO se vuelve un checkpoint (deshacer nunca debería "volver"
   * a una versión que ni siquiera llegó a persistirse). */
  const commitCheckpoint = async (doc: CvDocument) => {
    await handleSave();
    setDirty(false);
    setHistory((prev) => {
      if (prev.entries[prev.index] === doc) return prev; // nada cambió de verdad
      const truncated = prev.entries.slice(0, prev.index + 1);
      return { entries: [...truncated, doc], index: truncated.length };
    });
  };

  useEffect(() => {
    if (step !== "editor" || !cvDocument) return;
    if (skipNextAutosaveRef.current) {
      skipNextAutosaveRef.current = false;
      return;
    }
    if (isRestoringRef.current) {
      isRestoringRef.current = false;
      return;
    }
    setDirty(true);
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => {
      void commitCheckpoint(cvDocument);
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cvDocument, step]);

  const canUndo = history.index > 0;
  const canRedo = history.index < history.entries.length - 1;

  const undo = () => {
    if (!canUndo) return;
    const newIndex = history.index - 1;
    isRestoringRef.current = true;
    setCvDocument(history.entries[newIndex]!);
    setDirty(false);
    setHistory({ ...history, index: newIndex });
  };

  const redo = () => {
    if (!canRedo) return;
    const newIndex = history.index + 1;
    isRestoringRef.current = true;
    setCvDocument(history.entries[newIndex]!);
    setDirty(false);
    setHistory({ ...history, index: newIndex });
  };

  const saveStatus: SaveStatus = saving ? "saving" : saveError ? "error" : dirty ? "dirty" : savedAt ? "saved" : "idle";

  /** Fase 10 — se guarda al instante en el click (optimista: el swatch
   * seleccionado cambia de inmediato), nunca pasa por el debounce de
   * autosave del documento — es una elección de presentación, no una
   * edición de contenido, y el usuario espera ver el cambio ya. Revierte
   * la selección visual si el PATCH falla, en vez de dejar la UI
   * mostrando algo que el servidor nunca confirmó. */
  const setTemplate = async (newTemplateId: string) => {
    if (!generationId || newTemplateId === templateId) return;
    const previous = templateId;
    setTemplateId(newTemplateId);
    setTemplateError(null);
    try {
      const res = await fetch(`/api/cv/generations/${generationId}/template`, {
        method: "PATCH",
        headers: jsonHeaders,
        body: JSON.stringify({ templateId: newTemplateId })
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}) as { error?: string });
        setTemplateId(previous);
        setTemplateError(body.error || "No se pudo cambiar la plantilla.");
      }
    } catch {
      setTemplateId(previous);
      setTemplateError("No se pudo cambiar la plantilla. Intenta de nuevo.");
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
      link.download = `CV - ${job.title.replace(/[/\\:*?"<>|]/g, "").trim().slice(0, 80) || "CV"}.${kind}`;
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

  const handleRegenerate = async (modelOption: ModelOption, byokModel?: SelectedByokModel | null) => {
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
          modelOption,
          ...(byokModel ? { providerId: byokModel.providerId, modelId: byokModel.modelId } : {})
        })
      });
      const body = await res.json().catch(() => ({}) as { error?: string; document?: CvDocument; facts?: CvFacts });
      if (!res.ok) {
        setRegenerateError((body as { error?: string }).error || "No se pudo regenerar el CV.");
        setQuota(await fetchQuota());
        return;
      }
      setCvDocument(body.document ?? null);
      if (body.document) resetHistory(body.document);
      setGeneratedDocument(body.document ?? null);
      if (body.facts) setFacts(body.facts);
      setQuota(await fetchQuota());
      setSavedAt(null);
      return true;
    } catch {
      setRegenerateError("No se pudo regenerar el CV. Intenta de nuevo.");
      return false;
    } finally {
      setRegenerating(false);
    }
  };

  return {
    tier,
    step,
    profile,
    quota,
    uploading,
    uploadError,
    pollTimedOut,
    generationId,
    cvDocument,
    setCvDocument,
    generatedDocument,
    facts,
    generating,
    generateError,
    saving,
    saveError,
    savedAt,
    saveStatus,
    dirty,
    canUndo,
    canRedo,
    undo,
    redo,
    templateId,
    templateError,
    setTemplate,
    downloading,
    downloadError,
    regenerating,
    regenerateError,
    handleFileSelected,
    handleGenerate,
    handleSave,
    handleDownload,
    handleRegenerate
  };
}
