import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Download, History, Plus, Save, ShieldCheck, ShieldOff, Trash2, Undo2, X } from "lucide-react";
import { useAuth } from "../auth/auth-provider.js";
import { ResumeTemplate } from "../components/resume/ResumeTemplate.js";
import {
  RESUME_POLICY_VERSION,
  RESUME_TEMPLATES,
  emptyResumeFacts,
  newFactId,
  resumeInputSchema,
  type ConsentPurpose,
  type ResumeFacts,
  type ResumeTemplateId
} from "../lib/resume-studio.js";

// AI Resume Studio R1 (ADR 0017): authorization (3 boxes, S3), then the base
// CV written by hand with a live preview in one of three templates, server
// versions with undo/restore, JSON export and «borrar todo». R2 adds two
// inputs with no AI: CV file → text (or paste) and vacancy link → JobSnapshot
// (or paste). No payments. Signed-in only (RequireAuth in App).
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

export default function ResumeStudio() {
  const { user, accessToken } = useAuth();
  const userId = user?.id ?? "";
  const [phase, setPhase] = useState<Phase>("loading");
  const [consent, setConsent] = useState<ConsentView | null>(null);
  const [resume, setResume] = useState<ResumeView | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string; issues?: string[] } | null>(null);
  const [versions, setVersions] = useState<VersionView[] | null>(null);
  const [mobileTab, setMobileTab] = useState<"edit" | "preview">("edit");

  useEffect(() => {
    document.title = "Mi hoja de vida | BuscoTrabajo";
  }, []);

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
    if (!window.confirm("Se borrarán tu hoja de vida y todas sus versiones. No se puede deshacer. ¿Continuar?")) return;
    setBusy(true);
    try {
      const { res, data } = await api("/data", { method: "DELETE" });
      if (!res.ok) return showError(data);
      writeLocalDraft(userId, null);
      setResume(null);
      setVersions(null);
      setDraft(emptyDraft());
      setDirty(false);
      setMessage({ kind: "ok", text: "Borramos tu hoja de vida y sus versiones." });
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    if (
      !window.confirm(
        "Vas a revocar tu autorización: borraremos la hoja de vida guardada en tu cuenta y la copia de este navegador. ¿Continuar?"
      )
    )
      return;
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

  if (phase === "loading") return <div className="p-10 text-center text-muted-foreground">Cargando…</div>;
  if (phase === "unavailable") {
    return (
      <div className="max-w-xl mx-auto p-6 md:p-10 text-center space-y-3">
        <h1 className="text-2xl font-bold">Hoja de vida</h1>
        <p className="text-[#3d413e]">Esta sección todavía no está disponible.</p>
        <Link to="/dashboard" className="text-primary font-semibold">Ver vacantes</Link>
      </div>
    );
  }
  if (phase === "consent" && consent) {
    return (
      <ConsentStep
        consent={consent}
        api={api}
        keepLocalCopy={() => writeLocalDraft(userId, draft)}
        onDone={() => void load()}
      />
    );
  }

  const canSave = Boolean(consent?.storage);

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 md:py-8">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          <p className="font-mono text-xs font-semibold uppercase tracking-wide text-muted-foreground">Hoja de vida base</p>
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
          <button className={buttonClass} onClick={() => void openVersions()} disabled={!resume}>
            <History className="h-4 w-4" /> Versiones
          </button>
          <button className={buttonClass} onClick={() => void exportAll()}>
            <Download className="h-4 w-4" /> Exportar JSON
          </button>
          <button className={buttonClass} onClick={() => void deleteAll()} disabled={busy}>
            <Trash2 className="h-4 w-4" /> Borrar todo
          </button>
          <button className={buttonClass} onClick={() => setPhase("consent")} disabled={busy}>
            <ShieldCheck className="h-4 w-4" /> Autorización
          </button>
          <button className={buttonClass} onClick={() => void revoke()} disabled={busy}>
            <ShieldOff className="h-4 w-4" /> Revocar
          </button>
        </div>
      </div>

      {!canSave ? (
        <p className="mb-4 rounded-xl border p-3 text-sm" style={{ background: "#fff6dc", borderColor: "#e8d9a6" }}>
          No marcaste «Guardar mi hoja de vida en mi cuenta»: lo que escribas queda solo en este navegador.{" "}
          <button className="underline font-semibold" onClick={() => setPhase("consent")}>Cambiar autorización</button>
        </p>
      ) : null}
      {message ? (
        <div
          role={message.kind === "error" ? "alert" : "status"}
          className={`mb-4 rounded-xl p-3 text-sm border ${message.kind === "error" ? "border-destructive/40 bg-destructive/10 text-destructive" : "border-primary/30 bg-primary/10"}`}
        >
          {message.text}
          {message.issues?.length ? (
            <ul className="list-disc pl-4 mt-1">
              {message.issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {versions ? (
        <Card title="Versiones" action={<button aria-label="Cerrar versiones" onClick={() => setVersions(null)}><X className="h-4 w-4" /></button>}>
          <ul className="divide-y divide-foreground/5 max-h-48 overflow-y-auto">
            {versions.map((v) => (
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
        </Card>
      ) : null}

      <div className="md:hidden flex gap-2 mt-4" role="tablist">
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
          <CvImport accessToken={accessToken ?? ""} />
          <JobLink accessToken={accessToken ?? ""} />
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
              <ResumeTemplate facts={draft.facts} templateId={draft.templateId} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ConsentStep({
  consent,
  api,
  keepLocalCopy,
  onDone
}: {
  consent: ConsentView;
  keepLocalCopy: () => void;
  api: (path: string, init?: RequestInit) => Promise<{ res: Response; data: { error?: string } | null }>;
  onDone: () => void;
}) {
  const [checked, setChecked] = useState<Record<string, boolean>>(() => ({ cloud_storage: consent.storage }));
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ready = consent.items.filter((i) => i.required).every((i) => checked[i.purpose]);

  const submit = async () => {
    const storageOff = consent.storage && !checked.cloud_storage;
    if (storageOff) {
      if (!window.confirm("Borraremos la copia guardada en tu cuenta y tu última versión quedará solo en este navegador. ¿Continuar?")) return;
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
    <div className="max-w-xl mx-auto px-4 py-8 space-y-4">
      <h1 className="text-2xl md:text-3xl font-bold">Tu hoja de vida</h1>
      <p className="text-[#3d413e]">Antes de empezar, necesitamos tu autorización. Ninguna casilla viene marcada.</p>
      <div className="ink-card-sm rounded-2xl bg-white p-4 md:p-5 space-y-3">
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
          Continuar
        </button>
      </div>
    </div>
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

function CvImport({ accessToken }: { accessToken: string }) {
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

  return (
    <Card title="Tu hoja de vida desde un archivo">
      <p className="text-sm text-muted-foreground">
        Sube un PDF o Word (.docx) de hasta 2 MB y 4 páginas, o pega el texto. Solo leemos el texto; el archivo no se guarda.
        Llenar los campos de abajo con este texto llega en la siguiente fase.
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
      {busy && <p className="text-xs text-muted-foreground">Leyendo el archivo…</p>}
      {note && <p className={note.kind === "error" ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>{note.text}</p>}
    </Card>
  );
}

interface JobSnapshotView {
  via: string;
  title: string;
  company: string | null;
  location: string | null;
  description: string;
  sourceUrl: string | null;
}

const PASTE_REASONS: Record<string, string> = {
  linkedin: "LinkedIn no permite leer sus vacantes automáticamente.",
  login_wall: "Ese sitio pide iniciar sesión o bloquea la lectura automática.",
  anti_bot: "Ese sitio bloquea la lectura automática.",
  robots: "Ese sitio pide no leer esa página automáticamente.",
  no_structured_data: "No encontramos los datos de la vacante en esa página.",
  not_found: "La vacante ya no está publicada o el link no existe.",
  fetch_failed: "No pudimos abrir la página."
};

function JobLink({ accessToken }: { accessToken: string }) {
  const [url, setUrl] = useState("");
  const [paste, setPaste] = useState<{ reason: string; url: string } | null>(null);
  const [title, setTitle] = useState("");
  const [company, setCompany] = useState("");
  const [text, setText] = useState("");
  const [snapshot, setSnapshot] = useState<JobSnapshotView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const post = async (path: string, body: unknown) => {
    const res = await fetch(`/api/resume${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(body)
    });
    return { res, data: await res.json().catch(() => null) };
  };

  const read = async () => {
    setBusy(true);
    setError(null);
    setSnapshot(null);
    setPaste(null);
    try {
      const { res, data } = await post("/job-link", { url });
      if (!res.ok) return setError(data?.error ?? "No pudimos revisar ese link.");
      if (data.status === "resolved") return setSnapshot(data.snapshot);
      setPaste({ reason: data.reason, url });
    } catch {
      setError("No pudimos revisar ese link.");
    } finally {
      setBusy(false);
    }
  };

  const sendPaste = async () => {
    setBusy(true);
    setError(null);
    try {
      const { res, data } = await post("/job-link/paste", { url: paste?.url || null, title, company, text });
      if (!res.ok) return setError(data?.error ?? "Revisa los datos de la vacante.");
      setSnapshot(data.snapshot);
      setPaste(null);
    } catch {
      setError("No pudimos usar esa descripción.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Vacante por link">
      <p className="text-sm text-muted-foreground">Pega el link de la vacante. Si no la podemos leer, te pedimos copiar su descripción.</p>
      <div className="flex flex-wrap gap-2 items-end">
        <Field label="Link de la vacante">
          <input className={inputClass} type="url" inputMode="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://…" />
        </Field>
        <button className={primaryButtonClass} onClick={() => void read()} disabled={busy || !url.trim()}>
          Leer vacante
        </button>
      </div>
      {paste && (
        <div className="rounded-xl border border-border p-3 space-y-2">
          <p className="text-sm text-[#3d413e]">
            {PASTE_REASONS[paste.reason] ?? "No pudimos leer esa página."} Copia la descripción de la vacante y pégala aquí
            (en el celular: Compartir → Copiar). Guardamos el link para que puedas volver a la vacante.
          </p>
          <div className="grid sm:grid-cols-2 gap-2">
            <Field label="Cargo">
              <input className={inputClass} value={title} onChange={(event) => setTitle(event.target.value)} />
            </Field>
            <Field label="Empresa (opcional)">
              <input className={inputClass} value={company} onChange={(event) => setCompany(event.target.value)} />
            </Field>
          </div>
          <Field label="Descripción de la vacante">
            <textarea className={inputClass} rows={6} value={text} onChange={(event) => setText(event.target.value)} autoFocus />
          </Field>
          <button className={primaryButtonClass} onClick={() => void sendPaste()} disabled={busy || !title.trim() || !text.trim()}>
            Usar esta descripción
          </button>
        </div>
      )}
      {snapshot && (
        <div className="rounded-xl border border-border p-3 space-y-2">
          <p className="text-base font-bold">{snapshot.title}</p>
          <p className="text-sm text-muted-foreground">{[snapshot.company, snapshot.location].filter(Boolean).join(" · ") || "Empresa no indicada"}</p>
          <p className="text-xs text-muted-foreground">
            {snapshot.description.slice(0, 400)}
            {snapshot.description.length > 400 ? "…" : ""}
          </p>
          {snapshot.sourceUrl && (
            <a className="underline text-primary" href={snapshot.sourceUrl} target="_blank" rel="noopener noreferrer nofollow">
              Ir a la vacante
            </a>
          )}
        </div>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </Card>
  );
}
