import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ResumeTemplate } from "./ResumeTemplate.js";
import type { ResumeFacts, ResumeTemplateId } from "../../lib/resume-studio.js";
import { applyBullet, applyHeadline, applySkills, applySummary, MAX_CHAT_TURNS, type Card } from "../../lib/resume-tailor/cards.js";
import { computeEvidence, type Citation } from "../../lib/resume-tailor/evidence.js";
import type { Claim } from "../../lib/resume-tailor/factuality.js";
import type { JobAnalysis } from "../../lib/resume-tailor/requirements.js";
import { compatibilityScore, qualityScore } from "../../lib/resume-tailor/score.js";
import { btnPrimary, newKey, once, Steps, useStagedSteps } from "./ui.js";

// AI Resume Studio R3 — the card agent (doc 11 §1.1 and §5.1, prototype
// docs/resume-studio/mockups/resume-tailor-link-prototype.html). The code
// decides the order of the cards; the model only drafts inside one. Every
// change waits for «Aplicar». The adapted CV lives in this browser until the
// user takes it to the editor; the stored base is never touched here.
// Only class names that already exist in the global CSS are used (the CSS
// must stay byte-identical); the rest is inline style.

export interface TailorJob {
  title: string;
  company: string | null;
  description: string;
  /** Public link of the vacancy (R4b: the card in «Mis postulaciones»). */
  url?: string | null;
}

interface StartResponse {
  adaptationId: string;
  job: JobAnalysis;
  citations: Record<string, Citation[]>;
  queue: Card[];
  aiAvailable: boolean;
  aiMessage: string | null;
  disclaimer: string;
}

type Proposal =
  | { status: "proposal"; text: string; why: string; byAi: boolean; reply?: string; ask?: string }
  | { status: "question"; claims: Claim[]; question: string }
  | { status: "discarded"; claims: Claim[] }
  | { status: "error"; error: string };

interface Closed {
  key: string;
  ok: boolean;
  label: string;
}

const button =
  "inline-flex items-center justify-center gap-2 rounded-xl border-2 border-foreground bg-white px-3 py-1.5 text-sm font-semibold ink-lift";
const primary =
  "inline-flex items-center justify-center gap-2 rounded-xl border-2 border-foreground bg-primary text-white px-3 py-1.5 text-sm font-semibold ink-lift";
const ghost = "inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-white px-3 py-1.5 text-sm font-semibold";
const field = "w-full rounded-xl border-2 border-foreground bg-white px-3 py-2 text-sm";
const insStyle: CSSProperties = { background: "#d9f5e6", color: "#0b5a3e", textDecoration: "none", borderRadius: 4, padding: "0 3px" };
const delStyle: CSSProperties = { background: "#fde4e1", color: "#b42318", borderRadius: 4, padding: "0 3px" };

function Ring({ value, size = 54 }: { value: number; size?: number }) {
  const color = value >= 70 ? "#0f6b4f" : value >= 50 ? "#d4a537" : "#b42318";
  return (
    <div
      aria-hidden="true"
      className="flex-shrink-0"
      style={{ width: size, height: size, borderRadius: "50%", background: `conic-gradient(${color} ${value}%, #e5e8e1 0)`, display: "grid", placeItems: "center" }}
    >
      <b className="font-heading" style={{ width: size - 12, height: size - 12, borderRadius: "50%", background: "#fff", display: "grid", placeItems: "center", fontSize: 17 }}>
        {value}
      </b>
    </div>
  );
}

function CardBox({ kicker, step, title, children }: { kicker: string; step?: string; title: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border-2 border-foreground bg-white p-3.5 ink-card-sm">
      <div className="flex justify-between gap-2 font-mono text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
        <span>{kicker}</span>
        {step ? <span>{step}</span> : null}
      </div>
      <h3 className="text-base font-bold mb-1.5">{title}</h3>
      {children}
    </div>
  );
}

const CLAIM_LABEL: Record<Claim["kind"], string> = {
  number: "una cifra",
  month: "una fecha",
  skill: "una herramienta",
  proper_noun: "un nombre",
  title: "un cargo o nivel",
  achievement: "un logro o alcance",
  new_word: "una palabra",
  link: "un enlace"
};

export function TailorAgent({
  accessToken,
  baseFacts,
  templateId,
  job,
  clientKey,
  cvNotes = [],
  onUse,
  onClose,
  onDownload,
  onSeePasses,
  tracker
}: {
  accessToken: string;
  baseFacts: ResumeFacts;
  templateId: ResumeTemplateId;
  job: TailorJob;
  /** R4c: made at click time; the server answers the same adaptation for the same key. */
  clientKey: string;
  cvNotes?: string[];
  onUse: (facts: ResumeFacts) => void;
  onClose: () => void;
  /** R4c: the pass appears only here, when the user wants the file (doc 11 §1, screen 10). */
  onDownload: (facts: ResumeFacts) => void;
  /** No adaptations left at the start (402): the only early door to the passes. */
  onSeePasses: () => void;
  /** R4b: «Guardar en Mis postulaciones». canSave = «guardar en mi cuenta». */
  tracker?: { canSave: boolean; resumeRef: { id: string; versionNo: number } | null };
}) {
  const [start, setStart] = useState<StartResponse | null>(null);
  const [error, setError] = useState<{ text: string; quota: boolean } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [facts, setFacts] = useState<ResumeFacts>(baseFacts);
  const [cursor, setCursor] = useState(0);
  const [closed, setClosed] = useState<Closed[]>([]);
  const [tab, setTab] = useState<"agent" | "doc">("agent");
  const [turns, setTurns] = useState(0);
  const feedRef = useRef<HTMLDivElement>(null);

  const post = useCallback(
    async (path: string, body: unknown) => {
      const res = await fetch(`/api/resume${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify(body)
      });
      return { res, data: await res.json().catch(() => null) };
    },
    [accessToken]
  );

  // One request per (key, attempt), shared by React's double effect and any
  // remount; the server also answers the same adaptation for the same key.
  useEffect(() => {
    let cancelled = false;
    setError(null);
    void (async () => {
      try {
        const { res, data } = await once(`start:${clientKey}:${attempt}`, () =>
          post("/tailor/start", { facts: baseFacts, job: { title: job.title, description: job.description }, clientKey })
        );
        if (cancelled) return;
        if (!res.ok) return setError({ text: data?.error ?? "No pudimos analizar la vacante.", quota: res.status === 402 });
        setStart(data);
      } catch {
        if (!cancelled) setError({ text: "Se perdió la conexión mientras analizábamos la vacante.", quota: false });
      }
    })();
    return () => {
      cancelled = true;
    };
    // The base and the vacancy are fixed for one adaptation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);
  const loadingStep = useStagedSteps(3, !start && !error);

  const score = useMemo(() => {
    if (!start) return null;
    const evidence = computeEvidence(start.job.requirements, facts, start.citations);
    return { compatibility: compatibilityScore(start.job, evidence, facts), quality: qualityScore(facts) };
  }, [start, facts]);
  const initial = useMemo(() => {
    if (!start) return null;
    return compatibilityScore(start.job, computeEvidence(start.job.requirements, baseFacts, start.citations), baseFacts).total;
  }, [start, baseFacts]);

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: "smooth" });
  }, [cursor, closed.length]);

  const close = (card: Card, ok: boolean, label: string) => {
    setClosed((list) => [...list, { key: `${card.id}-${list.length}`, ok, label }]);
    setCursor((c) => c + 1);
  };

  if (error) {
    return (
      <div className="max-w-xl mx-auto rounded-2xl border-2 border-foreground bg-white p-5 space-y-3 ink-card-sm">
        <h2 className="text-lg font-bold">{error.quota ? "No te quedan adaptaciones con IA" : "No pudimos empezar la adaptación"}</h2>
        <p role="alert" className="text-sm" style={{ color: error.quota ? "#3d413e" : "#b42318" }}>{error.text}</p>
        <div className="flex flex-wrap gap-2">
          {error.quota ? (
            <button className={primary} onClick={onSeePasses}>Ver pases</button>
          ) : (
            <button className={primary} onClick={() => setAttempt((a) => a + 1)}>Reintentar</button>
          )}
          <button className={button} onClick={onClose}>Volver</button>
        </div>
      </div>
    );
  }
  if (!start || !score || initial === null) {
    return (
      <div className="max-w-xl mx-auto rounded-2xl border-2 border-foreground bg-white p-5 space-y-4 ink-card-sm" aria-busy="true">
        <div>
          <p className="font-mono text-xs font-semibold uppercase tracking-wide" style={{ color: "#0f6b4f" }}>
            {job.company ? `${job.title} · ${job.company}` : job.title}
          </p>
          <h2 className="text-lg font-bold">Estamos preparando tu adaptación</h2>
        </div>
        <Steps labels={["Leyendo la vacante", "Comparando con tu hoja de vida", "Preparando sugerencias"]} current={loadingStep} done={false} />
        <div className="space-y-2" aria-hidden="true">
          <div className="rs-skel" style={{ height: 14, width: "70%" }} />
          <div className="rs-skel" style={{ height: 14, width: "90%" }} />
          <div className="rs-skel" style={{ height: 14, width: "55%" }} />
        </div>
        <p className="text-xs text-muted-foreground">Suele tardar entre 10 y 30 segundos. Nada se cambia sin que lo apruebes.</p>
      </div>
    );
  }

  const card = start.queue[cursor];
  const done = cursor >= start.queue.length;
  const must = start.job.requirements.filter((r) => r.kind === "must").length;
  const nice = start.job.requirements.length - must;

  return (
    <div>
      <div className="md:hidden flex gap-2 mb-3" role="tablist" aria-label="Vista">
        {(["agent", "doc"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={`flex-1 rounded-xl border-2 border-foreground py-2 text-sm font-bold ${tab === t ? "bg-foreground text-white" : "bg-white"}`}
            onClick={() => setTab(t)}
          >
            {t === "agent" ? "Agente" : "Tu hoja de vida"}
          </button>
        ))}
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <section className={`${tab === "agent" ? "" : "hidden md:block"}`} aria-label="Agente">
          <div className="rounded-2xl border-2 border-foreground bg-white overflow-hidden flex flex-col">
            <div className="flex items-center gap-3 p-3 border-b-2 border-foreground">
              <Ring value={score.compatibility.total} />
              <div className="min-w-0">
                <p className="text-sm font-bold leading-tight">Compatibilidad estimada con la vacante</p>
                <p className="text-xs text-muted-foreground">{start.disclaimer}</p>
              </div>
            </div>
            <details className="px-3 py-2 border-b border-border text-xs">
              <summary className="font-semibold">Cómo se calcula · Calidad de tu hoja de vida: {score.quality.total}/100</summary>
              <ul className="mt-2 space-y-1">
                {score.compatibility.components.map((c) => (
                  <li key={c.id} className="flex justify-between gap-2">
                    <span>{c.label}</span>
                    <span className="font-mono">{c.available ? `${c.points} / ${c.max}` : "sin datos"}</span>
                  </li>
                ))}
              </ul>
              {score.compatibility.notices.map((n) => (
                <p key={n} className="mt-1 text-muted-foreground">{n}</p>
              ))}
              <p className="mt-2 font-semibold">Calidad (estructura, no es un puntaje ATS):</p>
              <ul className="mt-1 space-y-1">
                {score.quality.checks.map((c) => (
                  <li key={c.id}>{c.ok ? "✓" : "–"} {c.label}</li>
                ))}
              </ul>
            </details>

            <div ref={feedRef} className="p-3 space-y-3 overflow-y-auto" style={{ maxHeight: 640 }} aria-live="polite">
              <p className="text-sm text-[#3d413e]">
                Tu hoja de vida tiene una compatibilidad de <b>{initial}</b> con <b>«{job.title}»</b>
                {job.company ? ` en ${job.company}` : ""}.{" "}
                {start.job.requirements.length
                  ? `Encontré ${must} requisito${must === 1 ? "" : "s"} obligatorio${must === 1 ? "" : "s"} y ${nice} deseable${nice === 1 ? "" : "s"}${start.job.source === "model" ? " (leídos con IA y comprobados en el texto de la vacante)" : ""}.`
                  : "No encontré requisitos claros en la vacante: revisamos tu hoja de vida en general."}{" "}
                Vamos uno por uno: tú apruebas cada cambio.
              </p>
              {cvNotes.map((note) => (
                <p key={note} className="text-xs text-muted-foreground">{note}</p>
              ))}
              {start.job.suspiciousLines > 0 ? (
                <p className="text-xs text-muted-foreground">La vacante traía texto dirigido a la IA; lo ignoramos.</p>
              ) : null}
              {start.aiMessage ? (
                <p className="rounded-xl border border-border p-2 text-xs" style={{ background: "#fff6dc" }}>
                  {start.aiMessage} Las tarjetas que no necesitan IA siguen disponibles.
                </p>
              ) : null}

              {closed.map((c) => (
                <div key={c.key} className={`rounded-xl border border-border px-3 py-2 text-sm font-semibold ${c.ok ? "text-green-deep" : "text-muted-foreground"}`}>
                  {c.ok ? "✓" : "–"} {c.label}
                </div>
              ))}

              {!done && card ? (
                <ActiveCard
                  key={card.id}
                  card={card}
                  facts={facts}
                  job={job}
                  start={start}
                  post={post}
                  turns={turns}
                  onTurn={() => setTurns((t) => t + 1)}
                  onApply={(next, label) => {
                    setFacts(next);
                    close(card, true, label);
                  }}
                  onSkip={(label) => close(card, false, label)}
                />
              ) : null}

              {done ? (
                <div className="rounded-2xl border-2 border-foreground p-3.5 bg-green-soft space-y-2">
                  <p className="text-sm">
                    <b>Tu hoja de vida quedó adaptada a «{job.title}».</b> Compatibilidad estimada{" "}
                    <b className="font-mono">{initial} → {score.compatibility.total}</b>. {closed.filter((c) => c.ok).length} cambios aprobados por ti; nada se agregó sin tu respuesta.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button className={btnPrimary} style={{ padding: "10px 18px" }} onClick={() => onDownload(facts)}>
                      Descargar mi hoja de vida
                    </button>
                    <button className={button} onClick={() => onUse(facts)}>Editar a mano</button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Tu hoja de vida base no cambia. La versión adaptada queda en este navegador hasta que la descargues o la guardes.
                  </p>
                  {tracker ? (
                    <SaveToTracker
                      canSave={tracker.canSave}
                      post={post}
                      body={{
                        job: { title: job.title, company: job.company, url: job.url ?? null },
                        adaptationId: start.adaptationId,
                        resumeId: tracker.resumeRef?.id ?? null,
                        resumeVersionNo: tracker.resumeRef?.versionNo ?? null,
                        scoreBefore: initial,
                        scoreAfter: score.compatibility.total,
                        facts
                      }}
                    />
                  ) : null}
                </div>
              ) : (
                <div className="flex justify-end">
                  <button className={ghost} onClick={onClose}>Salir</button>
                </div>
              )}
            </div>
          </div>
        </section>

        <section className={tab === "doc" ? "" : "hidden md:block"} aria-label="Tu hoja de vida">
          <div className="rounded-2xl border-2 border-foreground p-3" style={{ background: "#eef0ec" }}>
            <div className="flex justify-between items-center gap-2 text-sm mb-2">
              <b>Vista previa</b>
              <span className="text-muted-foreground">Turnos de chat: {turns}/{MAX_CHAT_TURNS}</span>
            </div>
            <div className="ink-card-sm rounded-2xl overflow-hidden bg-white max-h-[70vh] overflow-y-auto">
              <ResumeTemplate facts={facts} templateId={templateId} />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

// R4b: the adapted CV goes to the board with its scores. Free; it needs
// only «guardar en mi cuenta» (nothing stays on the server without it).
function SaveToTracker({
  canSave,
  post,
  body
}: {
  canSave: boolean;
  post: (path: string, body: unknown) => Promise<{ res: Response; data: any }>;
  body: Record<string, unknown>;
}) {
  const [state, setState] = useState<"idle" | "busy" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);
  if (!canSave) {
    return (
      <p className="text-xs text-muted-foreground">
        Para guardarla en Mis postulaciones activa «Guardar mi hoja de vida en mi cuenta» en Autorización.
      </p>
    );
  }
  const save = async () => {
    setState("busy");
    setError(null);
    try {
      const { res, data } = await post("/applications", body);
      if (!res.ok) {
        setState("idle");
        return setError(data?.error ?? "No pudimos guardarla.");
      }
      setState("saved");
    } catch {
      setState("idle");
      setError("No pudimos guardarla.");
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2" aria-live="polite">
      {state === "saved" ? (
        <p className="text-sm font-semibold text-green-deep">
          ✓ Guardada en <Link className="underline" to="/hoja-de-vida/postulaciones">Mis postulaciones</Link>.
        </p>
      ) : (
        <button className={button} onClick={() => void save()} disabled={state === "busy"}>
          Guardar en Mis postulaciones
        </button>
      )}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}

function ActiveCard({
  card,
  facts,
  job,
  start,
  post,
  turns,
  onTurn,
  onApply,
  onSkip
}: {
  card: Card;
  facts: ResumeFacts;
  job: TailorJob;
  start: StartResponse;
  post: (path: string, body: unknown) => Promise<{ res: Response; data: any }>;
  turns: number;
  onTurn: () => void;
  onApply: (next: ResumeFacts, label: string) => void;
  onSkip: (label: string) => void;
}) {
  if (card.type === "skills") return <SkillsCard card={card} facts={facts} onApply={onApply} onSkip={onSkip} />;
  if (card.type === "requirement_mapping") {
    return <MappingCard card={card} facts={facts} start={start} post={post} turns={turns} onTurn={onTurn} onApply={onApply} onSkip={onSkip} />;
  }
  const isHeadline = card.type === "headline";
  return (
    <ProposalCard
      kicker={isHeadline ? "Título del perfil" : "Perfil"}
      title={isHeadline ? "Alinear el título con la vacante" : "Resumen enfocado en la vacante"}
      before={isHeadline ? facts.basics.headline : facts.summary}
      cardType={isHeadline ? "headline" : "summary"}
      request={() =>
        post("/tailor/card", isHeadline
          ? { adaptationId: start.adaptationId, card: "headline", jobTitle: job.title, facts }
          : { adaptationId: start.adaptationId, card: "summary", jobTitle: job.title, tasks: start.job.tasks, facts })
      }
      chatContext={{ adaptationId: start.adaptationId, facts, experienceId: null, answer: "" }}
      post={post}
      turns={turns}
      onTurn={onTurn}
      onApply={(text) => onApply(isHeadline ? applyHeadline(facts, text) : applySummary(facts, text), isHeadline ? "Título actualizado" : "Perfil actualizado")}
      onSkip={() => onSkip(isHeadline ? "Título sin cambios" : "Perfil sin cambios")}
    />
  );
}

function describeClaims(claims: Claim[]): string {
  return claims.map((c) => `${CLAIM_LABEL[c.kind]} («${c.value}»)`).join(", ");
}

function ProposalCard({
  kicker,
  step,
  title,
  before,
  cardType,
  request,
  chatContext,
  post,
  turns,
  onTurn,
  onApply,
  onSkip,
  skipLabel = "Omitir"
}: {
  kicker: string;
  step?: string;
  title: string;
  before: string;
  cardType: "headline" | "summary" | "rewrite";
  request: () => Promise<{ res: Response; data: any }>;
  chatContext: { adaptationId: string; facts: ResumeFacts; experienceId: string | null; answer: string };
  post: (path: string, body: unknown) => Promise<{ res: Response; data: any }>;
  turns: number;
  onTurn: () => void;
  onApply: (text: string) => void;
  onSkip: () => void;
  skipLabel?: string;
}) {
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [chat, setChat] = useState("");
  const [reply, setReply] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // R4c: one model call per card and attempt, even with React's double effect.
  const [cardKey] = useState(() => newKey());
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setProposal(null);
    void (async () => {
      try {
        const { res, data } = await once(`card:${cardKey}:${attempt}`, request);
        if (cancelled) return;
        setProposal(res.ok ? data : { status: "error", error: data?.error ?? "No pudimos preparar la propuesta." });
      } catch {
        if (!cancelled) setProposal({ status: "error", error: "Se perdió la conexión al preparar la propuesta." });
      }
    })();
    return () => {
      cancelled = true;
    };
    // One request per card (and per «Reintentar»).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  const sendChat = async () => {
    if (!chat.trim() || proposal?.status !== "proposal") return;
    setBusy(true);
    setReply(null);
    try {
      const { res, data } = await post("/tailor/card", { ...chatContext, card: "chat", cardType, current: proposal.text, instruction: chat.trim() });
      onTurn();
      setChat("");
      if (!res.ok) return setReply(data?.error ?? "No pudimos ajustar la tarjeta.");
      if (data.status === "proposal") {
        setProposal(data);
        setReply(data.reply || "Listo.");
      } else {
        setReply(`No apliqué ese ajuste: agregaba ${describeClaims(data.claims ?? [])} que no está en tu hoja de vida.`);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <CardBox kicker={kicker} step={step} title={title}>
      {!proposal ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <span className="rs-spin" aria-hidden="true" /> Preparando la propuesta…
        </div>
      ) : null}
      {proposal?.status === "proposal" && editing === null ? (
        <>
          <p className="text-sm">
            {before ? <del style={delStyle}>{before}</del> : null} <ins style={insStyle}>{proposal.text}</ins>
          </p>
          {proposal.why ? <p className="text-xs text-muted-foreground mt-2">{proposal.why}</p> : null}
          {proposal.ask ? <p className="text-xs mt-1">Pregunta: {proposal.ask} Si tienes ese dato, usa «Editar» y escríbelo tú.</p> : null}
          {!proposal.byAi ? <p className="text-xs text-muted-foreground mt-1">IA apagada: es tu texto, con mayúscula y punto.</p> : null}
        </>
      ) : null}
      {proposal?.status === "question" ? (
        <p className="text-sm rounded-xl border border-border p-2" style={{ background: "#fff6dc" }}>{proposal.question}</p>
      ) : null}
      {proposal?.status === "discarded" ? (
        <p className="text-sm rounded-xl border border-border p-2" style={{ background: "#fff6dc" }}>
          Descartamos la propuesta: agregaba {describeClaims(proposal.claims)} que no está en tu hoja de vida. Puedes escribirlo tú u omitir.
        </p>
      ) : null}
      {proposal?.status === "error" ? (
        <div className="flex flex-wrap items-center gap-2">
          <p role="alert" className="text-sm" style={{ color: "#b42318" }}>{proposal.error}</p>
          <button className={button} onClick={() => setAttempt((a) => a + 1)}>Reintentar</button>
        </div>
      ) : null}

      {editing !== null ? (
        <textarea className={field} rows={3} value={editing} onChange={(e) => setEditing(e.target.value)} aria-label="Texto de la tarjeta" />
      ) : null}

      {proposal ? (
        <div className="flex flex-wrap gap-2 mt-3">
          {editing !== null ? (
            <>
              <button className={primary} disabled={!editing.trim()} onClick={() => onApply(editing.trim())}>Aplicar mi texto</button>
              <button className={ghost} onClick={() => setEditing(null)}>Cancelar</button>
            </>
          ) : (
            <>
              {proposal.status === "proposal" ? <button className={primary} onClick={() => onApply(proposal.text)}>Aplicar</button> : null}
              <button className={button} onClick={() => setEditing(proposal.status === "proposal" ? proposal.text : before)}>Editar</button>
              <button className={ghost} onClick={onSkip}>{skipLabel}</button>
            </>
          )}
        </div>
      ) : null}

      {proposal?.status === "proposal" && editing === null ? (
        <form
          className="flex gap-2 mt-3 pt-3 border-t border-border"
          onSubmit={(e) => {
            e.preventDefault();
            void sendChat();
          }}
        >
          <input
            className={field}
            value={chat}
            maxLength={300}
            onChange={(e) => setChat(e.target.value)}
            placeholder={turns >= MAX_CHAT_TURNS ? "Ya usaste los 8 ajustes" : "Pídele un ajuste a esta tarjeta (p. ej. «más corto»)"}
            aria-label="Ajuste para esta tarjeta"
            disabled={busy || turns >= MAX_CHAT_TURNS}
          />
          <button className={primary} disabled={busy || !chat.trim() || turns >= MAX_CHAT_TURNS}>Enviar</button>
        </form>
      ) : null}
      {reply ? <p className="text-xs text-muted-foreground mt-2">{reply}</p> : null}
    </CardBox>
  );
}

function SkillsCard({
  card,
  facts,
  onApply,
  onSkip
}: {
  card: Extract<Card, { type: "skills" }>;
  facts: ResumeFacts;
  onApply: (next: ResumeFacts, label: string) => void;
  onSkip: (label: string) => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  return (
    <CardBox kicker="Habilidades" title="Habilidades que pide la vacante">
      <p className="text-sm text-[#3d413e]">
        {card.present.length ? `${card.present.join(", ")} ya está en tu hoja de vida. ` : ""}La vacante también pide estas.{" "}
        <b>Marca solo las que hayas usado de verdad</b>: no agregamos ninguna por ti.
      </p>
      <div className="grid gap-2 mt-2">
        {card.options.map((skill) => (
          <label key={skill} className={`flex gap-2 items-center rounded-xl border-2 p-2 text-sm ${picked.includes(skill) ? "border-foreground" : "border-border"}`}>
            <input
              type="checkbox"
              aria-label={skill}
              checked={picked.includes(skill)}
              onChange={(e) => setPicked((list) => (e.target.checked ? [...list, skill] : list.filter((s) => s !== skill)))}
              style={{ width: 18, height: 18, accentColor: "#0f6b4f" }}
            />
            <span>{skill}</span>
          </label>
        ))}
      </div>
      <div className="flex flex-wrap gap-2 mt-3">
        <button className={primary} disabled={!picked.length} onClick={() => onApply(applySkills(facts, picked, card.options), `Agregadas: ${picked.join(", ")}`)}>
          Agregar las marcadas
        </button>
        <button className={ghost} onClick={() => onSkip("Sin habilidades nuevas")}>No tengo ninguna</button>
      </div>
    </CardBox>
  );
}

function MappingCard({
  card,
  facts,
  start,
  post,
  turns,
  onTurn,
  onApply,
  onSkip
}: {
  card: Extract<Card, { type: "requirement_mapping" }>;
  facts: ResumeFacts;
  start: StartResponse;
  post: (path: string, body: unknown) => Promise<{ res: Response; data: any }>;
  turns: number;
  onTurn: () => void;
  onApply: (next: ResumeFacts, label: string) => void;
  onSkip: (label: string) => void;
}) {
  const [where, setWhere] = useState<string>(card.suggested ?? card.options[0]?.experienceId ?? "elsewhere");
  const [place, setPlace] = useState("");
  const [answer, setAnswer] = useState("");
  const [submitted, setSubmitted] = useState<string | null>(null);
  const step = `${card.n}/${card.m}`;
  const label = (id: string) => card.options.find((o) => o.experienceId === id)?.label ?? (place.trim() || "Otra experiencia");

  if (submitted !== null) {
    const experienceId = where === "elsewhere" ? null : where;
    return (
      <>
        <div className="flex justify-end">
          <p className="rounded-xl bg-foreground text-white px-3 py-2 text-sm" style={{ maxWidth: "85%" }}>{submitted}</p>
        </div>
        <ProposalCard
          kicker={`Experiencia · ${label(where)}`}
          step={step}
          title="Nueva viñeta, primero en la lista"
          before=""
          cardType="rewrite"
          request={() => post("/tailor/card", { adaptationId: start.adaptationId, card: "rewrite", requirement: card.requirement, facts, experienceId, answer: submitted })}
          chatContext={{ adaptationId: start.adaptationId, facts, experienceId, answer: submitted }}
          post={post}
          turns={turns}
          onTurn={onTurn}
          onApply={(text) =>
            onApply(experienceId ? applyBullet(facts, { experienceId }, text) : applyBullet(facts, { elsewhere: place.trim() || "Otra experiencia" }, text), `«${card.requirement}» → ${label(where)}`)
          }
          onSkip={() => onSkip(`«${card.requirement}»: viñeta descartada`)}
          skipLabel="Descartar"
        />
      </>
    );
  }

  return (
    <CardBox kicker="¿Dónde hiciste esto?" step={step} title={card.requirement}>
      <p className="text-xs text-muted-foreground">
        {card.kind === "must" ? "Requisito obligatorio." : "Requisito deseable."} {card.suggested ? "Marqué donde lo veo en tu hoja de vida. Cámbialo si hace falta." : ""}
      </p>
      <div className="grid gap-2 mt-2" role="radiogroup" aria-label="Dónde lo hiciste">
        {[...card.options.map((o) => ({ id: o.experienceId, text: o.label, hint: "" })), { id: "none", text: "En ninguna", hint: "Queda como «no demostrado». No lo inventamos." }, { id: "elsewhere", text: "Lo hice en otro lugar", hint: "Proyecto, estudio, voluntariado…" }].map((o) => (
          <label key={o.id} className={`flex gap-2 items-start rounded-xl border-2 p-2 text-sm ${where === o.id ? "border-foreground" : "border-border"}`}>
            <input type="radio" aria-label={o.text} name={`map-${card.requirementId}`} checked={where === o.id} onChange={() => setWhere(o.id)} style={{ width: 18, height: 18, marginTop: 2, accentColor: "#0f6b4f" }} />
            <span>
              {o.text}
              {o.hint ? <span className="block text-xs text-muted-foreground">{o.hint}</span> : null}
            </span>
          </label>
        ))}
      </div>
      {where === "elsewhere" ? (
        <input className={`${field} mt-2`} value={place} maxLength={120} onChange={(e) => setPlace(e.target.value)} placeholder="¿Dónde? (p. ej. «Proyecto de grado»)" aria-label="Dónde lo hiciste" />
      ) : null}
      {where !== "none" ? (
        <>
          <label className="block text-xs font-semibold text-muted-foreground mt-3 mb-1" htmlFor={`ans-${card.requirementId}`}>
            ¿Qué hiciste exactamente? (tus palabras, con cifras si las tienes)
          </label>
          <textarea id={`ans-${card.requirementId}`} className={field} rows={2} maxLength={600} value={answer} onChange={(e) => setAnswer(e.target.value)} />
        </>
      ) : null}
      <div className="flex flex-wrap gap-2 mt-3">
        <button
          className={primary}
          disabled={where !== "none" && answer.trim().length < 3}
          onClick={() => (where === "none" ? onSkip(`«${card.requirement}»: no demostrado`) : setSubmitted(answer.trim()))}
        >
          Continuar
        </button>
        <button className={ghost} onClick={() => onSkip(`«${card.requirement}»: omitido`)}>Omitir</button>
      </div>
    </CardBox>
  );
}
