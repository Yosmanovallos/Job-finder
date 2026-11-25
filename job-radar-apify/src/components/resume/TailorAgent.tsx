import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ResumeTemplate } from "./ResumeTemplate.js";
import type { ResumeFacts, ResumeTemplateId } from "../../lib/resume-studio.js";
import { applyBullet, applyHeadline, applySummary, confirmSkill, MAX_CHAT_TURNS, requirementGaps, toolAnswer, type Card } from "../../lib/resume-tailor/cards.js";
import { computeEvidence, type Citation } from "../../lib/resume-tailor/evidence.js";
import type { Claim } from "../../lib/resume-tailor/factuality.js";
import type { JobAnalysis } from "../../lib/resume-tailor/requirements.js";
import { compatibilityScore, qualityScore } from "../../lib/resume-tailor/score.js";
import { btnPrimary, newKey, once, Steps, useStagedSteps } from "./ui.js";
import { normalizeText } from "../../lib/resume-tailor/text.js";
import { answerProblem, bestBullet, evidenceFor, formatYears, yearsFit, yearsFromCv, type EvidenceItem } from "../../lib/resume-tailor/assist.js";
import { actionReducer, IDLE, outcomeFor, SLOW_AFTER_MS, type ActionState, type CardAnswer, type NextStep } from "../../lib/resume-tailor/action-state.js";
import { languageMismatch, LANGUAGE_NAME, type CvLanguage } from "../../lib/resume-tailor/language.js";

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
  /** R4d: every change goes in the CV's language (detected by code). */
  language?: { cv: CvLanguage | null; job: CvLanguage | null };
}

type Proposal =
  | { status: "proposal"; text: string; why: string; byAi: boolean; reply?: string; ask?: string }
  | { status: "question"; claims: Claim[]; question: string }
  | { status: "discarded"; claims: Claim[]; reason?: string; language?: CvLanguage | null }
  | { status: "error"; error: string };

interface Closed {
  key: string;
  ok: boolean;
  label: string;
  /** R4d: something the vacancy asks for that the user said they don't have («Jenkins»). */
  gap?: string;
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
    async (path: string, body: unknown, signal?: AbortSignal) => {
      const res = await fetch(`/api/resume${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify(body),
        signal
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

  const close = (card: Card, ok: boolean, label: string, gap?: string) => {
    setClosed((list) => [...list, { key: `${card.id}-${list.length}`, ok, label, ...(gap ? { gap } : {}) }]);
    setCursor((c) => c + 1);
  };
  const baseIds = useMemo(
    () => new Set([...baseFacts.experience.flatMap((e) => [e.id, ...e.bullets.map((b) => b.id)]), ...baseFacts.skills.map((x) => x.id), "headline", "summary"]),
    [baseFacts]
  );

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
              {start.language?.cv ? (
                <p className="text-sm text-[#3d413e]">
                  {start.language.job && start.language.job !== start.language.cv
                    ? `La vacante está en ${LANGUAGE_NAME[start.language.job]} y tu hoja de vida en ${LANGUAGE_NAME[start.language.cv]}: haremos todos los cambios en ${LANGUAGE_NAME[start.language.cv]}, para que no se mezclen idiomas.`
                    : `Tu hoja de vida está en ${LANGUAGE_NAME[start.language.cv]}: haremos todos los cambios en ${LANGUAGE_NAME[start.language.cv]}.`}
                </p>
              ) : null}
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
                  onSkip={(label, gap) => close(card, false, label, gap)}
                  scoreOf={scoreOf}
                  baseIds={baseIds}
                  cvLang={start.language?.cv ?? null}
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
                  {closed.some((c) => c.gap) ? (
                    <p className="text-sm" style={{ color: "#3d413e" }}>
                      <b>Lo que la vacante pide y tu hoja de vida no muestra:</b> {closed.filter((c) => c.gap).map((c) => c.gap).join(", ")}. No lo
                      agregamos. Si lo estás aprendiendo, puedes contarlo en la entrevista.
                    </p>
                  ) : null}
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

// ---------- R4c/R4d cards: the AI proposes, the user approves ------------
// Owner's rule: never an empty box to fill. Every proposal shows the
// vacancy requirement it serves, BEFORE → AFTER, the CV evidence it stands
// on, the validator's verdict and how the score moves. Edits open with the
// proposal already written, «✨ Mejorar con IA» is always there, and «no»,
// «nada» or «-» never reach the CV.
// R4d (report «Adaptación de CV con IA», P0): missing tools are asked one by
// one; every AI button shows it is working on the button itself, offers
// Cancelar after 10 s and answers IN PLACE of the button; «no evidence» says
// what is missing, that we don't invent it and what to do. The copy is the
// report's PROPOSAL: not yet tested with users.

type Post = (path: string, body: unknown, signal?: AbortSignal) => Promise<{ res: Response; data: any }>;
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
  scoreOf,
  baseIds,
  cvLang
}: {
  card: Card;
  facts: ResumeFacts;
  job: TailorJob;
  start: StartResponse;
  post: Post;
  turns: number;
  onTurn: () => void;
  onApply: (next: ResumeFacts, label: string) => void;
  onSkip: (label: string, gap?: string) => void;
  scoreOf: ScoreOf;
  baseIds: Set<string>;
  cvLang: CvLanguage | null;
}) {
  const shared = { facts, start, post, turns, onTurn, onApply, onSkip, scoreOf, baseIds, cvLang };
  if (card.type === "tool") return <ToolCard card={card} {...shared} />;
  if (card.type === "requirement_mapping") return <MappingCard card={card} {...shared} />;
  const isHeadline = card.type === "headline";
  return (
    <ProposalCard
      kicker={isHeadline ? "Título del perfil" : "Perfil"}
      title={isHeadline ? "Alinear el título con la vacante" : "Resumen enfocado en la vacante"}
      requirement={isHeadline ? `Cargo de la vacante: «${job.title}»` : `Perfil para «${job.title}»${start.job.tasks.length ? `: ${start.job.tasks.slice(0, 2).join("; ")}` : ""}`}
      target={isHeadline ? "Título del perfil (debajo de tu nombre)" : "Perfil (primer párrafo de tu hoja de vida)"}
      before={isHeadline ? facts.basics.headline : facts.summary}
      cardType={isHeadline ? "headline" : "summary"}
      request={(signal) =>
        post(
          "/tailor/card",
          isHeadline
            ? { adaptationId: start.adaptationId, card: "headline", jobTitle: job.title, facts }
            : { adaptationId: start.adaptationId, card: "summary", jobTitle: job.title, tasks: start.job.tasks, facts },
          signal
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
      baseIds={baseIds}
      cvLang={cvLang}
      apply={(text) => (isHeadline ? applyHeadline(facts, text) : applySummary(facts, text))}
      onApplied={(next, text) => onApply(next, `${isHeadline ? "Título del perfil" : "Perfil"} actualizado: «${snip(text)}»`)}
      onSkip={(why) => onSkip(why ?? `${isHeadline ? "Título del perfil" : "Perfil"}: dejamos esta parte como estaba`)}
    />
  );
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

/**
 * R4d provenance (report P1, done with P0-3): a line of the CV the user
 * started with is «Basado en tu hoja de vida», shown literally; anything
 * added in this adaptation (a tool they confirmed, their own words) is «Lo
 * que nos contaste». Facts found only by shared words are a guess: listed
 * as «Se parece a», never as backing.
 */
function EvidenceList({ items, answer, baseIds }: { items: EvidenceItem[]; answer?: string; baseIds: Set<string> }) {
  if (!items.length && !answer) return null;
  const cited = items.some((e) => e.cited);
  return (
    <div className="mt-2 text-xs" style={{ color: "#3d413e" }}>
      <p className="font-semibold">{cited || answer ? "Se apoya en:" : "Se parece a estas líneas de tu hoja de vida:"}</p>
      <ul className="mt-1 space-y-1" style={{ paddingLeft: 0, listStyle: "none" }}>
        {answer ? (
          <li>
            💬 Basado en lo que nos contaste: <q>{snip(answer, 160)}</q>
          </li>
        ) : null}
        {items.map((e) => (
          <li key={e.factId}>
            {baseIds.has(e.factId) ? `📄 Basado en tu hoja de vida${e.where ? ` (${e.where})` : ""}` : "💬 Basado en lo que nos contaste"}: <q>{snip(e.text, 160)}</q>
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

/** The button while its AI call runs: spinner and verb on the button itself; after 10 s, a notice and Cancelar. */
function Working({ label, slow, onCancel }: { label: string; slow: boolean; onCancel: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2" role="status" aria-live="polite">
      <button className={primary} disabled aria-busy="true" style={{ opacity: 1, cursor: "progress" }}>
        <span className="rs-spin" aria-hidden="true" />
        {label}
      </button>
      {slow ? (
        <>
          <span className="text-sm" style={{ color: "#3d413e" }}>Esto está tardando más de lo normal.</span>
          <button className={button} onClick={onCancel}>Cancelar</button>
        </>
      ) : null}
    </div>
  );
}

const NEXT_LABEL: Record<NextStep, string> = { back: "Elegir otra experiencia", tell: "Contarlo yo", skip: "Saltar", retry: "Intentar de nuevo" };

/** An AI button's answer, shown where the button was: normal size, with what to do next. */
function Outcome({ state, onNext, can }: { state: Extract<ActionState, { kind: "result" }>; onNext: (step: NextStep) => void; can: (step: NextStep) => boolean }) {
  const color = state.tone === "error" ? "#b42318" : "#3d413e";
  return (
    <div className="rounded-xl p-3 space-y-2" role="status" aria-live="polite" style={{ border: "2px solid #e8d9a6", background: "#fffaf0" }}>
      <p className="text-sm" style={{ color }}>
        <b>{state.title}.</b> {state.text}
      </p>
      <div className="flex flex-wrap gap-2">
        {state.next.filter(can).map((step, i) => (
          <button key={step} className={i === 0 ? primary : step === "skip" ? ghost : button} onClick={() => onNext(step)}>
            {NEXT_LABEL[step]}
          </button>
        ))}
      </div>
    </div>
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
  baseIds,
  cvLang,
  gaps = [],
  apply,
  onApplied,
  onSkip,
  onBack,
  onTell,
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
  request: (signal?: AbortSignal) => Promise<{ res: Response; data: any }>;
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
  /** Ids of the facts of the CV the user started with (provenance). */
  baseIds: Set<string>;
  cvLang: CvLanguage | null;
  /** R4d: tools this requirement names that the CV doesn't show (said, never written). */
  gaps?: string[];
  apply: (text: string) => ResumeFacts;
  onApplied: (next: ResumeFacts, text: string) => void;
  onSkip: (why?: string) => void;
  /** Mapping cards: go back and pick another experience. */
  onBack?: () => void;
  /** «Contarlo yo»: the user's own words (mapping cards go back to their answer box). */
  onTell?: () => void;
  /** When the proposal is a bullet the CV already has, what «antes» and «dónde» really are. */
  beforeFor?: (text: string) => { before: string; target: string } | null;
}) {
  const [proposal, setProposal] = useState<(Proposal & { supportingFactIds?: string[]; discardedText?: string; question?: string }) | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [chat, setChat] = useState("");
  const [flash, setFlash] = useState<string | null>(null);
  const [act, setAct] = useState<ActionState>(IDLE);
  const dispatch = useCallback((event: Parameters<typeof actionReducer>[1]) => setAct((s) => actionReducer(s, event)), []);
  const [cardKey] = useState(() => newKey());
  const [attempt, setAttempt] = useState(0);
  const [loadSlow, setLoadSlow] = useState(false);
  const editRef = useRef<HTMLTextAreaElement>(null);
  const callRef = useRef<AbortController | null>(null);
  const lastRun = useRef<(() => void) | null>(null);
  const loadRef = useRef<{ attempt: number; ctrl: AbortController } | null>(null);
  const now = useMemo(() => scoreOf(facts), [facts, scoreOf]);
  const busy = act.kind === "working";

  useEffect(() => {
    let cancelled = false;
    setProposal(null);
    setLoadSlow(false);
    // One controller per attempt, shared by React's double effect (once() shares the request too).
    if (loadRef.current?.attempt !== attempt) loadRef.current = { attempt, ctrl: new AbortController() };
    const ctrl = loadRef.current.ctrl;
    const slow = setTimeout(() => setLoadSlow(true), SLOW_AFTER_MS);
    void (async () => {
      try {
        const { res, data } = await once(`card:${cardKey}:${attempt}`, () => request(ctrl.signal));
        if (cancelled || ctrl.signal.aborted) return;
        setProposal(res.ok ? data : { status: "error", error: data?.error ?? "No pudimos preparar la propuesta." });
      } catch {
        if (!cancelled && !ctrl.signal.aborted) setProposal({ status: "error", error: "Se perdió la conexión al preparar la propuesta." });
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(slow);
    };
    // One request per card (and per «Intentar de nuevo»).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  // 10 s into an AI turn: progress notice and Cancelar.
  useEffect(() => {
    if (act.kind !== "working") return;
    const t = setTimeout(() => dispatch({ type: "tick", at: Date.now() }), Math.max(0, act.startedAt + SLOW_AFTER_MS - Date.now()));
    return () => clearTimeout(t);
  }, [act, dispatch]);

  // Figures the CV itself can answer («Según tu CV: ~X años») — only when the card asks for a number of years.
  const asked = proposal?.status === "question" ? proposal.question : proposal?.status === "proposal" ? proposal.ask ?? "" : "";
  const computed = useMemo(() => yearsFromCv(facts, jobTitle), [facts, jobTitle]);
  const years = computed && yearsFit({ requirement, question: asked, allowQuestion: cardType !== "rewrite", focused: computed.focused }) ? computed : null;
  const yearsFact = years ? `Tengo ${formatYears(years.years)} de experiencia${years.focused ? ` como ${jobTitle}` : ""}, según las fechas de mi hoja de vida.` : "";

  /** One AI turn on the active card: improve, redraft without a missing fact, or add a confirmed fact. */
  const runAi = async (action: string, current: string, instruction: string, confirmed = "") => {
    lastRun.current = () => void runAi(action, current, instruction, confirmed);
    dispatch({ type: "start", action, at: Date.now() });
    setFlash(null);
    if (turns >= MAX_CHAT_TURNS) {
      dispatch({ type: "done", outcome: { tone: "info", title: "Sin ajustes con IA", text: `Ya usaste los ${MAX_CHAT_TURNS} ajustes con IA de esta adaptación. Puedes escribirlo tú.`, next: ["tell", "skip"] } });
      return;
    }
    const ctrl = new AbortController();
    callRef.current = ctrl;
    try {
      const { res, data } = await post(
        "/tailor/card",
        {
          ...chatContext,
          answer: confirmed || chatContext.answer,
          card: "chat",
          cardType,
          current: (current || before || requirement).slice(0, 1200),
          instruction: instruction.slice(0, 300)
        },
        ctrl.signal
      );
      if (ctrl.signal.aborted) return;
      onTurn();
      if (!res.ok) return dispatch({ type: "done", outcome: outcomeFor({ status: "error", error: data?.error ?? "No pudimos ajustar la tarjeta." }, requirement) });
      if (data.status === "proposal") {
        setProposal(data);
        setEditing(null);
        setEditError(null);
        setFlash(data.reply || "Listo: revisa el antes y el después.");
        dispatch({ type: "done", outcome: null });
        return;
      }
      dispatch({ type: "done", outcome: outcomeFor(data as CardAnswer, requirement) });
    } catch {
      if (!ctrl.signal.aborted) dispatch({ type: "done", outcome: outcomeFor({ status: "error", error: "Se perdió la conexión. Inténtalo de nuevo." }, requirement) });
    }
  };
  const cancel = () => {
    callRef.current?.abort();
    dispatch({ type: "cancel" });
  };

  const startEdit = () => {
    // Never an empty box — but only with VERIFIED text: the proposal, the current
    // text or the best CV bullet. A discarded draft (it had data the CV doesn't
    // show, e.g. «40%») is never prefilled: one click would put it in the CV.
    const seed =
      (proposal?.status === "proposal" && proposal.text) ||
      before ||
      bestBullet(facts, requirement, scopeExperienceId)?.text ||
      "";
    dispatch({ type: "clear" });
    setEditing(seed);
    setEditError(null);
    setTimeout(() => editRef.current?.focus(), 0);
  };
  const tell = onTell ?? startEdit;
  const skipHere = () => onSkip(`«${snip(requirement, 60)}»: dejamos esta parte como estaba`);
  const next = (step: NextStep) => {
    if (step === "back") onBack?.();
    else if (step === "tell") tell();
    else if (step === "skip") skipHere();
    else if (lastRun.current) lastRun.current();
    else {
      dispatch({ type: "clear" });
      setAttempt((a) => a + 1);
    }
  };
  const canNext = (step: NextStep) => step !== "back" || Boolean(onBack);

  /** The button, or — while its call runs or once it answered — the work/answer in its place. */
  const slot = (id: string, workingLabel: string, node: ReactNode) =>
    act.kind === "working" && act.action === id ? (
      <Working label={workingLabel} slow={act.slow} onCancel={cancel} />
    ) : act.kind === "result" && act.action === id ? (
      <Outcome state={act} onNext={next} can={canNext} />
    ) : (
      node
    );

  const applyOwn = () => {
    const text = (editing ?? "").trim();
    const problem = answerProblem(text);
    if (problem === "negative") return onSkip(`${NEGATIVE_LABEL} («${snip(requirement, 60)}»).`);
    if (problem === "too_short") {
      setEditError("Escribe al menos una frase completa (por ejemplo, qué hiciste y con qué), o usa «✨ Mejorar con IA».");
      editRef.current?.focus();
      return;
    }
    // R4d: one language per CV. Their own words in the other language don't go in as they are.
    if (cvLang && languageMismatch(text, cvLang)) {
      setEditError(`Tu hoja de vida está en ${LANGUAGE_NAME[cvLang]}. Escríbelo en ${LANGUAGE_NAME[cvLang]} o usa «✨ Mejorar con IA» para pasarlo a ${LANGUAGE_NAME[cvLang]} sin agregar datos.`);
      editRef.current?.focus();
      return;
    }
    onApplied(apply(text), text);
  };

  const evidence = proposal?.status === "proposal" ? evidenceFor(facts, proposal.text, proposal.supportingFactIds ?? [], scopeExperienceId) : [];
  const toldByUser = Boolean(answer) || evidence.some((e) => e.cited && !baseIds.has(e.factId));
  const fromCv = evidence.some((e) => e.cited && baseIds.has(e.factId));
  const verdictText = toldByUser
    ? fromCv
      ? "✓ Basado en lo que nos contaste y en tu hoja de vida"
      : "✓ Basado en lo que nos contaste"
    : fromCv
      ? "✓ Basado en tu hoja de vida: no agrega datos nuevos"
      : "Reformulado con tus palabras: no agrega datos nuevos";
  const notice = proposal && (proposal.status === "question" || proposal.status === "discarded") ? outcomeFor(proposal as CardAnswer, requirement) : null;

  return (
    <CardBox kicker={kicker} step={step} title={title}>
      <p className="text-xs" style={{ color: "#5a605b" }}>
        <b>Requisito de la vacante:</b> {requirement}
      </p>
      {gaps.length ? (
        <p className="text-xs mt-1" style={{ color: "#6b4e00" }}>
          Esta parte también pide <b>{gaps.join(", ")}</b>, que tu hoja de vida no muestra: esta viñeta no {gaps.length === 1 ? "lo" : "los"} agrega.
        </p>
      ) : null}

      {!proposal ? (
        <div className="mt-2 space-y-2" role="status" aria-live="polite">
          <div className="flex items-center gap-2 text-sm" style={{ color: "#3d413e" }}>
            <span className="rs-spin" aria-hidden="true" /> Preparando la propuesta con tu hoja de vida…
          </div>
          {loadSlow ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm" style={{ color: "#3d413e" }}>Esto está tardando más de lo normal.</span>
              <button
                className={button}
                onClick={() => {
                  loadRef.current?.ctrl.abort();
                  setProposal({ status: "error", error: "Cancelado: no se cambió nada." });
                }}
              >
                Cancelar
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {proposal?.status === "proposal" && editing === null ? (
        <>
          {flash ? (
            <p className="text-sm mt-2 font-semibold" role="status" style={{ color: "#074a3a" }}>
              ✓ {flash}
            </p>
          ) : null}
          <div className="mt-2">
            <Verdict ok={toldByUser || fromCv}>{verdictText}</Verdict>
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
          <EvidenceList items={evidence} answer={answer} baseIds={baseIds} />
          {proposal.why ? <p className="text-xs mt-2" style={{ color: "#3d413e" }}>Por qué: {proposal.why}</p> : null}
          <ScoreDelta from={now} to={scoreOf(apply(proposal.text))} />
          {proposal.ask && years ? (
            <div className="mt-2 text-sm flex flex-wrap items-center gap-2">
              <span>
                Dato que podría sumar: {proposal.ask} Según tu CV: <b>{formatYears(years.years)}</b>
              </span>
              {slot(
                "years-add",
                "Agregando el dato…",
                <button
                  className={button}
                  disabled={busy}
                  onClick={() => void runAi("years-add", proposal.text, `Incluye este dato que confirmo: tengo ${formatYears(years.years)} de experiencia${years.focused ? ` como ${jobTitle}` : ""}. No agregues otros datos.`, yearsFact)}
                >
                  Agregarlo
                </button>
              )}
            </div>
          ) : null}
          {!proposal.byAi ? <p className="text-xs text-muted-foreground mt-1">IA apagada: es tu texto, con mayúscula y punto.</p> : null}
        </>
      ) : null}

      {notice && editing === null ? (
        <div className="mt-2 space-y-2">
          <div className="rounded-xl p-3" style={{ border: "2px solid #e8d9a6", background: "#fffaf0" }}>
            <p className="text-sm" style={{ color: "#3d413e" }}>
              <b>{notice.title}.</b> {notice.text}
            </p>
          </div>
          {years ? (
            <div className="rounded-xl border border-border p-2 text-sm flex flex-wrap items-center gap-2">
              <span>
                Según las fechas de tu CV{years.focused ? ` (${years.count} experiencia${years.count === 1 ? "" : "s"} en esa área)` : ""}: <b>{formatYears(years.years)}</b>
              </span>
              {slot(
                "years",
                "Redactando con ese dato…",
                <button
                  className={btnPrimary}
                  disabled={busy}
                  onClick={() =>
                    void runAi(
                      "years",
                      (proposal?.status === "question" && proposal.discardedText) || before,
                      `Incluye este dato que confirmo: tengo ${formatYears(years.years)} de experiencia${years.focused ? ` como ${jobTitle}` : ""}. No agregues otros datos.`,
                      yearsFact
                    )
                  }
                >
                  Usar este dato
                </button>
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      {proposal?.status === "error" ? (
        <div className="flex flex-wrap items-center gap-2 mt-2">
          <p role="alert" className="text-sm" style={{ color: "#b42318" }}>{proposal.error}</p>
          <button className={button} onClick={() => setAttempt((a) => a + 1)}>Intentar de nuevo</button>
          <button className={ghost} onClick={skipHere}>Saltar</button>
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
              {slot(
                "improve",
                "Mejorando la redacción…",
                <button
                  className={button}
                  disabled={busy || !editing.trim()}
                  onClick={() => void runAi("improve", editing, `Mejora la redacción de este texto para el requisito «${requirement.slice(0, 120)}», sin agregar datos que no estén en mi hoja de vida ni en este texto.`, editing)}
                >
                  ✨ Mejorar con IA
                </button>
              )}
              <button className={ghost} disabled={busy} onClick={() => setEditing(null)}>Cancelar</button>
            </>
          ) : proposal.status === "proposal" ? (
            <>
              <button className={primary} disabled={busy} onClick={() => onApplied(apply(proposal.text), proposal.text)}>Aplicar</button>
              <button className={button} disabled={busy} onClick={startEdit}>Editar</button>
              <button className={ghost} disabled={busy} onClick={() => onSkip()} title="Tu hoja de vida queda como estaba en este punto.">No cambiar nada</button>
            </>
          ) : (
            <>
              {slot(
                "redraft",
                "Redactando con tu experiencia…",
                <button
                  className={primary}
                  disabled={busy}
                  onClick={() => void runAi("redraft", (proposal.status === "question" && proposal.discardedText) || before, "Redáctalo solo con datos de mi hoja de vida; quita lo que no esté en ella.")}
                >
                  ✨ Redactar solo con mi CV
                </button>
              )}
              <button className={button} disabled={busy} onClick={tell}>Sí, te cuento</button>
              {onBack ? <button className={button} disabled={busy} onClick={onBack}>← Elegir otra experiencia</button> : null}
              <button className={ghost} disabled={busy} onClick={skipHere} title="Tu hoja de vida queda como estaba en este punto.">No, saltar</button>
            </>
          )}
        </div>
      ) : null}

      {proposal?.status === "proposal" && editing === null ? (
        <div className="mt-3 pt-3 border-t border-border">
          {act.kind !== "idle" && act.action === "chat" ? (
            slot("chat", "Ajustando…", null)
          ) : (
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!chat.trim()) return;
                const ask = chat.trim();
                setChat("");
                void runAi("chat", proposal.text, ask);
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
          )}
        </div>
      ) : null}
    </CardBox>
  );
}

/**
 * R4d (report P0 1): ONE tool the vacancy asks for and the CV doesn't show.
 * «Sí» → where (a job, a project, a course) and, optionally, one short
 * phrase; only then a bullet is drafted, from that phrase alone. «No» →
 * nothing is written, it goes to the list of things to work on. «Algo
 * parecido» → tools of the same family the CV already shows; the missing
 * tool's name is never written.
 */
function ToolCard({
  card,
  facts,
  start,
  post,
  turns,
  onTurn,
  onApply,
  onSkip,
  scoreOf,
  baseIds,
  cvLang
}: {
  card: Extract<Card, { type: "tool" }>;
  facts: ResumeFacts;
  start: StartResponse;
  post: Post;
  turns: number;
  onTurn: () => void;
  onApply: (next: ResumeFacts, label: string) => void;
  onSkip: (label: string, gap?: string) => void;
  scoreOf: ScoreOf;
  baseIds: Set<string>;
  cvLang: CvLanguage | null;
}) {
  const [mode, setMode] = useState<"ask" | "yes" | "similar">("ask");
  const [where, setWhere] = useState<string | null>(null);
  const [phrase, setPhrase] = useState("");
  const [similar, setSimilar] = useState<string | null>(card.related[0] ?? null);
  const [other, setOther] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ experienceId: string; answer: string } | null>(null);
  const now = useMemo(() => scoreOf(facts), [facts, scoreOf]);
  const skill = card.skill;
  const step = `${card.n}/${card.m}`;
  const label = (id: string | null) =>
    id === "project" ? "un proyecto" : id === "course" ? "un curso" : card.options.find((o) => o.experienceId === id)?.label ?? "";
  const inSkills = (name: string) => facts.skills.some((x) => x.name.trim().toLowerCase() === name.toLowerCase());
  const withSkill = useMemo(() => confirmSkill(facts, skill), [facts, skill]);
  const skillsLine = facts.skills.map((x) => x.name).filter(Boolean).join(" · ");

  if (draft) {
    const place = label(draft.experienceId);
    return (
      <>
        <div className="flex justify-end">
          <p className="rounded-xl bg-foreground text-white px-3 py-2 text-sm" style={{ maxWidth: "85%" }}>
            Sí, usé {skill} en {place}: {phrase.trim()}
          </p>
        </div>
        <ProposalCard
          kicker={`${skill} · ${place}`}
          step={step}
          title="Tu respuesta, como viñeta"
          requirement={card.requirement ?? `La vacante pide ${skill}`}
          target={`${place} · primera viñeta (y ${skill} en Habilidades)`}
          before=""
          cardType="rewrite"
          request={(signal) =>
            post("/tailor/card", { adaptationId: start.adaptationId, card: "rewrite", requirement: card.requirement ?? skill, facts, experienceId: draft.experienceId, answer: draft.answer }, signal)
          }
          chatContext={{ adaptationId: start.adaptationId, facts, experienceId: draft.experienceId, answer: draft.answer }}
          facts={facts}
          jobTitle={card.requirement ?? skill}
          scopeExperienceId={draft.experienceId}
          answer={draft.answer}
          post={post}
          turns={turns}
          onTurn={onTurn}
          scoreOf={scoreOf}
          baseIds={baseIds}
          cvLang={cvLang}
          apply={(text) => confirmSkill(applyBullet(facts, { experienceId: draft.experienceId }, text), skill)}
          onApplied={(next, text) => onApply(next, `${skill}: viñeta en ${place} y en Habilidades, con lo que nos contaste: «${snip(text)}»`)}
          onSkip={() => onSkip(`${skill}: dejamos tu hoja de vida como estaba`)}
          onBack={() => setDraft(null)}
          onTell={() => setDraft(null)}
        />
      </>
    );
  }

  const yesLabel = card.kind === "tool" ? "Sí, lo he usado" : "Sí";
  const sayNo = () => onSkip(`${skill}: no lo agregamos. Lo verás en tu lista de cosas por reforzar`, skill);

  const addYes = () => {
    if (!where) return setHint(`Elige dónde usaste ${skill}.`);
    const text = phrase.trim();
    if (!text) {
      return onApply(withSkill, `${skill} agregado a Habilidades (lo confirmaste tú${where ? `, en ${label(where)}` : ""})`);
    }
    const problem = answerProblem(text);
    if (problem === "negative") return sayNo();
    if (problem === "too_short") return setHint("Escribe una frase corta de qué hiciste (por ejemplo, con qué y para qué), o deja el campo vacío para agregarlo solo a Habilidades.");
    if (where === "project" || where === "course") {
      return onApply(withSkill, `${skill} agregado a Habilidades (lo usaste en ${label(where)}, según nos contaste)`);
    }
    setHint(null);
    setDraft({ experienceId: where, answer: toolAnswer(skill, text) });
  };

  return (
    <CardBox kicker="Lo que pide la vacante" step={step} title={card.question}>
      <p className="text-sm" style={{ color: "#3d413e" }}>
        La vacante pide <b>{skill}</b> y no aparece en tu hoja de vida.
        {card.requirement ? <span className="block text-xs mt-1" style={{ color: "#5a605b" }}>En la vacante: «{snip(card.requirement, 140)}»</span> : null}
      </p>

      {mode === "ask" ? (
        <>
          <div className="flex flex-wrap gap-2 mt-3">
            <button className={primary} onClick={() => setMode("yes")}>{yesLabel}</button>
            {card.kind === "tool" ? <button className={button} onClick={() => setMode("similar")}>Algo parecido</button> : null}
            <button className={button} onClick={sayNo}>No</button>
          </div>
          <p className="text-xs text-muted-foreground mt-2">Solo agregamos lo que confirmes. Si respondes «No», no se escribe nada.</p>
        </>
      ) : null}

      {mode === "yes" ? (
        <div className="mt-3 space-y-2">
          <p className="text-sm font-semibold">¿Dónde lo usaste?</p>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={`Dónde usaste ${skill}`}>
            {[...card.options.map((o) => ({ id: o.experienceId, text: o.label })), { id: "project", text: "En un proyecto" }, { id: "course", text: "En un curso" }].map((o) => (
              <button
                key={o.id}
                role="radio"
                aria-checked={where === o.id}
                className={`rounded-xl border-2 px-3 py-1.5 text-sm font-semibold ${where === o.id ? "border-foreground bg-foreground text-white" : "border-border bg-white"}`}
                onClick={() => {
                  setWhere(o.id);
                  setHint(null);
                }}
              >
                {o.text}
              </button>
            ))}
          </div>
          <label className="block text-xs font-semibold text-muted-foreground" htmlFor={`tool-${card.id}`}>
            ¿Qué hiciste con {skill}? (opcional, una frase con tus palabras)
          </label>
          <input
            id={`tool-${card.id}`}
            className={field}
            value={phrase}
            maxLength={300}
            onChange={(e) => {
              setPhrase(e.target.value);
              if (hint) setHint(null);
            }}
            placeholder={cvLang === "en" ? `E.g.: ran the regression suite with ${skill} on every release.` : `Ej.: ejecuté la suite de regresión con ${skill} en cada entrega.`}
          />
          <BeforeAfter before={skillsLine} after={[skillsLine, skill].filter(Boolean).join(" · ")} target="Habilidades" strike={false} />
          <ScoreDelta from={now} to={scoreOf(withSkill)} />
          {hint ? (
            <p role="alert" className="text-sm" style={{ color: "#b42318" }}>
              {hint}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button className={primary} onClick={addYes}>
              {phrase.trim() && where && where !== "project" && where !== "course" ? "✨ Redactar la viñeta con esto" : `Agregar ${skill} a Habilidades`}
            </button>
            <button className={ghost} onClick={() => setMode("ask")}>← Volver</button>
          </div>
          <p className="text-xs text-muted-foreground">
            Con una frase en un trabajo, la IA redacta una viñeta solo con lo que escribiste. Sin frase, solo se agrega a Habilidades.
          </p>
        </div>
      ) : null}

      {mode === "similar" ? (
        <div className="mt-3 space-y-2">
          {card.related.length ? (
            <>
              <p className="text-sm">
                Tu hoja de vida ya muestra estas, parecidas a {skill}. ¿Cuál usaste? <b>No escribimos {skill}.</b>
              </p>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Herramienta parecida">
                {card.related.map((r) => (
                  <button
                    key={r}
                    role="radio"
                    aria-checked={similar === r}
                    className={`rounded-xl border-2 px-3 py-1.5 text-sm font-semibold ${similar === r ? "border-foreground bg-foreground text-white" : "border-border bg-white"}`}
                    onClick={() => setSimilar(r)}
                  >
                    {r}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                {similar && !inSkills(similar) ? (
                  <button
                    className={primary}
                    onClick={() => onApply(applySkillName(facts, similar), `${similar} destacado en Habilidades (ya estaba en tu hoja de vida; ${skill} no se agregó)`)}
                  >
                    Destacar {similar} en Habilidades
                  </button>
                ) : (
                  <button className={primary} disabled={!similar} onClick={() => onSkip(`${skill}: no lo agregamos; tu hoja de vida ya muestra ${similar}, que es parecido`, `${skill} (tienes ${similar})`)}>
                    Continuar
                  </button>
                )}
                <button className={ghost} onClick={() => setMode("ask")}>← Volver</button>
              </div>
            </>
          ) : (
            <>
              <label className="block text-sm" htmlFor={`similar-${card.id}`}>
                ¿Cuál usaste en lugar de {skill}? <b>No escribimos {skill}</b>; agregamos la que nos digas a Habilidades.
              </label>
              <input id={`similar-${card.id}`} className={field} value={other} maxLength={40} onChange={(e) => setOther(e.target.value)} placeholder="Nombre de la herramienta" />
              {hint ? (
                <p role="alert" className="text-sm" style={{ color: "#b42318" }}>
                  {hint}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <button
                  className={primary}
                  onClick={() => {
                    const name = other.trim();
                    if (name.length < 2 || answerProblem(`${name} herramienta usada`) === "negative" || /^(no|nada|ninguna?)$/i.test(name)) {
                      return setHint("Escribe el nombre de la herramienta, o vuelve y responde «No».");
                    }
                    onApply(applySkillName(facts, name), `${name} agregado a Habilidades (lo contaste tú; ${skill} no se agregó)`);
                  }}
                >
                  Agregar a Habilidades
                </button>
                <button className={ghost} onClick={() => setMode("ask")}>← Volver</button>
              </div>
            </>
          )}
        </div>
      ) : null}
    </CardBox>
  );
}

/** A skill the user named (or one the CV already shows), added to the Skills list only. */
function applySkillName(facts: ResumeFacts, name: string): ResumeFacts {
  return confirmSkill(facts, name.trim().slice(0, 60));
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
  scoreOf,
  baseIds,
  cvLang
}: {
  card: Extract<Card, { type: "requirement_mapping" }>;
  facts: ResumeFacts;
  start: StartResponse;
  post: Post;
  turns: number;
  onTurn: () => void;
  onApply: (next: ResumeFacts, label: string) => void;
  onSkip: (label: string, gap?: string) => void;
  scoreOf: ScoreOf;
  baseIds: Set<string>;
  cvLang: CvLanguage | null;
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
  // R4d: tools this requirement names that the CV still doesn't show — said, never written.
  const gaps = useMemo(() => requirementGaps(card.requirement, facts), [card.requirement, facts]);

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
          request={(signal) =>
            draft && experienceId
              ? post("/tailor/card", { adaptationId: start.adaptationId, card: "draft", requirement: card.requirement, facts, experienceId }, signal)
              : post("/tailor/card", { adaptationId: start.adaptationId, card: "rewrite", requirement: card.requirement, facts, experienceId, answer: submitted.text }, signal)
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
          baseIds={baseIds}
          cvLang={cvLang}
          gaps={gaps}
          apply={(text) => (experienceId ? applyBullet(facts, { experienceId }, text) : applyBullet(facts, { elsewhere: place.trim() || "Otra experiencia" }, text))}
          onApplied={(next, text) => onApply(next, `Agregado en ${label(where)} (primera viñeta): «${snip(text)}»`)}
          onSkip={(why) => onSkip(why ?? `«${shortReq}»: dejamos esta parte como estaba`)}
          onBack={() => setSubmitted(null)}
          onTell={() => {
            // (openWriting is declared below this early return: inline it.)
            setSubmitted(null);
            setWriting(best?.text ?? "");
            setHint(null);
            setTimeout(() => answerRef.current?.focus(), 0);
          }}
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
      {gaps.length ? (
        <p className="text-xs mt-1" style={{ color: "#6b4e00" }}>
          Pide <b>{gaps.join(", ")}</b>, que tu hoja de vida no muestra. No {gaps.length === 1 ? "lo" : "los"} escribimos por ti: la viñeta usa solo lo que ya hiciste.
        </p>
      ) : null}
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
