import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { Download, Plus, Save, Undo2, X } from "lucide-react";
import { useAuth } from "../auth/auth-provider.js";
import { AuthSpinner } from "../components/AuthShell.js";
import { ResumeTemplate } from "../components/resume/ResumeTemplate.js";
import { TailorAgent } from "../components/resume/TailorAgent.js";
import { hasContent, TailorStart, type StartInput } from "../components/resume/TailorStart.js";
import { ResumePass } from "../components/resume/ResumePass.js";
import { ApplicationsBoard } from "../components/resume/ApplicationsBoard.js";
import { btnGhost, Dialog, RsStyle, useConfirm, type ConfirmOptions } from "../components/resume/ui.js";
import {
  RESUME_POLICY_VERSION,
  RESUME_TEMPLATES,
  emptyResumeFacts,
  newFactId,
  resumeFactsSchema,
  resumeInputSchema,
  type ConsentPurpose,
  type ResumeFacts,
  type ResumeTemplateId
} from "../lib/resume-studio.js";

// AI Resume Studio R1 (ADR 0017): authorization (3 boxes, S3), then the base
// CV written by hand with a live preview in one of three templates, server
// versions with undo/restore, JSON export and «borrar todo». R2 adds two
// inputs with no AI: CV file → text (or paste) and vacancy link → JobSnapshot
// (or paste). R3 adds the AI: «Llenar los campos» (CV text → facts with
// verified source spans) and the card agent that adapts the CV to the
// vacancy (TailorAgent). R4 adds the pass screen (ResumePass): one-time
// Wompi passes, clean PDF/DOCX, watermark on the free preview. R4b adds
// «Mis postulaciones» (/hoja-de-vida/postulaciones, ApplicationsBoard): a
// free tracker with the adapted CV per vacancy. Signed-in
// only (RequireAuth in App).
// The server answers 404 for all of this while RESUME_STUDIO_ENABLED is off.

interface ConsentItemView {
  purpose: ConsentPurpose;
  required: boolean;
  label: string;
  linkLabel: string;
  text: string;
}
interface ConsentView {
  policyVersion: string;
  required: boolean;
  storage: boolean;
  items: ConsentItemView[];
}
interface ResumeView {
  id: string;
  title: string;
  templateId: ResumeTemplateId;
  versionNo: number;
  updatedAt: string;
  facts: ResumeFacts;
}
interface VersionView {
  versionNo: number;
  changeSummary: string;
  createdAt: string;
}
interface Draft {
  title: string;
  templateId: ResumeTemplateId;
  facts: ResumeFacts;
}

type Phase = "loading" | "unavailable" | "consent" | "editor";

const emptyDraft = (): Draft => ({ title: "Mi hoja de vida", templateId: "clasica", facts: emptyResumeFacts() });

const draftKey = (userId: string) => `bt:resume-draft:${userId}`;
function readLocalDraft(userId: string): Draft | null {
  try {
    const parsed = resumeInputSchema.safeParse(JSON.parse(localStorage.getItem(draftKey(userId)) || "null"));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
function writeLocalDraft(userId: string, draft: Draft | null): void {
  try {
    if (draft) localStorage.setItem(draftKey(userId), JSON.stringify(draft));
    else localStorage.removeItem(draftKey(userId));
  } catch {
    // Storage blocked: the draft lives only in memory for this visit.
  }
}

function downloadJson(name: string, value: unknown): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const inputClass =
  "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30";
const labelClass = "block text-xs font-semibold text-muted-foreground mb-1";
const buttonClass =
  "inline-flex items-center gap-1.5 rounded-full border-2 border-foreground px-3 py-1.5 text-sm font-semibold bg-white hover:bg-[#f1f2f0] disabled:opacity-50 disabled:cursor-not-allowed";
const primaryButtonClass =
  "inline-flex items-center gap-1.5 rounded-full border-2 border-foreground px-4 py-1.5 text-sm font-bold bg-primary text-primary-foreground disabled:opacity-50 disabled:cursor-not-allowed";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className={labelClass}>{label}</span>
      {children}
    </label>
  );
}

// R4: printing (PDF) shows only the CV; without an active pass it carries
// the «Vista previa» watermark (doc 02 RS-US8). Scoped to this page, so the
// global CSS is untouched. Removing the mark in the browser is the risk
// doc 06 §6 already accepts; the DOCX is gated on the server.
const PRINT_AREA_ID = "rs-print-area";
const PRINT_SCROLL_ID = "rs-print-scroll";
const PRINT_CSS = `@media print {
  body * { visibility: hidden !important; }
  #${PRINT_SCROLL_ID} { max-height: none !important; overflow: visible !important; box-shadow: none !important; border: 0 !important; }
  #${PRINT_AREA_ID}, #${PRINT_AREA_ID} * { visibility: visible !important; }
  #${PRINT_AREA_ID} { position: absolute !important; left: 0; top: 0; width: 100%; }
  @page { margin: 0; }
}`;

function PreviewWatermark() {
  return (
    <div
      aria-hidden="true"
      style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none", display: "grid", alignContent: "space-around", justifyItems: "center" }}
    >
      {[0, 1, 2, 3].map((n) => (
        <span
          key={n}
          style={{ transform: "rotate(-28deg)", fontSize: 30, fontWeight: 700, letterSpacing: ".04em", color: "rgba(15, 107, 79, 0.14)", whiteSpace: "nowrap", WebkitPrintColorAdjust: "exact", printColorAdjust: "exact" }}
        >
          Vista previa — BuscoTrabajo
        </span>
      ))}
    </div>
  );
}

function Card({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="ink-card-sm rounded-2xl bg-white p-4 md:p-5 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-bold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

// Local-only dev login (npm run dev:resume-studio, src/auth/dev-auth.ts).
// __RS_DEV_LOGIN__ is the literal false in every build except the local
// launcher's, so this branch is not in the production bundle; and even in
// the local build the button only appears when the server confirms that all
// of its guards hold (GET /api/resume/dev-auth = 200).
const DEV_TOKEN_KEY = "bt:rs-dev-token";

function readDevToken(): string | null {
  try {
    return sessionStorage.getItem(DEV_TOKEN_KEY);
  } catch {
    return null;
  }
}

function DevLoginGate({ onSession }: { onSession: (session: { token: string; userId: string } | null) => void }) {
  const [state, setState] = useState<"checking" | "available" | "off">("checking");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const status = await fetch("/api/resume/dev-auth")
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
      if (cancelled) return;
      if (!status?.active) return setState("off");
      // Survives the Wompi return reload; the server decides if it's still
      // valid (a restarted server issues a new token).
      const stored = readDevToken();
      if (stored) {
        const res = await fetch("/api/resume/consent", { headers: { Authorization: `Bearer ${stored}` } }).catch(() => null);
        if (cancelled) return;
        if (res?.ok) return onSession({ token: stored, userId: status.userId });
        try {
          sessionStorage.removeItem(DEV_TOKEN_KEY);
        } catch {
          /* ignore */
        }
      }
      setState("available");
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (state === "checking") return <AuthSpinner />;
  if (state === "off") return <Navigate to={`/login?return_to=${encodeURIComponent(window.location.pathname + window.location.search)}`} replace />;

  const enter = async () => {
    setError(null);
    const data = await fetch("/api/resume/dev-login", { method: "POST" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (!data?.token) return setError("El modo de prueba local no está activo en el servidor.");
    try {
      sessionStorage.setItem(DEV_TOKEN_KEY, data.token);
    } catch {
      /* the session just won't survive a reload */
    }
    onSession({ token: data.token, userId: data.user.id });
  };

  return (
    <div className="max-w-xl mx-auto p-6 md:p-10 text-center space-y-3">
      <h1 className="text-2xl font-bold">Hoja de vida</h1>
      <p className="text-[#3d413e]">
        Servidor local de prueba: base desechable y Wompi sandbox. Entra con un usuario ficticio (dev@localhost.test) que solo existe en
        esta base.
      </p>
      <button className={primaryButtonClass} onClick={() => void enter()}>
        Entrar como usuario de prueba (solo local)
      </button>
      <p>
        <Link to={`/login?return_to=${encodeURIComponent("/hoja-de-vida")}`} className="text-primary font-semibold">
          Usar mi cuenta
        </Link>
      </p>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}

/**
 * Same gate as RequireAuth (spinner, then /login), plus the local dev login
 * when this is the launcher's build.
 */
export default function ResumeStudio() {
  const { user, accessToken, isAuthenticated, loading } = useAuth();
  const [devSession, setDevSession] = useState<{ token: string; userId: string } | null>(null);
  const location = useLocation();

  if (loading) return <AuthSpinner />;
  if (isAuthenticated && accessToken && user) return <ResumeStudioApp userId={user.id} accessToken={accessToken} />;
  if (__RS_DEV_LOGIN__) {
    if (devSession) return <ResumeStudioApp userId={devSession.userId} accessToken={devSession.token} />;
    return <DevLoginGate onSession={setDevSession} />;
  }
  if (isAuthenticated) return <AuthSpinner />;
  return <Navigate to={`/login?return_to=${encodeURIComponent(location.pathname + location.search)}`} replace />;
}

function ResumeStudioApp({ userId, accessToken }: { userId: string; accessToken: string }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [consent, setConsent] = useState<ConsentView | null>(null);
  const [resume, setResume] = useState<ResumeView | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string; issues?: string[] } | null>(null);
  const [versions, setVersions] = useState<VersionView[] | null>(null);
  const [mobileTab, setMobileTab] = useState<"edit" | "preview">("edit");
  const [passActive, setPassActive] = useState(false);
  // R4c: start (link + CV) → agent → download, like JobStep; the editor and
  // the account tools live behind «Más opciones».
  const [view, setView] = useState<"start" | "agent" | "editor">("start");
  const [run, setRun] = useState<StartInput | null>(null);
  const [download, setDownload] = useState<ResumeFacts | null>(null);
  const [consentOpen, setConsentOpen] = useState(false);
  const [confirmElement, confirm] = useConfirm();
  const location = useLocation();
  const navigate = useNavigate();
  const onBoard = location.pathname.replace(/\/+$/, "") === "/hoja-de-vida/postulaciones";

  useEffect(() => {
    if (!onBoard) document.title = "Mi hoja de vida | BuscoTrabajo";
  }, [onBoard]);

  const api = useCallback(
    async (path: string, init: RequestInit = {}) => {
      const res = await fetch(`/api/resume${path}`, {
        ...init,
        headers: {
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          Authorization: `Bearer ${accessToken ?? ""}`
        }
      });
      const data = res.status === 204 ? null : await res.json().catch(() => null);
      return { res, data };
    },
    [accessToken]
  );

  const load = useCallback(async () => {
    if (!accessToken) return;
    try {
      const { res, data } = await api("/consent");
      if (!res.ok) return setPhase("unavailable");
      setConsent(data);
      if (!data.required) return setPhase("consent");
      const list = await api("/resumes");
      const first = list.res.ok ? list.data?.resumes?.[0] : null;
      if (first) {
        const one = await api(`/resumes/${first.id}`);
        if (one.res.ok) {
          setResume(one.data.resume);
          setDraft({ title: one.data.resume.title, templateId: one.data.resume.templateId, facts: one.data.resume.facts });
        }
      } else {
        setResume(null);
        setDraft(readLocalDraft(userId) ?? emptyDraft());
      }
      setDirty(false);
      setPhase("editor");
    } catch {
      setPhase("unavailable");
    }
  }, [accessToken, api, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Unsaved work stays in this browser (doc 06 §2), never sent anywhere.
  useEffect(() => {
    if (phase === "editor" && userId && dirty) writeLocalDraft(userId, draft);
  }, [draft, dirty, phase, userId]);

  const update = (change: (facts: ResumeFacts) => ResumeFacts) => {
    setDraft((current) => ({ ...current, facts: change(structuredClone(current.facts)) }));
    setDirty(true);
  };

  const showError = (data: { error?: string; issues?: { path: string; message: string }[] } | null) =>
    setMessage({
      kind: "error",
      text: data?.error || "No se pudo completar la acción.",
      issues: data?.issues?.map((issue) => `${issue.path}: ${issue.message}`)
    });

  const applyResume = (next: ResumeView) => {
    setResume(next);
    setDraft({ title: next.title, templateId: next.templateId, facts: next.facts });
    setDirty(false);
    writeLocalDraft(userId, null);
    if (versions) void openVersions();
  };

  const save = async () => {
    // Blank lines in the links/bullets textareas aren't content.
    const parsed = resumeInputSchema.safeParse({
      ...draft,
      facts: {
        ...draft.facts,
        basics: { ...draft.facts.basics, links: draft.facts.basics.links.map((l) => l.trim()).filter(Boolean) },
        experience: draft.facts.experience.map((e) => ({ ...e, bullets: e.bullets.filter((b) => b.text.trim()) }))
      }
    });
    if (!parsed.success) {
      return setMessage({
        kind: "error",
        text: "Revisa los campos marcados.",
        issues: parsed.error.issues.slice(0, 10).map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      });
    }
    setBusy(true);
    setMessage(null);
    try {
      const { res, data } = resume
        ? await api(`/resumes/${resume.id}`, { method: "PUT", body: JSON.stringify({ ...parsed.data, expectedVersion: resume.versionNo }) })
        : await api("/resumes", { method: "POST", body: JSON.stringify(parsed.data) });
      if (!res.ok) return showError(data);
      applyResume(data.resume);
      setMessage({ kind: "ok", text: `Guardada (versión ${data.resume.versionNo}).` });
    } finally {
      setBusy(false);
    }
  };

  const undo = async () => {
    if (!resume) return;
    setBusy(true);
    try {
      const { res, data } = await api(`/resumes/${resume.id}/undo`, {
        method: "POST",
        body: JSON.stringify({ expectedVersion: resume.versionNo })
      });
      if (!res.ok) return showError(data);
      applyResume(data.resume);
      setMessage({ kind: "ok", text: "Cambio deshecho." });
    } finally {
      setBusy(false);
    }
  };

  const openVersions = async () => {
    if (!resume) return;
    const { res, data } = await api(`/resumes/${resume.id}/versions`);
    if (res.ok) setVersions(data.versions);
  };

  const restore = async (versionNo: number) => {
    if (!resume) return;
    setBusy(true);
    try {
      const { res, data } = await api(`/resumes/${resume.id}/restore`, {
        method: "POST",
        body: JSON.stringify({ versionNo, expectedVersion: resume.versionNo })
      });
      if (!res.ok) return showError(data);
      applyResume(data.resume);
      setMessage({ kind: "ok", text: `Restaurada la versión ${versionNo}.` });
    } finally {
      setBusy(false);
    }
  };

  const exportAll = async () => {
    const { res, data } = await api("/export");
    if (!res.ok) return showError(data);
    // Unsaved local work goes in too: it's the holder's data as well.
    downloadJson("mi-hoja-de-vida-buscotrabajo.json", dirty || !resume ? { ...data, localDraft: draft } : data);
  };

  const deleteAll = async () => {
    const ok = await confirm({
      title: "¿Borrar todos tus datos?",
      body: "Se borrarán tu hoja de vida, todas sus versiones y tus postulaciones. No se puede deshacer. Si quieres una copia, primero usa «Exportar mis datos».",
      confirmLabel: "Borrar todo",
      danger: true
    });
    if (!ok) return;
    setBusy(true);
    try {
      const { res, data } = await api("/data", { method: "DELETE" });
      if (!res.ok) return showError(data);
      writeLocalDraft(userId, null);
      setResume(null);
      setVersions(null);
      setDraft(emptyDraft());
      setDirty(false);
      setMessage({ kind: "ok", text: "Borramos tu hoja de vida, sus versiones y tus postulaciones." });
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    const ok = await confirm({
      title: "¿Revocar tu autorización?",
      body: "Borraremos la hoja de vida guardada en tu cuenta, tus postulaciones y la copia de este navegador. Para volver a usar la herramienta tendrás que autorizar de nuevo.",
      confirmLabel: "Revocar y borrar",
      danger: true
    });
    if (!ok) return;
    setBusy(true);
    try {
      const { res, data } = await api("/consent", { method: "POST", body: JSON.stringify({ policyVersion: RESUME_POLICY_VERSION, revoke: true }) });
      if (!res.ok) return showError(data);
      writeLocalDraft(userId, null);
      setResume(null);
      setVersions(null);
      setDraft(emptyDraft());
      setDirty(false);
      setMessage(null);
      await load();
    } finally {
      setBusy(false);
    }
  };

  // Coming back from Wompi (?pase=retorno): reopen the download with the
  // adapted CV kept in this tab before leaving (sessionStorage, this browser only).
  useEffect(() => {
    if (phase !== "editor") return;
    if (new URLSearchParams(window.location.search).get("pase") !== "retorno") return;
    setDownload(readPendingDownload() ?? draft.facts);
    // Only once, when the page is ready.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  if (phase === "loading") {
    return (
      <div className="max-w-2xl mx-auto px-4 py-10 space-y-3" aria-busy="true">
        <div className="rs-skel" style={{ height: 28, width: "60%" }} />
        <div className="rs-skel" style={{ height: 120 }} />
        <div className="rs-skel" style={{ height: 120 }} />
        <RsStyle />
      </div>
    );
  }
  if (phase === "unavailable") {
    return (
      <div className="max-w-xl mx-auto p-6 md:p-10 text-center space-y-3">
        <h1 className="text-2xl font-bold">Hoja de vida</h1>
        <p className="text-[#3d413e]">Esta sección todavía no está disponible.</p>
        <Link to="/dashboard" className="text-primary font-semibold">Ver vacantes</Link>
      </div>
    );
  }

  const canSave = Boolean(consent?.storage);
  const needsConsent = phase === "consent" && consent !== null;
  const consentForm = (inDialog: boolean) =>
    consent ? (
      <ConsentStep
        consent={consent}
        api={api}
        confirm={confirm}
        inDialog={inDialog}
        keepLocalCopy={() => writeLocalDraft(userId, draft)}
        onDone={() => {
          setConsentOpen(false);
          void load();
        }}
      />
    ) : null;

  if (onBoard && !needsConsent) {
    return (
      <div className="rs-root">
        <RsStyle />
        <ApplicationsBoard
          accessToken={accessToken ?? ""}
          canSave={canSave}
          onChangeConsent={() => setConsentOpen(true)}
          onUseCv={(facts) => {
            setDraft({ ...draft, facts });
            setDirty(true);
            setMobileTab("preview");
            setView("editor");
            setMessage({ kind: "ok", text: "La versión adaptada quedó en el editor. Revísala y guárdala si te sirve; tu base guardada no ha cambiado." });
            navigate("/hoja-de-vida");
          }}
          renderPreview={(facts) => (
            <div style={{ position: "relative" }}>
              <ResumeTemplate facts={facts} templateId={draft.templateId} />
              <PreviewWatermark />
            </div>
          )}
        />
        <Dialog open={consentOpen} title="Autorizaciones" wide onClose={() => setConsentOpen(false)}>
          {consentForm(true)}
        </Dialog>
        {confirmElement}
      </div>
    );
  }

  const base = hasContent(draft.facts)
    ? {
        title: draft.title,
        facts: draft.facts,
        note: resume && !dirty
          ? `Guardada en tu cuenta · versión ${resume.versionNo} · ${new Date(resume.updatedAt).toLocaleDateString("es-CO", { day: "numeric", month: "short", year: "numeric" })}`
          : "Borrador en este navegador"
      }
    : null;

  const messageBox = message ? (
    <div
      role={message.kind === "error" ? "alert" : "status"}
      className={`mb-4 rounded-xl p-3 text-sm border ${message.kind === "error" ? "border-destructive/40 bg-destructive/10 text-destructive" : "border-primary/30 bg-primary/10"}`}
    >
      <div className="flex items-start justify-between gap-2">
        <span>{message.text}</span>
        <button className="rs-x" style={{ width: 28, height: 28 }} aria-label="Cerrar aviso" onClick={() => setMessage(null)}>
          <X className="h-4 w-4" />
        </button>
      </div>
      {message.issues?.length ? (
        <ul className="list-disc pl-4 mt-1">
          {message.issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      ) : null}
    </div>
  ) : null;

  return (
    <div className="rs-root max-w-7xl mx-auto px-4 py-5 md:py-8">
      <RsStyle />
      <div className="flex items-center justify-between gap-3 mb-5">
        {view === "start" ? (
          <span className="font-heading text-base font-bold">Hoja de vida</span>
        ) : (
          <button className={btnGhost} onClick={() => setView("start")}>
            ← Empezar otra adaptación
          </button>
        )}
        {needsConsent ? null : (
          <div className="flex items-center gap-2">
            <Link to="/hoja-de-vida/postulaciones" className={`${btnGhost} hidden sm:inline-flex`}>
              Mis postulaciones
            </Link>
            <MoreMenu
              items={[
                { label: "Editar mi hoja de vida a mano", onSelect: () => setView("editor") },
                { label: "Mis postulaciones", to: "/hoja-de-vida/postulaciones" },
                ...(resume ? [{ label: "Versiones guardadas", onSelect: () => void openVersions() }] : []),
                { label: "Exportar mis datos (JSON)", onSelect: () => void exportAll() },
                { label: "Autorizaciones", onSelect: () => setConsentOpen(true) },
                { divider: true },
                { label: "Borrar todo", danger: true, onSelect: () => void deleteAll() },
                { label: "Revocar autorización", danger: true, onSelect: () => void revoke() }
              ]}
            />
          </div>
        )}
      </div>

      {messageBox}

      {view === "start" || needsConsent ? (
        <TailorStart
          accessToken={accessToken ?? ""}
          saved={needsConsent ? null : base}
          consentBlock={needsConsent ? consentForm(false) : undefined}
          onStart={(input) => {
            setMessage(null);
            setRun(input);
            setView("agent");
          }}
        />
      ) : null}

      {view === "agent" && run && !needsConsent ? (
        <TailorAgent
          key={run.clientKey}
          accessToken={accessToken ?? ""}
          baseFacts={run.facts}
          templateId={draft.templateId}
          job={run.job}
          clientKey={run.clientKey}
          cvNotes={run.cvNotes}
          tracker={{ canSave, resumeRef: resume && !dirty && run.facts === draft.facts ? { id: resume.id, versionNo: resume.versionNo } : null }}
          onClose={() => setView("start")}
          onDownload={(facts) => setDownload(facts)}
          onSeePasses={() => setDownload(run.facts)}
          onUse={(facts) => {
            setDraft({ ...draft, facts });
            setDirty(true);
            setView("editor");
            setMobileTab("edit");
            setMessage({ kind: "ok", text: "La versión adaptada quedó en el editor. Revísala y guárdala si te sirve como base; tu base guardada no ha cambiado." });
          }}
        />
      ) : null}

      {view === "editor" && !needsConsent ? (
        <>
          <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold">{draft.title || "Mi hoja de vida"}</h1>
              <p className="text-sm text-muted-foreground">
                {resume ? `Versión ${resume.versionNo}${dirty ? " · cambios sin guardar" : ""}` : "Aún no la has guardado"}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button className={primaryButtonClass} onClick={() => void save()} disabled={busy || !canSave || (!dirty && Boolean(resume))}>
                <Save className="h-4 w-4" /> Guardar
              </button>
              <button className={buttonClass} onClick={() => void undo()} disabled={busy || !resume || resume.versionNo < 2 || !canSave}>
                <Undo2 className="h-4 w-4" /> Deshacer
              </button>
              <button className={buttonClass} onClick={() => setDownload(draft.facts)} disabled={!hasContent(draft.facts)}>
                <Download className="h-4 w-4" /> Descargar
              </button>
            </div>
          </div>
          {!canSave ? (
            <p className="mb-4 rounded-xl border p-3 text-sm" style={{ background: "#fff6dc", borderColor: "#e8d9a6" }}>
              No marcaste «Guardar mi hoja de vida en mi cuenta»: lo que escribas queda solo en este navegador.{" "}
              <button className="underline font-semibold" onClick={() => setConsentOpen(true)}>Cambiar autorización</button>
            </p>
          ) : null}
          <div className="md:hidden flex gap-2 mt-2" role="tablist">
            {(["edit", "preview"] as const).map((tab) => (
              <button
                key={tab}
                role="tab"
                aria-selected={mobileTab === tab}
                className={`flex-1 rounded-full border-2 border-foreground py-1.5 text-sm font-semibold ${mobileTab === tab ? "bg-foreground text-white" : "bg-white"}`}
                onClick={() => setMobileTab(tab)}
              >
                {tab === "edit" ? "Editar" : "Vista previa"}
              </button>
            ))}
          </div>
          <div className="grid md:grid-cols-2 gap-6 mt-4">
            <div className={`space-y-4 ${mobileTab === "edit" ? "" : "hidden md:block"}`}>
              <CvImport
                accessToken={accessToken ?? ""}
                confirm={confirm}
                onFacts={(facts) => {
                  setDraft({ ...draft, facts });
                  setDirty(true);
                }}
              />
              <Editor draft={draft} setDraft={(next) => { setDraft(next); setDirty(true); }} update={update} />
            </div>
            <div className={mobileTab === "preview" ? "" : "hidden md:block"}>
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Plantilla">
                  {RESUME_TEMPLATES.map((t) => (
                    <button
                      key={t.id}
                      role="radio"
                      aria-checked={draft.templateId === t.id}
                      title={t.description}
                      className={`rounded-full border-2 px-3 py-1 text-sm font-semibold ${draft.templateId === t.id ? "border-foreground bg-foreground text-white" : "border-border bg-white"}`}
                      onClick={() => { setDraft({ ...draft, templateId: t.id }); setDirty(true); }}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
                <div className="ink-card-sm rounded-2xl overflow-hidden bg-white max-h-[70vh] overflow-y-auto">
                  <div style={{ position: "relative" }}>
                    <ResumeTemplate facts={draft.facts} templateId={draft.templateId} />
                    {passActive ? null : <PreviewWatermark />}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>
      ) : null}

      {/* The pass, only when the user wants the file (JobStep: pay at the end). */}
      <Dialog
        open={download !== null}
        wide
        title="Descarga tu hoja de vida"
        description="Revisa cómo queda. La vista previa es gratis; el archivo sin marca necesita un pase."
        onClose={() => {
          setDownload(null);
          clearPendingDownload();
        }}
      >
        {download ? (
          <div className="grid gap-4 md:grid-cols-2 items-start">
            <div className="ink-card-sm rounded-2xl overflow-hidden bg-white overflow-y-auto" style={{ maxHeight: "60vh" }} aria-label="Vista previa">
              <div style={{ position: "relative", zoom: 0.8 }}>
                <ResumeTemplate facts={download} templateId={draft.templateId} />
                {passActive ? null : <PreviewWatermark />}
              </div>
            </div>
            <ResumePass
              accessToken={accessToken ?? ""}
              facts={download}
              templateId={draft.templateId}
              printAreaId={PRINT_AREA_ID}
              onActiveChange={setPassActive}
              onBeforeCheckout={() => writePendingDownload(download)}
            />
          </div>
        ) : null}
      </Dialog>
      {/* Print-only copy of the CV being downloaded (window.print → PDF). */}
      {download ? (
        <div id={PRINT_SCROLL_ID} aria-hidden="true" style={{ position: "fixed", left: -10000, top: 0, width: 794 }}>
          <div id={PRINT_AREA_ID} style={{ position: "relative" }}>
            <ResumeTemplate facts={download} templateId={draft.templateId} />
            {passActive ? null : <PreviewWatermark />}
          </div>
        </div>
      ) : null}
      <style>{PRINT_CSS}</style>

      <Dialog open={versions !== null} title="Versiones guardadas" onClose={() => setVersions(null)}>
        <ul className="divide-y divide-foreground/5">
          {(versions ?? []).map((v) => (
            <li key={v.versionNo} className="flex items-center justify-between gap-2 py-2 text-sm">
              <span>
                <strong>v{v.versionNo}</strong> · {v.changeSummary} ·{" "}
                <span className="text-muted-foreground">{new Date(v.createdAt).toLocaleString("es-CO")}</span>
              </span>
              {resume && v.versionNo !== resume.versionNo ? (
                <button className="text-primary font-semibold" disabled={busy || !canSave} onClick={() => void restore(v.versionNo)}>
                  Restaurar
                </button>
              ) : (
                <span className="text-xs text-muted-foreground">actual</span>
              )}
            </li>
          ))}
        </ul>
      </Dialog>
      <Dialog open={consentOpen} title="Autorizaciones" wide onClose={() => setConsentOpen(false)}>
        {consentForm(true)}
      </Dialog>
      {confirmElement}
    </div>
  );
}

// ---------- R4c: «Más opciones» --------------------------------------------

type MenuItem = { divider: true } | { label: string; danger?: boolean; onSelect?: () => void; to?: string; divider?: false };

function MoreMenu({ items }: { items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const first = wrap.current?.querySelector<HTMLElement>("[data-menuitem]");
    first?.focus();
    const onDoc = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const close = (focusTrigger = true) => {
    setOpen(false);
    if (focusTrigger) trigger.current?.focus();
  };
  const onKey = (e: React.KeyboardEvent) => {
    const nodes = [...(wrap.current?.querySelectorAll<HTMLElement>("[data-menuitem]") ?? [])];
    const at = nodes.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      nodes[(at + 1) % nodes.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      nodes[(at - 1 + nodes.length) % nodes.length]?.focus();
    } else if (e.key === "Tab") setOpen(false);
  };

  return (
    <div ref={wrap} style={{ position: "relative" }} onKeyDown={open ? onKey : undefined}>
      <button
        ref={trigger}
        type="button"
        className={buttonClass}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        Más opciones <span aria-hidden="true">▾</span>
      </button>
      {open ? (
        <div id={menuId} role="menu" className="rs-menu" aria-label="Más opciones">
          {items.map((item, i) =>
            item.divider ? (
              <hr key={`d${i}`} />
            ) : item.to ? (
              <Link key={item.label} to={item.to} role="menuitem" data-menuitem="" tabIndex={-1} onClick={() => close(false)}>
                {item.label}
              </Link>
            ) : (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                data-menuitem=""
                tabIndex={-1}
                className={item.danger ? "rs-danger" : undefined}
                onClick={() => {
                  close(false);
                  item.onSelect?.();
                }}
              >
                {item.label}
              </button>
            )
          )}
        </div>
      ) : null}
    </div>
  );
}

// The adapted CV survives the trip to Wompi and back in THIS tab only.
const PENDING_KEY = "bt:rs-pending-download";
function writePendingDownload(facts: ResumeFacts): void {
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(facts));
  } catch {
    /* storage blocked: the return shows the base instead */
  }
}
function readPendingDownload(): ResumeFacts | null {
  try {
    const parsed = resumeFactsSchema.safeParse(JSON.parse(sessionStorage.getItem(PENDING_KEY) || "null"));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
function clearPendingDownload(): void {
  try {
    sessionStorage.removeItem(PENDING_KEY);
  } catch {
    /* ignore */
  }
}

function ConsentStep({
  consent,
  api,
  keepLocalCopy,
  onDone,
  confirm,
  inDialog
}: {
  consent: ConsentView;
  keepLocalCopy: () => void;
  api: (path: string, init?: RequestInit) => Promise<{ res: Response; data: { error?: string } | null }>;
  onDone: () => void;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  /** In the «Autorizaciones» dialog (change) or on the start screen (first time). */
  inDialog: boolean;
}) {
  // Nothing comes marked (explicit consent); only «guardar» reflects its current state.
  const [checked, setChecked] = useState<Record<string, boolean>>(() => ({ cloud_storage: consent.storage }));
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ready = consent.items.filter((i) => i.required).every((i) => checked[i.purpose]);

  const submit = async () => {
    const storageOff = consent.storage && !checked.cloud_storage;
    if (storageOff) {
      const ok = await confirm({
        title: "¿Dejar de guardar en tu cuenta?",
        body: "Borraremos la copia guardada en tu cuenta y tu última versión quedará solo en este navegador.",
        confirmLabel: "Sí, dejar de guardar"
      });
      if (!ok) return;
      keepLocalCopy();
    }
    setBusy(true);
    setError(null);
    const decisions = Object.fromEntries(consent.items.map((i) => [i.purpose, checked[i.purpose] === true]));
    const { res, data } = await api("/consent", {
      method: "POST",
      body: JSON.stringify({ policyVersion: RESUME_POLICY_VERSION, decisions })
    });
    setBusy(false);
    if (!res.ok) return setError(data?.error || "No se pudo guardar tu autorización.");
    onDone();
  };

  return (
    <section className={inDialog ? "space-y-3" : "ink-card-sm rounded-2xl bg-white p-4 md:p-5 space-y-3"} aria-label="Autorizaciones">
      {inDialog ? null : (
        <div>
          <h2 className="text-lg font-bold" style={{ lineHeight: 1.25 }}>Antes de empezar</h2>
          <p className="text-sm" style={{ color: "#3d413e" }}>Necesitamos tu autorización para leer tu hoja de vida y la vacante. Ninguna casilla viene marcada.</p>
        </div>
      )}
      <div className="space-y-3">
        {consent.items.map((item) => (
          <div key={item.purpose}>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4"
                checked={checked[item.purpose] === true}
                onChange={(e) => setChecked({ ...checked, [item.purpose]: e.target.checked })}
              />
              <span>
                {item.label}{" "}
                <button type="button" className="underline text-primary" onClick={() => setOpen(open === item.purpose ? null : item.purpose)}>
                  {item.linkLabel}
                </button>
              </span>
            </label>
            {open === item.purpose ? <p className="mt-2 pl-6 text-xs text-[#3d413e] bg-[#f1f2f0] rounded-lg p-3">{item.text}</p> : null}
          </div>
        ))}
        <p className="text-xs text-muted-foreground">Versión del texto: {consent.policyVersion}</p>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <button className={primaryButtonClass} disabled={!ready || busy} onClick={() => void submit()}>
          {inDialog ? "Guardar autorización" : "Aceptar y continuar"}
        </button>
      </div>
    </section>
  );
}

function Editor({
  draft,
  setDraft,
  update
}: {
  draft: Draft;
  setDraft: (next: Draft) => void;
  update: (change: (facts: ResumeFacts) => ResumeFacts) => void;
}) {
  const { facts } = draft;
  const remove = <T,>(list: T[], index: number) => list.filter((_, i) => i !== index);
  const skillsText = useMemo(() => facts.skills.map((s) => s.name).join(", "), [facts.skills]);
  const [skillsInput, setSkillsInput] = useState(skillsText);
  useEffect(() => setSkillsInput(skillsText), [skillsText]);

  return (
    <>
      <Card title="Datos básicos">
        <Field label="Nombre de este documento">
          <input className={inputClass} maxLength={80} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
        </Field>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Nombre completo">
            <input className={inputClass} maxLength={80} value={facts.basics.fullName} onChange={(e) => update((f) => ({ ...f, basics: { ...f.basics, fullName: e.target.value } }))} />
          </Field>
          <Field label="Cargo o título profesional">
            <input className={inputClass} maxLength={120} value={facts.basics.headline} onChange={(e) => update((f) => ({ ...f, basics: { ...f.basics, headline: e.target.value } }))} />
          </Field>
          <Field label="Correo">
            <input className={inputClass} type="email" maxLength={120} value={facts.basics.email} onChange={(e) => update((f) => ({ ...f, basics: { ...f.basics, email: e.target.value } }))} />
          </Field>
          <Field label="Teléfono">
            <input className={inputClass} inputMode="tel" maxLength={30} value={facts.basics.phone} onChange={(e) => update((f) => ({ ...f, basics: { ...f.basics, phone: e.target.value } }))} />
          </Field>
          <Field label="Ciudad">
            <input className={inputClass} maxLength={80} value={facts.basics.city} onChange={(e) => update((f) => ({ ...f, basics: { ...f.basics, city: e.target.value } }))} />
          </Field>
          <Field label="Enlaces (LinkedIn, portafolio), uno por línea">
            <textarea
              className={inputClass}
              rows={2}
              value={facts.basics.links.join("\n")}
              onChange={(e) => update((f) => ({ ...f, basics: { ...f.basics, links: e.target.value.split("\n").slice(0, 5) } }))}
            />
          </Field>
        </div>
        <p className="text-xs text-muted-foreground">No incluyas foto, cédula, estado civil ni datos de salud.</p>
      </Card>

      <Card title="Perfil">
        <textarea className={inputClass} rows={4} maxLength={1200} value={facts.summary} onChange={(e) => update((f) => ({ ...f, summary: e.target.value }))} />
      </Card>

      <Card
        title="Experiencia"
        action={
          <button
            className={buttonClass}
            disabled={facts.experience.length >= 15}
            onClick={() =>
              update((f) => ({
                ...f,
                experience: [
                  ...f.experience,
                  { id: newFactId("exp"), source: "user", sourceSpan: null, role: "", company: "", city: "", startDate: "", endDate: "", current: false, bullets: [] }
                ]
              }))
            }
          >
            <Plus className="h-4 w-4" /> Añadir
          </button>
        }
      >
        {facts.experience.length === 0 ? <p className="text-sm text-muted-foreground">Sin experiencia aún. Está bien: añade formación, cursos o voluntariado.</p> : null}
        {facts.experience.map((item, index) => {
          const set = (patch: Partial<typeof item>) =>
            update((f) => ({ ...f, experience: f.experience.map((e, i) => (i === index ? { ...e, ...patch } : e)) }));
          return (
            <div key={item.id} className="rounded-xl border border-border p-3 space-y-2">
              <div className="grid sm:grid-cols-2 gap-2">
                <Field label="Cargo"><input className={inputClass} maxLength={120} value={item.role} onChange={(e) => set({ role: e.target.value })} /></Field>
                <Field label="Empresa"><input className={inputClass} maxLength={120} value={item.company} onChange={(e) => set({ company: e.target.value })} /></Field>
                <Field label="Ciudad"><input className={inputClass} maxLength={80} value={item.city} onChange={(e) => set({ city: e.target.value })} /></Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Desde"><input className={inputClass} type="month" value={item.startDate} onChange={(e) => set({ startDate: e.target.value })} /></Field>
                  <Field label="Hasta"><input className={inputClass} type="month" disabled={item.current} value={item.current ? "" : item.endDate} onChange={(e) => set({ endDate: e.target.value })} /></Field>
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={item.current} onChange={(e) => set({ current: e.target.checked, endDate: e.target.checked ? "" : item.endDate })} />
                Trabajo aquí actualmente
              </label>
              <Field label="Logros y funciones (uno por línea, máx. 8)">
                <textarea
                  className={inputClass}
                  rows={3}
                  value={item.bullets.map((b) => b.text).join("\n")}
                  onChange={(e) =>
                    set({
                      bullets: e.target.value
                        .split("\n")
                        .slice(0, 8)
                        .map((text, i) => ({ id: item.bullets[i]?.id ?? newFactId("b"), source: "user" as const, sourceSpan: null, text }))
                    })
                  }
                />
              </Field>
              <button className="text-sm text-destructive font-semibold" onClick={() => update((f) => ({ ...f, experience: remove(f.experience, index) }))}>
                Quitar
              </button>
            </div>
          );
        })}
      </Card>

      <Card
        title="Formación"
        action={
          <button
            className={buttonClass}
            disabled={facts.education.length >= 10}
            onClick={() =>
              update((f) => ({
                ...f,
                education: [...f.education, { id: newFactId("edu"), source: "user", sourceSpan: null, degree: "", institution: "", city: "", startDate: "", endDate: "" }]
              }))
            }
          >
            <Plus className="h-4 w-4" /> Añadir
          </button>
        }
      >
        {facts.education.map((item, index) => {
          const set = (patch: Partial<typeof item>) =>
            update((f) => ({ ...f, education: f.education.map((e, i) => (i === index ? { ...e, ...patch } : e)) }));
          return (
            <div key={item.id} className="rounded-xl border border-border p-3 space-y-2">
              <div className="grid sm:grid-cols-2 gap-2">
                <Field label="Título"><input className={inputClass} maxLength={120} value={item.degree} onChange={(e) => set({ degree: e.target.value })} /></Field>
                <Field label="Institución"><input className={inputClass} maxLength={120} value={item.institution} onChange={(e) => set({ institution: e.target.value })} /></Field>
                <Field label="Ciudad"><input className={inputClass} maxLength={80} value={item.city} onChange={(e) => set({ city: e.target.value })} /></Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Desde"><input className={inputClass} type="month" value={item.startDate} onChange={(e) => set({ startDate: e.target.value })} /></Field>
                  <Field label="Hasta"><input className={inputClass} type="month" value={item.endDate} onChange={(e) => set({ endDate: e.target.value })} /></Field>
                </div>
              </div>
              <button className="text-sm text-destructive font-semibold" onClick={() => update((f) => ({ ...f, education: remove(f.education, index) }))}>
                Quitar
              </button>
            </div>
          );
        })}
      </Card>

      <Card
        title="Cursos y certificaciones"
        action={
          <button
            className={buttonClass}
            disabled={facts.certifications.length >= 15}
            onClick={() =>
              update((f) => ({ ...f, certifications: [...f.certifications, { id: newFactId("cer"), source: "user", sourceSpan: null, name: "", issuer: "", date: "" }] }))
            }
          >
            <Plus className="h-4 w-4" /> Añadir
          </button>
        }
      >
        {facts.certifications.map((item, index) => {
          const set = (patch: Partial<typeof item>) =>
            update((f) => ({ ...f, certifications: f.certifications.map((c, i) => (i === index ? { ...c, ...patch } : c)) }));
          return (
            <div key={item.id} className="flex flex-wrap gap-2 items-end">
              <Field label="Nombre"><input className={inputClass} maxLength={120} value={item.name} onChange={(e) => set({ name: e.target.value })} /></Field>
              <Field label="Entidad"><input className={inputClass} maxLength={120} value={item.issuer} onChange={(e) => set({ issuer: e.target.value })} /></Field>
              <Field label="Fecha"><input className={inputClass} type="month" value={item.date} onChange={(e) => set({ date: e.target.value })} /></Field>
              <button aria-label="Quitar curso" className="pb-2 text-destructive" onClick={() => update((f) => ({ ...f, certifications: remove(f.certifications, index) }))}>
                <X className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </Card>

      <Card title="Habilidades">
        <Field label="Separadas por coma (máx. 40)">
          <input
            className={inputClass}
            value={skillsInput}
            onChange={(e) => setSkillsInput(e.target.value)}
            onBlur={() =>
              update((f) => ({
                ...f,
                skills: skillsInput
                  .split(",")
                  .map((name) => name.trim())
                  .filter(Boolean)
                  .slice(0, 40)
                  .map((name) => ({ id: f.skills.find((s) => s.name === name)?.id ?? newFactId("sk"), source: "user" as const, sourceSpan: null, name }))
              }))
            }
          />
        </Field>
      </Card>

      <Card
        title="Idiomas"
        action={
          <button
            className={buttonClass}
            disabled={facts.languages.length >= 8}
            onClick={() => update((f) => ({ ...f, languages: [...f.languages, { id: newFactId("lang"), source: "user", sourceSpan: null, name: "", level: "" }] }))}
          >
            <Plus className="h-4 w-4" /> Añadir
          </button>
        }
      >
        {facts.languages.map((item, index) => {
          const set = (patch: Partial<typeof item>) =>
            update((f) => ({ ...f, languages: f.languages.map((l, i) => (i === index ? { ...l, ...patch } : l)) }));
          return (
            <div key={item.id} className="flex flex-wrap gap-2 items-end">
              <Field label="Idioma"><input className={inputClass} maxLength={40} value={item.name} onChange={(e) => set({ name: e.target.value })} /></Field>
              <Field label="Nivel"><input className={inputClass} maxLength={40} placeholder="Nativo, B2…" value={item.level} onChange={(e) => set({ level: e.target.value })} /></Field>
              <button aria-label="Quitar idioma" className="pb-2 text-destructive" onClick={() => update((f) => ({ ...f, languages: remove(f.languages, index) }))}>
                <X className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </Card>
    </>
  );
}

// ---------- R2: CV file or text, and vacancy by link (no AI) ----------

const CV_MAX_BYTES = 2 * 1024 * 1024;

function CvImport({
  accessToken,
  onFacts,
  confirm
}: {
  accessToken: string;
  onFacts: (facts: ResumeFacts) => void;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}) {
  const [text, setText] = useState("");
  const [note, setNote] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    // Checked here too, so a big file is never sent (the server cuts at 2 MB anyway).
    if (file.size > CV_MAX_BYTES) return setNote({ kind: "error", text: "El archivo pesa más de 2 MB. Sube uno más liviano o pega el texto." });
    setBusy(true);
    setNote(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/resume/import", { method: "POST", headers: { Authorization: `Bearer ${accessToken}` }, body: form });
      const data = await res.json().catch(() => null);
      if (!res.ok) return setNote({ kind: "error", text: data?.error ?? "No pudimos leer el archivo. Pega el texto." });
      setText(data.text);
      setNote({ kind: "ok", text: `Leímos ${data.pages ? `${data.pages} página(s)` : "el archivo"}. Revisa el texto: no guardamos el archivo.` });
    } catch {
      setNote({ kind: "error", text: "No pudimos subir el archivo. Pega el texto." });
    } finally {
      setBusy(false);
    }
  };

  const fill = async () => {
    const ok = await confirm({
      title: "¿Reemplazar los campos?",
      body: "Los campos de abajo se reemplazarán con lo que se lea de este texto. Podrás revisarlos antes de guardar.",
      confirmLabel: "Reemplazar"
    });
    if (!ok) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/resume/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ text })
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) return setNote({ kind: "error", text: data?.error ?? "No pudimos leer el texto. Llena los campos a mano." });
      onFacts(data.facts);
      const parts = ["Llenamos los campos: revísalos antes de guardar."];
      if (data.removed?.length) parts.push(`Dejamos por fuera datos que no hacen falta: ${data.removed.join(", ")}.`);
      if (data.dropped?.length) parts.push(`No pudimos comprobar en tu texto: ${data.dropped.slice(0, 6).join(", ")}${data.dropped.length > 6 ? "…" : ""}. Agrégalos a mano si son correctos.`);
      setNote({ kind: "ok", text: parts.join(" ") });
    } catch {
      setNote({ kind: "error", text: "No pudimos leer el texto. Llena los campos a mano." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Tu hoja de vida desde un archivo">
      <p className="text-sm text-muted-foreground">
        Sube un PDF o Word (.docx) de hasta 2 MB y 4 páginas, o pega el texto. Solo leemos el texto; el archivo no se guarda.
        Con «Llenar los campos», la IA separa el texto en secciones; cada dato se comprueba contra tu texto y nada se inventa.
      </p>
      <Field label="Archivo (PDF o DOCX)">
        <input
          type="file"
          accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          className={inputClass}
          disabled={busy}
          onChange={(event) => void upload(event.target.files?.[0])}
        />
      </Field>
      <Field label="O pega el texto de tu hoja de vida">
        <textarea className={inputClass} rows={6} value={text} onChange={(event) => setText(event.target.value)} />
      </Field>
      <button className={primaryButtonClass} onClick={() => void fill()} disabled={busy || text.trim().length < 40}>
        Llenar los campos con este texto
      </button>
      {busy && <p className="text-xs text-muted-foreground">Leyendo…</p>}
      {note && <p className={note.kind === "error" ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>{note.text}</p>}
    </Card>
  );
}
