import { useId, useRef, useState, type ReactNode } from "react";
import type { ResumeFacts } from "../../lib/resume-studio.js";
import type { TailorJob } from "./TailorAgent.js";
import { btn, btnGhost, btnPrimary, newKey, Steps } from "./ui.js";

// AI Resume Studio R4c — the first screen of /hoja-de-vida, like JobStep
// (doc 11 §1, screens 2 and 4): ONLY «the vacancy» (link or pasted text)
// and «your CV» (the saved one, or a PDF/Word file read now). No prices, no
// editor, no toolbar. «Adaptar» reads what is missing (vacancy page, CV
// text → fields with the AI, every field checked against the CV) and hands
// both to the agent with a fresh idempotency key.

const CV_MAX_BYTES = 2 * 1024 * 1024;

const PASTE_REASONS: Record<string, string> = {
  linkedin: "LinkedIn no nos deja leer sus vacantes automáticamente.",
  login_wall: "Ese sitio pide iniciar sesión o bloquea la lectura automática.",
  anti_bot: "Ese sitio bloquea la lectura automática.",
  robots: "Ese sitio pide no leer esa página automáticamente.",
  no_structured_data: "No encontramos los datos de la vacante en esa página.",
  not_found: "La vacante ya no está publicada o el link no existe.",
  fetch_failed: "No pudimos abrir la página."
};

interface Snapshot {
  title: string;
  company: string | null;
  location: string | null;
  description: string;
  sourceUrl: string | null;
}

export interface StartInput {
  job: TailorJob;
  facts: ResumeFacts;
  /** New for every click of «Adaptar»: the server answers the same adaptation for the same key. */
  clientKey: string;
  /** Notes about the CV reading (left out / not verified), shown in the agent. */
  cvNotes: string[];
}

type CvChoice = "saved" | "file";

export function hasContent(facts: ResumeFacts): boolean {
  return Boolean(facts.experience.length || facts.education.length || facts.skills.length || facts.summary.trim() || facts.basics.headline.trim());
}

function Section({ n, title, hint, children }: { n: number; title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="ink-card-sm rounded-2xl bg-white p-4 md:p-5" aria-labelledby={`rs-sec-${n}`}>
      <div className="flex items-start gap-3 mb-3">
        <span
          aria-hidden="true"
          className="font-heading"
          style={{ width: 30, height: 30, borderRadius: 999, background: "#0e1011", color: "#fff", display: "grid", placeItems: "center", fontWeight: 700, flex: "none" }}
        >
          {n}
        </span>
        <div>
          <h2 id={`rs-sec-${n}`} className="text-lg font-bold" style={{ lineHeight: 1.25 }}>
            {title}
          </h2>
          {hint ? <p className="text-sm" style={{ color: "#5a605b" }}>{hint}</p> : null}
        </div>
      </div>
      {children}
    </section>
  );
}

export function TailorStart({
  accessToken,
  saved,
  onStart,
  consentBlock
}: {
  accessToken: string;
  /** The stored base (or the local draft), if it has content. */
  saved: { title: string; facts: ResumeFacts; note: string } | null;
  onStart: (input: StartInput) => void;
  /** Minimal authorizations, only while they are missing: shown first, the rest waits for them. */
  consentBlock?: ReactNode;
}) {
  const [mode, setMode] = useState<"link" | "text">("link");
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [company, setCompany] = useState("");
  const [jobText, setJobText] = useState("");
  const [pasteReason, setPasteReason] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [snapshotUrl, setSnapshotUrl] = useState<string | null>(null);

  const [cvChoice, setCvChoice] = useState<CvChoice>(saved ? "saved" : "file");
  const [file, setFile] = useState<{ name: string; text: string; pages: number | null } | null>(null);
  const [drag, setDrag] = useState(false);
  const [readingFile, setReadingFile] = useState(false);

  const [phase, setPhase] = useState<"idle" | "job" | "cv">("idle");
  const [error, setError] = useState<{ where: "job" | "cv" | "go"; text: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const ids = { url: useId(), title: useId(), company: useId(), text: useId(), file: useId() };

  const post = async (path: string, body: unknown) => {
    const res = await fetch(`/api/resume${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(body)
    });
    return { res, data: await res.json().catch(() => null) };
  };

  const readFile = async (picked: File | undefined) => {
    if (!picked) return;
    setError(null);
    if (picked.size > CV_MAX_BYTES) return setError({ where: "cv", text: "El archivo pesa más de 2 MB. Sube uno más liviano." });
    setReadingFile(true);
    try {
      const form = new FormData();
      form.append("file", picked);
      const res = await fetch("/api/resume/import", { method: "POST", headers: { Authorization: `Bearer ${accessToken}` }, body: form });
      const data = await res.json().catch(() => null);
      if (!res.ok) return setError({ where: "cv", text: data?.error ?? "No pudimos leer el archivo. Prueba con otro PDF o Word." });
      setFile({ name: picked.name, text: data.text, pages: data.pages ?? null });
      setCvChoice("file");
    } catch {
      setError({ where: "cv", text: "No pudimos subir el archivo. Revisa tu conexión e inténtalo de nuevo." });
    } finally {
      setReadingFile(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const jobReady = mode === "link" ? (pasteReason ? title.trim() && jobText.trim().length >= 80 : /^https?:\/\/\S+\.\S+/i.test(url.trim())) : title.trim() && jobText.trim().length >= 80;
  const cvReady = cvChoice === "saved" ? Boolean(saved) : Boolean(file);
  const busy = phase !== "idle" || readingFile;

  /** The vacancy as a snapshot: from the link, or from the pasted text. */
  const resolveJob = async (): Promise<Snapshot | "paste" | null> => {
    if (mode === "link" && !pasteReason) {
      const clean = url.trim();
      if (snapshot && snapshotUrl === clean) return snapshot;
      const { res, data } = await post("/job-link", { url: clean });
      if (!res.ok) {
        setError({ where: "job", text: data?.error ?? "No pudimos revisar ese link." });
        return null;
      }
      if (data.status === "resolved") {
        setSnapshot(data.snapshot);
        setSnapshotUrl(clean);
        return data.snapshot;
      }
      setPasteReason(data.reason ?? "fetch_failed");
      return "paste";
    }
    const { res, data } = await post("/job-link/paste", { url: mode === "link" ? url.trim() || null : null, title: title.trim(), company: company.trim(), text: jobText });
    if (!res.ok) {
      setError({ where: "job", text: data?.error ?? "Revisa los datos de la vacante." });
      return null;
    }
    return data.snapshot;
  };

  const go = async () => {
    setError(null);
    try {
      setPhase("job");
      const job = await resolveJob();
      if (job === null || job === "paste") return;
      let facts: ResumeFacts;
      const cvNotes: string[] = [];
      if (cvChoice === "saved" && saved) facts = saved.facts;
      else if (file) {
        setPhase("cv");
        const { res, data } = await post("/extract", { text: file.text });
        if (!res.ok) {
          setError({ where: "cv", text: data?.error ?? "No pudimos leer tu hoja de vida. Inténtalo de nuevo." });
          return;
        }
        facts = data.facts;
        if (data.removed?.length) cvNotes.push(`Dejamos por fuera datos que no hacen falta: ${data.removed.join(", ")}.`);
        if (data.dropped?.length) cvNotes.push(`No pudimos comprobar en tu archivo: ${data.dropped.slice(0, 5).join(", ")}${data.dropped.length > 5 ? "…" : ""}. No los usamos.`);
        if (!hasContent(facts)) {
          setError({ where: "cv", text: "No encontramos experiencia ni estudios en el archivo. Prueba con otro, o escribe tu hoja de vida en «Más opciones → Editar a mano»." });
          return;
        }
      } else return;
      onStart({ job: { title: job.title, company: job.company, description: job.description, url: job.sourceUrl }, facts, clientKey: newKey(), cvNotes });
    } catch {
      setError({ where: "go", text: "Se perdió la conexión. Inténtalo de nuevo." });
    } finally {
      setPhase("idle");
    }
  };

  const errorFor = (where: "job" | "cv" | "go") =>
    error?.where === where ? (
      <p role="alert" className="text-sm mt-2" style={{ color: "#b42318" }}>
        {error.text}
      </p>
    ) : null;

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div className="text-center md:text-left">
        <p className="font-mono text-xs font-semibold uppercase tracking-wide" style={{ color: "#0f6b4f" }}>
          Hoja de vida con IA
        </p>
        <h1 className="text-2xl md:text-3xl font-bold" style={{ letterSpacing: "-.03em" }}>
          Adapta tu hoja de vida a una vacante
        </h1>
        <p className="mt-1" style={{ color: "#3d413e" }}>
          Pega el link y elige tu hoja de vida. Te mostramos, uno por uno, qué ajustar. Nada cambia sin que lo apruebes y nada se inventa.
        </p>
      </div>

      {consentBlock}

      <fieldset disabled={Boolean(consentBlock)} style={{ border: 0, padding: 0, margin: 0, minWidth: 0, opacity: consentBlock ? 0.5 : 1 }} className="space-y-4">
      <Section n={1} title="Pega el link de la vacante" hint="De BuscoTrabajo, Workday, Greenhouse, Lever o el sitio de la empresa.">
        <div className="rs-tabs mb-3" role="tablist" aria-label="Cómo traer la vacante">
          {(["link", "text"] as const).map((m) => (
            <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => { setMode(m); setError(null); }}>
              {m === "link" ? "Link" : "Pegar el texto"}
            </button>
          ))}
        </div>
        {mode === "link" ? (
          <>
            <label htmlFor={ids.url} className="sr-only">Link de la vacante</label>
            <input
              id={ids.url}
              className="rs-input"
              type="url"
              inputMode="url"
              autoComplete="off"
              placeholder="https://…"
              value={url}
              aria-invalid={error?.where === "job" ? true : undefined}
              onChange={(e) => {
                setUrl(e.target.value);
                setPasteReason(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && jobReady && cvReady && !busy) void go();
              }}
            />
            {snapshot && snapshotUrl === url.trim() ? (
              <p className="text-sm mt-2" style={{ color: "#074a3a" }}>
                ✓ <b>{snapshot.title}</b>
                {snapshot.company ? ` · ${snapshot.company}` : ""}
                {snapshot.location ? ` · ${snapshot.location}` : ""}
              </p>
            ) : null}
            {pasteReason ? (
              <div className="rounded-xl p-3 mt-3 text-sm" style={{ background: "#fff6dc", border: "1px solid #e8d9a6" }} role="status">
                <b>{PASTE_REASONS[pasteReason] ?? "No pudimos leer esa página."}</b> Copia la descripción de la vacante y pégala aquí (en el celular: Compartir → Copiar). Guardamos el link para que puedas volver.
              </div>
            ) : null}
          </>
        ) : null}
        {mode === "text" || pasteReason ? (
          <div className="grid gap-3 mt-3">
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor={ids.title} className="block text-xs font-semibold mb-1" style={{ color: "#5a605b" }}>Cargo</label>
                <input id={ids.title} className="rs-input" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
              </div>
              <div>
                <label htmlFor={ids.company} className="block text-xs font-semibold mb-1" style={{ color: "#5a605b" }}>Empresa (opcional)</label>
                <input id={ids.company} className="rs-input" value={company} maxLength={200} onChange={(e) => setCompany(e.target.value)} />
              </div>
            </div>
            <div>
              <label htmlFor={ids.text} className="block text-xs font-semibold mb-1" style={{ color: "#5a605b" }}>Descripción de la vacante</label>
              <textarea id={ids.text} className="rs-input" rows={6} value={jobText} onChange={(e) => setJobText(e.target.value)} placeholder="Pega aquí los requisitos y las funciones…" />
              <p className="text-xs mt-1" style={{ color: "#5a605b" }}>Lo que pegues se trata como dato, nunca como instrucciones para la IA.</p>
            </div>
          </div>
        ) : null}
        {errorFor("job")}
      </Section>

      <Section n={2} title="Tu hoja de vida" hint="La usamos como base. Tu archivo no se guarda: solo leemos el texto.">
        <div className="grid gap-2" role="radiogroup" aria-label="Hoja de vida base">
          {saved ? (
            <button type="button" role="radio" aria-checked={cvChoice === "saved"} data-on={cvChoice === "saved"} className="rs-option" onClick={() => setCvChoice("saved")}>
              <Radio on={cvChoice === "saved"} />
              <span>
                <b className="block">{saved.title || "Mi hoja de vida"}</b>
                <span className="text-sm" style={{ color: "#5a605b" }}>{saved.note}</span>
              </span>
            </button>
          ) : null}
          <div
            className="rs-drop"
            data-drag={drag}
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              void readFile(e.dataTransfer.files?.[0]);
            }}
          >
            {file ? (
              <button type="button" role="radio" aria-checked={cvChoice === "file"} data-on={cvChoice === "file"} className="rs-option" onClick={() => setCvChoice("file")}>
                <Radio on={cvChoice === "file"} />
                <span style={{ minWidth: 0 }}>
                  <b className="block" style={{ overflowWrap: "anywhere" }}>{file.name}</b>
                  <span className="text-sm" style={{ color: "#5a605b" }}>
                    {file.pages ? `${file.pages} página(s) leídas` : "Archivo leído"} · {file.text.length.toLocaleString("es-CO")} caracteres
                  </span>
                </span>
              </button>
            ) : null}
            <input
              ref={fileInput}
              id={ids.file}
              type="file"
              className="sr-only"
              accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={(e) => void readFile(e.target.files?.[0])}
            />
            <div className={file ? "mt-3" : ""}>
              <label htmlFor={ids.file} className={btn} style={{ cursor: busy ? "not-allowed" : "pointer" }} aria-disabled={busy}>
                {readingFile ? <span className="rs-spin" aria-hidden="true" /> : null}
                {readingFile ? "Leyendo el archivo…" : file ? "Subir otro archivo" : "Subir PDF o Word"}
              </label>
              <p className="text-xs mt-2" style={{ color: "#5a605b" }}>Hasta 2 MB y 4 páginas. También puedes arrastrarlo aquí.</p>
            </div>
          </div>
        </div>
        {errorFor("cv")}
      </Section>

      </fieldset>

      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <button type="button" className={btnPrimary} style={{ padding: "12px 22px", fontSize: 16 }} disabled={!jobReady || !cvReady || busy || Boolean(consentBlock)} onClick={() => void go()}>
          {phase !== "idle" ? <span className="rs-spin" aria-hidden="true" style={{ borderTopColor: "#fff" }} /> : null}
          Adaptar mi hoja de vida →
        </button>
        {phase !== "idle" ? (
          <div className="text-sm">
            <Steps labels={["Leyendo la vacante", "Leyendo tu hoja de vida"]} current={phase === "job" ? 0 : 1} done={false} />
          </div>
        ) : (
          <p className="text-xs" style={{ color: "#5a605b" }}>
            {consentBlock ? "Primero marca las autorizaciones de arriba." : !jobReady ? "Falta la vacante." : !cvReady ? "Falta tu hoja de vida." : "Ves cada cambio antes de aplicarlo."}
          </p>
        )}
      </div>
      {errorFor("go")}
      {error ? (
        <button type="button" className={btnGhost} onClick={() => void go()} disabled={!jobReady || !cvReady || busy}>
          Reintentar
        </button>
      ) : null}
    </div>
  );
}

function Radio({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden="true"
      style={{ width: 20, height: 20, borderRadius: 999, border: `2px solid ${on ? "#0f6b4f" : "#b9c2b6"}`, display: "grid", placeItems: "center", flex: "none", marginTop: 2 }}
    >
      {on ? <span style={{ width: 10, height: 10, borderRadius: 999, background: "#0f6b4f" }} /> : null}
    </span>
  );
}
