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
import { normalizeText } from "../../lib/resume-tailor/text.js";
import { answerProblem, bestBullet, evidenceFor, formatYears, yearsFromCv, type EvidenceItem } from "../../lib/resume-tailor/assist.js";

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
  // R4c: every card shows how its change moves the score (same public formula, in the browser).
  const scoreOf = useCallback(
    (f: ResumeFacts) => (start ? compatibilityScore(start.job, computeEvidence(start.job.requirements, f, start.citations), f).total : 0),
    [start]
  );

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
                  scoreOf={scoreOf}
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

// ---------- R4c cards: the AI proposes, the user approves ----------------
// Owner's rule: never an empty box to fill. Every proposal shows the
// vacancy requirement it serves, BEFORE → AFTER, the CV evidence it stands
// on, the validator's verdict and how the score moves. Edits open with the
// proposal already written, «✨ Mejorar con IA» is always there, and «no»,
// «nada» or «-» never reach the CV.

type Post = (path: string, body: unknown) => Promise<{ res: Response; data: any }>;
type ScoreOf = (facts: ResumeFacts) => number;

function ActiveCard({
  card,
  facts,
  job,
  start,
  post,
  turns,
  onTurn,
  onApply,
  onSkip,
  scoreOf
}: {
  card: Card;
  facts: ResumeFacts;
  job: TailorJob;
  start: StartResponse;
  post: Post;
  turns: number;
  onTurn: () => void;
  onApply: (next: ResumeFacts, label: string) => void;
  onSkip: (label: string) => void;
  scoreOf: ScoreOf;
}) {
  if (card.type === "skills") return <SkillsCard card={card} facts={facts} scoreOf={scoreOf} onApply={onApply} onSkip={onSkip} />;
  if (card.type === "requirement_mapping") {
    return <MappingCard card={card} facts={facts} start={start} post={post} turns={turns} onTurn={onTurn} onApply={onApply} onSkip={onSkip} scoreOf={scoreOf} />;
  }
  const isHeadline = card.type === "headline";
  return (
    <ProposalCard
      kicker={isHeadline ? "Título del perfil" : "Perfil"}
      title={isHeadline ? "Alinear el título con la vacante" : "Resumen enfocado en la vacante"}
      requirement={isHeadline ? `Cargo de la vacante: «${job.title}»` : `Perfil para «${job.title}»${start.job.tasks.length ? `: ${start.job.tasks.slice(0, 2).join("; ")}` : ""}`}
      target={isHeadline ? "Título del perfil (debajo de tu nombre)" : "Perfil (primer párrafo de tu hoja de vida)"}
      before={isHeadline ? facts.basics.headline : facts.summary}
      cardType={isHeadline ? "headline" : "summary"}
      request={() =>
        post(
          "/tailor/card",
          isHeadline
            ? { adaptationId: start.adaptationId, card: "headline", jobTitle: job.title, facts }
            : { adaptationId: start.adaptationId, card: "summary", jobTitle: job.title, tasks: start.job.tasks, facts }
        )
      }
      chatContext={{ adaptationId: start.adaptationId, facts, experienceId: null, answer: "" }}
      facts={facts}
      jobTitle={job.title}
      scopeExperienceId={null}
      post={post}
      turns={turns}
      onTurn={onTurn}
      scoreOf={scoreOf}
      apply={(text) => (isHeadline ? applyHeadline(facts, text) : applySummary(facts, text))}
      onApplied={(next, text) => onApply(next, `${isHeadline ? "Título del perfil" : "Perfil"} actualizado: «${snip(text)}»`)}
      onSkip={(why) => onSkip(why ?? `${isHeadline ? "Título del perfil" : "Perfil"}: no se cambió nada`)}
    />
  );
}

function describeClaims(claims: Claim[]): string {
  return claims.map((c) => `${CLAIM_LABEL[c.kind]} («${c.value}»)`).join(", ");
}

const snip = (text: string, n = 70) => (text.length > n ? `${text.slice(0, n).trimEnd()}…` : text);

const NEGATIVE_LABEL = "Sin esa experiencia: no se escribió nada en tu hoja de vida";

function Verdict({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <p
      className="text-xs font-semibold rounded-lg px-2 py-1"
      style={{ display: "inline-block", background: ok ? "#e2f4ec" : "#fff6dc", color: ok ? "#074a3a" : "#6b4e00", border: `1px solid ${ok ? "#b6e2cc" : "#e8d9a6"}` }}
    >
      {children}
    </p>
  );
}

function BeforeAfter({ before, after, target, strike = true }: { before: string; after: string; target: string; strike?: boolean }) {
  return (
    <div className="grid gap-2 mt-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
      <div className="rounded-xl border border-border p-2">
        <p className="font-mono text-xs font-semibold uppercase tracking-wide text-muted-foreground">Antes</p>
        <p className="text-sm mt-1" style={{ color: before ? "#3d413e" : "#8a918b" }}>
          {before ? strike ? <del style={delStyle}>{before}</del> : before : "— (no había nada para este punto)"}
        </p>
      </div>
      <div className="rounded-xl p-2" style={{ border: "2px solid #0f6b4f", background: "#f3fbf7" }}>
        <p className="font-mono text-xs font-semibold uppercase tracking-wide" style={{ color: "#0f6b4f" }}>Después · {target}</p>
        <p className="text-sm mt-1">
          <ins style={insStyle}>{after}</ins>
        </p>
      </div>
    </div>
  );
}

function EvidenceList({ items, answer }: { items: EvidenceItem[]; answer?: string }) {
  if (!items.length && !answer) return null;
  return (
    <div className="mt-2 text-xs" style={{ color: "#3d413e" }}>
      <p className="font-semibold">Se apoya en:</p>
      <ul className="mt-1 space-y-1" style={{ paddingLeft: 0, listStyle: "none" }}>
        {answer ? (
          <li>
            💬 Lo que contaste: <q>{snip(answer, 160)}</q>
          </li>
        ) : null}
        {items.map((e) => (
          <li key={e.factId}>
            📄 Tu CV{e.where ? ` · ${e.where}` : ""}: <q>{snip(e.text, 160)}</q>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ScoreDelta({ from, to }: { from: number; to: number }) {
  const d = to - from;
  return (
    <p className="text-xs mt-2" style={{ color: d > 0 ? "#074a3a" : "#5a605b" }}>
      Compatibilidad: <b className="rs-num">{from} → {to}</b>
      {d > 0 ? ` (+${d})` : d < 0 ? ` (${d})` : " (igual: mejora cómo se lee, no el puntaje)"}
    </p>
  );
}

function ProposalCard({
  kicker,
  step,
  title,
  requirement,
  target,
  before,
  cardType,
  request,
  chatContext,
  facts,
  jobTitle,
  scopeExperienceId,
  answer,
  post,
  turns,
  onTurn,
  scoreOf,
  apply,
  onApplied,
  onSkip,
  onBack,
  beforeFor
}: {
  kicker: string;
  step?: string;
  title: string;
  /** The vacancy requirement this card serves (always shown). */
  requirement: string;
  /** Where the text goes in the CV («Experiencia · X — primera viñeta»). */
  target: string;
  before: string;
  cardType: "headline" | "summary" | "rewrite";
  request: () => Promise<{ res: Response; data: any }>;
  chatContext: { adaptationId: string; facts: ResumeFacts; experienceId: string | null; answer: string };
  facts: ResumeFacts;
  jobTitle: string;
  scopeExperienceId: string | null;
  /** The user's own words, when the card started from them. */
  answer?: string;
  post: Post;
  turns: number;
  onTurn: () => void;
  scoreOf: ScoreOf;
  apply: (text: string) => ResumeFacts;
  onApplied: (next: ResumeFacts, text: string) => void;
  onSkip: (why?: string) => void;
  /** Mapping cards: go back and pick another experience. */
  onBack?: () => void;
  /** When the proposal is a bullet the CV already has, what «antes» and «dónde» really are. */
  beforeFor?: (text: string) => { before: string; target: string } | null;
}) {
  const [proposal, setProposal] = useState<(Proposal & { supportingFactIds?: string[]; discardedText?: string; question?: string }) | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [chat, setChat] = useState("");
  const [reply, setReply] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cardKey] = useState(() => newKey());
  const [attempt, setAttempt] = useState(0);
  const editRef = useRef<HTMLTextAreaElement>(null);
  const now = useMemo(() => scoreOf(facts), [facts, scoreOf]);

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

  // Figures the CV itself can answer (owner: «Según tu CV: ~X años»).
  const asked = proposal?.status === "question" ? proposal.question : proposal?.status === "proposal" ? proposal.ask ?? "" : "";
  const years = /años|years|experiencia/i.test(asked) ? yearsFromCv(facts, jobTitle) : null;

  /** One AI turn on the active card (chat): improve, redraft without a missing fact, or add a confirmed fact. */
  const runAi = async (current: string, instruction: string, confirmed = "") => {
    if (turns >= MAX_CHAT_TURNS) {
      setReply(`Ya usaste los ${MAX_CHAT_TURNS} ajustes con IA de esta adaptación. Puedes editar el texto a mano.`);
      return;
    }
    setBusy(true);
    setReply(null);
    try {
      const { res, data } = await post("/tailor/card", {
        ...chatContext,
        answer: confirmed || chatContext.answer,
        card: "chat",
        cardType,
        current: (current || before || requirement).slice(0, 1200),
        instruction: instruction.slice(0, 300)
      });
      onTurn();
      if (!res.ok) return setReply(data?.error ?? "No pudimos ajustar la tarjeta.");
      if (data.status === "proposal") {
        setProposal(data);
        setEditing(null);
        setEditError(null);
        setReply(data.reply || "Listo: revisa el antes y después.");
      } else if (data.claims?.length) {
        setReply(`No lo apliqué: agregaba ${describeClaims(data.claims)}, que no está en tu hoja de vida.`);
      } else {
        setReply(`${data.question || "Tu hoja de vida no muestra esto."} No se aplicó nada: elige otra experiencia, cuéntalo tú o no cambies nada.`);
      }
    } catch {
      setReply("Se perdió la conexión. Inténtalo de nuevo.");
    } finally {
      setBusy(false);
    }
  };

  const startEdit = () => {
    // Never an empty box: the proposal, the discarded draft, the current text or the best CV bullet.
    const seed =
      (proposal?.status === "proposal" && proposal.text) ||
      (proposal?.status === "question" && proposal.discardedText) ||
      before ||
      bestBullet(facts, requirement, scopeExperienceId)?.text ||
      "";
    setEditing(seed);
    setEditError(null);
    setTimeout(() => editRef.current?.focus(), 0);
  };

  const applyOwn = () => {
    const text = (editing ?? "").trim();
    const problem = answerProblem(text);
    if (problem === "negative") return onSkip(`${NEGATIVE_LABEL} («${snip(requirement, 60)}»).`);
    if (problem === "too_short") {
      setEditError("Escribe al menos una frase completa (por ejemplo, qué hiciste y con qué), o usa «✨ Mejorar con IA».");
      editRef.current?.focus();
      return;
    }
    onApplied(apply(text), text);
  };

  const evidence = proposal?.status === "proposal" ? evidenceFor(facts, proposal.text, proposal.supportingFactIds ?? [], scopeExperienceId) : [];
  const fromAnswerOnly = proposal?.status === "proposal" && !evidence.length && Boolean(answer);

  return (
    <CardBox kicker={kicker} step={step} title={title}>
      <p className="text-xs" style={{ color: "#5a605b" }}>
        <b>Requisito de la vacante:</b> {requirement}
      </p>

      {!proposal ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground mt-2" role="status">
          <span className="rs-spin" aria-hidden="true" /> Preparando la propuesta con tu hoja de vida…
        </div>
      ) : null}

      {proposal?.status === "proposal" && editing === null ? (
        <>
          <div className="mt-2">
            <Verdict ok>{fromAnswerOnly ? "✓ Verificado con lo que contaste" : "✓ Verificado con tu CV: no agrega datos nuevos"}</Verdict>
          </div>
          {(() => {
            const moved = beforeFor?.(proposal.text) ?? null;
            return (
              <>
                <BeforeAfter before={moved?.before ?? before} after={proposal.text} target={moved?.target ?? target} strike={!moved} />
                {moved ? <p className="text-xs mt-1" style={{ color: "#074a3a" }}>Ya está en tu CV: no se duplica, solo sube al primer lugar de esa experiencia.</p> : null}
              </>
            );
          })()}
          <EvidenceList items={evidence} answer={answer} />
          {proposal.why ? <p className="text-xs mt-2" style={{ color: "#3d413e" }}>Por qué: {proposal.why}</p> : null}
          <ScoreDelta from={now} to={scoreOf(apply(proposal.text))} />
          {proposal.ask ? (
            <p className="text-xs mt-1">
              Dato que podría sumar: {proposal.ask}
              {years ? (
                <>
                  {" "}Según tu CV: <b>{formatYears(years.years)}</b>{" "}
                  <button
                    className="underline font-semibold"
                    disabled={busy}
                    onClick={() =>
                      void runAi(proposal.text, `Incluye este dato que confirmo: tengo ${formatYears(years.years)} de experiencia${years.focused ? ` como ${jobTitle}` : ""}.`, `Tengo ${formatYears(years.years)} de experiencia${years.focused ? ` como ${jobTitle}` : ""}, según las fechas de mi hoja de vida.`)
                    }
                  >
                    Agregarlo
                  </button>
                </>
              ) : null}
            </p>
          ) : null}
          {!proposal.byAi ? <p className="text-xs text-muted-foreground mt-1">IA apagada: es tu texto, con mayúscula y punto.</p> : null}
        </>
      ) : null}

      {(proposal?.status === "question" || proposal?.status === "discarded") && editing === null ? (
        <div className="mt-2 space-y-2">
          <Verdict ok={false}>Sin evidencia en tu CV: no se aplica nada</Verdict>
          <p className="text-sm" style={{ color: "#3d413e" }}>
            {proposal.status === "question"
              ? proposal.question
              : `La propuesta agregaba ${describeClaims(proposal.claims)}, que no está en tu hoja de vida.`}
          </p>
          {years ? (
            <div className="rounded-xl border border-border p-2 text-sm flex flex-wrap items-center gap-2">
              <span>
                Según las fechas de tu CV{years.focused ? ` (${years.count} experiencia${years.count === 1 ? "" : "s"} como ${jobTitle})` : ""}: <b>{formatYears(years.years)}</b>
              </span>
              <button
                className={btnPrimary}
                disabled={busy}
                onClick={() =>
                  void runAi(
                    (proposal.status === "question" && proposal.discardedText) || before,
                    `Incluye este dato que confirmo: tengo ${formatYears(years.years)} de experiencia${years.focused ? ` como ${jobTitle}` : ""}. No agregues otros datos.`,
                    `Tengo ${formatYears(years.years)} de experiencia${years.focused ? ` como ${jobTitle}` : ""}, según las fechas de mi hoja de vida.`
                  )
                }
              >
                Usar este dato
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {proposal?.status === "error" ? (
        <div className="flex flex-wrap items-center gap-2 mt-2">
          <p role="alert" className="text-sm" style={{ color: "#b42318" }}>{proposal.error}</p>
          <button className={button} onClick={() => setAttempt((a) => a + 1)}>Reintentar</button>
        </div>
      ) : null}

      {editing !== null ? (
        <div className="mt-2">
          <label className="block text-xs font-semibold text-muted-foreground mb-1" htmlFor={`edit-${cardKey}`}>
            Ajusta el texto · va en {target}
          </label>
          <textarea
            ref={editRef}
            id={`edit-${cardKey}`}
            className={field}
            rows={3}
            value={editing}
            aria-invalid={editError ? true : undefined}
            onChange={(e) => {
              setEditing(e.target.value);
              if (editError) setEditError(null);
            }}
          />
          {editError ? (
            <p role="alert" className="text-sm mt-1" style={{ color: "#b42318" }}>
              {editError}
            </p>
          ) : null}
        </div>
      ) : null}

      {proposal && proposal.status !== "error" ? (
        <div className="flex flex-wrap gap-2 mt-3">
          {editing !== null ? (
            <>
              <button className={primary} disabled={busy} onClick={applyOwn}>Aplicar mi texto</button>
              <button
                className={button}
                disabled={busy || !editing.trim()}
                onClick={() => void runAi(editing, `Mejora la redacción de este texto para el requisito «${requirement.slice(0, 120)}», sin agregar datos que no estén en mi hoja de vida ni en este texto.`, editing)}
              >
                {busy ? <span className="rs-spin" aria-hidden="true" /> : null}✨ Mejorar con IA
              </button>
              <button className={ghost} disabled={busy} onClick={() => setEditing(null)}>Cancelar</button>
            </>
          ) : proposal.status === "proposal" ? (
            <>
              <button className={primary} onClick={() => onApplied(apply(proposal.text), proposal.text)}>Aplicar</button>
              <button className={button} onClick={startEdit}>Editar</button>
              <button className={ghost} onClick={() => onSkip()} title="Tu hoja de vida queda como estaba en este punto.">No cambiar nada</button>
            </>
          ) : (
            <>
              <button
                className={primary}
                disabled={busy}
                onClick={() => void runAi((proposal.status === "question" && proposal.discardedText) || before, "Redáctalo solo con datos de mi hoja de vida; quita lo que no esté en ella.")}
              >
                {busy ? <span className="rs-spin" aria-hidden="true" /> : null}✨ Redactar solo con mi CV
              </button>
              {onBack ? <button className={button} onClick={onBack}>← Elegir otra experiencia</button> : null}
              <button className={button} onClick={startEdit}>Editar</button>
              <button className={ghost} onClick={() => onSkip()} title="Tu hoja de vida queda como estaba en este punto.">No cambiar nada</button>
            </>
          )}
        </div>
      ) : null}

      {proposal?.status === "proposal" && editing === null ? (
        <form
          className="flex gap-2 mt-3 pt-3 border-t border-border"
          onSubmit={(e) => {
            e.preventDefault();
            if (!chat.trim()) return;
            void runAi(proposal.text, chat.trim()).then(() => setChat(""));
          }}
        >
          <input
            className={field}
            value={chat}
            maxLength={300}
            onChange={(e) => setChat(e.target.value)}
            placeholder={turns >= MAX_CHAT_TURNS ? `Ya usaste los ${MAX_CHAT_TURNS} ajustes` : "Pídele un ajuste (p. ej. «más corto»)"}
            aria-label="Ajuste para esta tarjeta"
            disabled={busy || turns >= MAX_CHAT_TURNS}
          />
          <button className={primary} disabled={busy || !chat.trim() || turns >= MAX_CHAT_TURNS}>Enviar</button>
        </form>
      ) : null}
      {reply ? <p className="text-xs text-muted-foreground mt-2" role="status">{reply}</p> : null}
    </CardBox>
  );
}

function SkillsCard({
  card,
  facts,
  scoreOf,
  onApply,
  onSkip
}: {
  card: Extract<Card, { type: "skills" }>;
  facts: ResumeFacts;
  scoreOf: ScoreOf;
  onApply: (next: ResumeFacts, label: string) => void;
  onSkip: (label: string) => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const now = useMemo(() => scoreOf(facts), [facts, scoreOf]);
  const next = useMemo(() => (picked.length ? applySkills(facts, picked, card.options) : facts), [facts, picked, card.options]);
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
      {picked.length ? <ScoreDelta from={now} to={scoreOf(next)} /> : null}
      <div className="flex flex-wrap gap-2 mt-3">
        <button className={primary} disabled={!picked.length} onClick={() => onApply(next, `Habilidades agregadas: ${picked.join(", ")}`)}>
          Agregar las marcadas
        </button>
        <button className={ghost} onClick={() => onSkip("Habilidades: no se agregó ninguna")}>No tengo ninguna</button>
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
  onSkip,
  scoreOf
}: {
  card: Extract<Card, { type: "requirement_mapping" }>;
  facts: ResumeFacts;
  start: StartResponse;
  post: Post;
  turns: number;
  onTurn: () => void;
  onApply: (next: ResumeFacts, label: string) => void;
  onSkip: (label: string) => void;
  scoreOf: ScoreOf;
}) {
  const [where, setWhere] = useState<string>(card.suggested ?? card.options[0]?.experienceId ?? "elsewhere");
  const [place, setPlace] = useState("");
  // «draft» = the AI writes it from the CV; «answer» = the user's own words.
  const [submitted, setSubmitted] = useState<{ mode: "answer" | "draft"; text: string } | null>(null);
  const [writing, setWriting] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const answerRef = useRef<HTMLTextAreaElement>(null);
  const step = `${card.n}/${card.m}`;
  const isExperience = where !== "none" && where !== "elsewhere";
  const label = (id: string) => card.options.find((o) => o.experienceId === id)?.label ?? (place.trim() || "Otra experiencia");
  const best = isExperience ? bestBullet(facts, card.requirement, where) : null;
  const shortReq = snip(card.requirement, 60);

  if (submitted !== null) {
    const experienceId = isExperience ? where : null;
    const draft = submitted.mode === "draft";
    return (
      <>
        <div className="flex justify-end">
          <p className="rounded-xl bg-foreground text-white px-3 py-2 text-sm" style={{ maxWidth: "85%" }}>
            {draft ? `Redáctalo tú con lo que ya dice mi hoja de vida en ${label(where)}.` : submitted.text}
          </p>
        </div>
        <ProposalCard
          kicker={`Experiencia · ${label(where)}`}
          step={step}
          title={draft ? "Viñeta redactada con tu hoja de vida" : "Tu respuesta, como viñeta"}
          requirement={`${card.requirement} (${card.kind === "must" ? "obligatorio" : "deseable"})`}
          target={`${label(where)} · primera viñeta`}
          before=""
          cardType="rewrite"
          request={() =>
            draft && experienceId
              ? post("/tailor/card", { adaptationId: start.adaptationId, card: "draft", requirement: card.requirement, facts, experienceId })
              : post("/tailor/card", { adaptationId: start.adaptationId, card: "rewrite", requirement: card.requirement, facts, experienceId, answer: submitted.text })
          }
          chatContext={{ adaptationId: start.adaptationId, facts, experienceId, answer: draft ? "" : submitted.text }}
          facts={facts}
          jobTitle={card.requirement}
          scopeExperienceId={experienceId}
          answer={draft ? undefined : submitted.text}
          post={post}
          turns={turns}
          onTurn={onTurn}
          scoreOf={scoreOf}
          apply={(text) => (experienceId ? applyBullet(facts, { experienceId }, text) : applyBullet(facts, { elsewhere: place.trim() || "Otra experiencia" }, text))}
          onApplied={(next, text) => onApply(next, `Agregado en ${label(where)} (primera viñeta): «${snip(text)}»`)}
          onSkip={(why) => onSkip(why ?? `«${shortReq}»: no se cambió nada`)}
          onBack={() => setSubmitted(null)}
          beforeFor={(text) => {
            const exp = experienceId ? facts.experience.find((e) => e.id === experienceId) : null;
            const norm = (v: string) => normalizeText(v).replace(/[.;]$/, "");
            const i = exp ? exp.bullets.findIndex((b) => norm(b.text) === norm(text)) : -1;
            if (!exp || i < 0) return null;
            return { before: `${exp.bullets[i].text} (viñeta ${i + 1} de ${exp.bullets.length})`, target: `${label(where)} · sube a la primera viñeta` };
          }}
        />
      </>
    );
  }

  const sendOwn = () => {
    const text = (writing ?? "").trim();
    const problem = answerProblem(text);
    if (problem === "negative") return onSkip(`«${shortReq}»: ${NEGATIVE_LABEL.toLowerCase()}`);
    if (where === "elsewhere" && !place.trim()) return setHint("Escribe dónde lo hiciste (por ejemplo, «Proyecto de grado»).");
    if (problem === "too_short") {
      setHint("Escribe al menos una frase (qué hiciste y con qué). Si prefieres, usa «✨ Que la IA lo redacte».");
      answerRef.current?.focus();
      return;
    }
    if (text.length < 80 && /\b(escoge|elige|hazlo|redact\w*|escr[ií]be\w*|lo necesario|por m[ií]|t[uú] mism[oa])\b/i.test(text)) {
      setHint("Eso parece una instrucción para la IA. Para que la escriba por ti, usa «✨ Que la IA lo redacte».");
      answerRef.current?.focus();
      return;
    }
    setHint(null);
    setSubmitted({ mode: "answer", text });
  };

  const openWriting = () => {
    // Never an empty box: start from the CV bullet that best matches (the user's own words).
    setWriting(best?.text ?? "");
    setHint(null);
    setTimeout(() => answerRef.current?.focus(), 0);
  };

  return (
    <CardBox kicker="¿Dónde hiciste esto?" step={step} title={card.requirement}>
      <p className="text-xs text-muted-foreground">
        Requisito {card.kind === "must" ? "obligatorio" : "deseable"} de la vacante. {card.suggested ? "Marqué la experiencia donde más se ve en tu hoja de vida; cámbiala si hace falta." : "Elige dónde lo hiciste."}
      </p>
      <div className="grid gap-2 mt-2" role="radiogroup" aria-label="Dónde lo hiciste">
        {[
          ...card.options.map((o) => ({ id: o.experienceId, text: o.label, hint: "" })),
          { id: "elsewhere", text: "Lo hice en otro lugar", hint: "Proyecto, estudio, voluntariado…" },
          { id: "none", text: "No tengo esa experiencia", hint: "No se escribe nada. No lo inventamos." }
        ].map((o) => (
          <label key={o.id} className={`flex gap-2 items-start rounded-xl border-2 p-2 text-sm ${where === o.id ? "border-foreground" : "border-border"}`}>
            <input
              type="radio"
              aria-label={o.text}
              name={`map-${card.requirementId}`}
              checked={where === o.id}
              onChange={() => {
                setWhere(o.id);
                setWriting(null);
                setHint(null);
              }}
              style={{ width: 18, height: 18, marginTop: 2, accentColor: "#0f6b4f" }}
            />
            <span>
              {o.text}
              {o.hint ? <span className="block text-xs text-muted-foreground">{o.hint}</span> : null}
            </span>
          </label>
        ))}
      </div>

      {isExperience && best ? (
        <p className="text-xs mt-2" style={{ color: "#3d413e" }}>
          📄 En tu CV ({label(where)}): <q>{snip(best.text, 150)}</q>
        </p>
      ) : null}

      {where === "elsewhere" ? (
        <input className={`${field} mt-2`} value={place} maxLength={120} onChange={(e) => setPlace(e.target.value)} placeholder="¿Dónde? (p. ej. «Proyecto de grado»)" aria-label="Dónde lo hiciste" />
      ) : null}

      {writing !== null || where === "elsewhere" ? (
        <>
          <label className="block text-xs font-semibold text-muted-foreground mt-3 mb-1" htmlFor={`ans-${card.requirementId}`}>
            Cuéntalo con tus palabras (ajusta el texto)
          </label>
          <textarea
            ref={answerRef}
            id={`ans-${card.requirementId}`}
            className={field}
            rows={3}
            maxLength={600}
            value={writing ?? ""}
            placeholder={where === "elsewhere" ? "Ej.: Automaticé las pruebas de regresión del proyecto de grado con Selenium." : undefined}
            aria-invalid={hint ? true : undefined}
            aria-describedby={hint ? `hint-${card.requirementId}` : undefined}
            onChange={(e) => {
              setWriting(e.target.value);
              if (hint) setHint(null);
            }}
          />
        </>
      ) : null}
      {hint ? (
        <p id={`hint-${card.requirementId}`} role="alert" className="text-sm mt-2" style={{ color: "#b42318" }}>
          {hint}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2 mt-3">
        {where === "none" ? (
          <button className={primary} onClick={() => onSkip(`«${shortReq}»: ${NEGATIVE_LABEL.toLowerCase()}`)}>Continuar sin este requisito</button>
        ) : isExperience && writing === null ? (
          <>
            <button className={primary} onClick={() => setSubmitted({ mode: "draft", text: "" })}>
              ✨ Que la IA lo redacte
            </button>
            <button className={button} onClick={openWriting}>Lo cuento yo</button>
          </>
        ) : (
          <>
            <button className={primary} onClick={sendOwn}>Continuar</button>
            {isExperience ? (
              <button className={button} onClick={() => setSubmitted({ mode: "draft", text: "" })}>
                ✨ Que la IA lo redacte
              </button>
            ) : null}
          </>
        )}
        <button className={ghost} onClick={() => onSkip(`«${shortReq}»: no se cambió nada`)} title="Tu hoja de vida queda como estaba en este punto.">
          No cambiar nada
        </button>
      </div>
      {isExperience && writing === null ? (
        <p className="text-xs text-muted-foreground mt-2">
          La IA usa solo lo que ya dice tu hoja de vida en esa experiencia. Tú ves el antes y después y decides.
        </p>
      ) : null}
    </CardBox>
  );
}
