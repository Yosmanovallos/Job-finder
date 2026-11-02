import { useEffect, useRef, useState, type FormEvent } from "react";
import { useLocation } from "react-router-dom";
import { ROUTE_META } from "../lib/page-meta.js";
import { CONTACT_EMAIL } from "../lib/agent-readiness.js";
import { TINTS } from "../lib/brand-tints.js";
import { ContentCta, ContentSection, PageHero, SectionHeading } from "../components/ContentPage.js";
import { SITE_CHANGELOG, formatChangelogDate } from "../lib/site-changelog.js";
import {
  FEEDBACK_LIMITS,
  OPINION_CATEGORIES,
  PROBLEM_CATEGORIES,
  opinionCategoryLabel,
  type FeedbackKind,
  type FeedbackLinkState,
  type PublishedOpinion
} from "../lib/site-feedback.js";

// /opiniones — "Opiniones y ayuda". Same frame as the other content pages
// (ContentPage.tsx). The form sits in the hero so reporting is above the
// fold; below it, what we improved and the published opinions. The H1 is
// ROUTE_META's heading, the exact string server.ts puts in the raw HTML.

type Status = "idle" | "sending" | "sent" | "error";

const inputClass =
  "w-full rounded-xl border-2 border-foreground bg-white px-3.5 py-3 text-[15px] text-foreground placeholder:text-[#6b6f6c] focus:outline-none focus:ring-2 focus:ring-primary";

function referrerPath(): string | null {
  try {
    if (!document.referrer) return null;
    const url = new URL(document.referrer);
    return url.origin === window.location.origin && url.pathname !== "/opiniones" ? url.pathname : null;
  } catch {
    return null;
  }
}

function FeedbackForm({
  linkState,
  kind,
  setKind
}: {
  linkState: FeedbackLinkState["feedback"];
  kind: FeedbackKind;
  setKind: (kind: FeedbackKind) => void;
}) {
  const [problemCategory, setProblemCategory] = useState(
    PROBLEM_CATEGORIES.some((c) => c.id === linkState?.category) ? linkState!.category! : ""
  );
  const [opinionCategory, setOpinionCategory] = useState("");
  const [message, setMessage] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [city, setCity] = useState("");
  const [attachContext, setAttachContext] = useState(false);
  const [consentPublish, setConsentPublish] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [fallbackToEmail, setFallbackToEmail] = useState(false);
  const honeypot = useRef<HTMLInputElement>(null);

  const [context] = useState(() => ({
    pagePath: linkState?.pagePath ?? referrerPath(),
    search: linkState?.search?.trim() || null
  }));

  const category = kind === "problem" ? problemCategory : opinionCategory;
  const categories = kind === "problem" ? PROBLEM_CATEGORIES : OPINION_CATEGORIES;

  const switchKind = (next: FeedbackKind) => {
    setKind(next);
    setError(null);
    setStatus("idle");
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!category) {
      setError(kind === "problem" ? "Elige qué falló." : "Elige cómo te fue.");
      return;
    }
    setStatus("sending");
    setError(null);
    setFallbackToEmail(false);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          category,
          message,
          displayName: kind === "opinion" ? displayName : undefined,
          city: kind === "opinion" ? city : undefined,
          consentPublish: kind === "opinion" ? consentPublish : undefined,
          attachContext: kind === "problem" && attachContext,
          pagePath: kind === "problem" && attachContext ? context.pagePath : undefined,
          search: kind === "problem" && attachContext ? context.search : undefined,
          website: honeypot.current?.value || ""
        })
      });
      if (res.ok) {
        setStatus("sent");
        return;
      }
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setStatus("error");
      if (res.status === 503 || res.status >= 500) {
        setFallbackToEmail(true);
        setError("No pudimos recibirlo por aquí en este momento.");
      } else {
        setError(body?.error || "No se pudo enviar. Intenta de nuevo.");
      }
    } catch {
      setStatus("error");
      setFallbackToEmail(true);
      setError("No hay conexión con BuscoTrabajo en este momento.");
    }
  };

  const reset = () => {
    setStatus("idle");
    setMessage("");
    setProblemCategory("");
    setOpinionCategory("");
    setDisplayName("");
    setCity("");
    setConsentPublish(false);
    setAttachContext(false);
  };

  return (
    <div id="escribir" className="ink-card rounded-3xl bg-white p-5 md:p-7 scroll-mt-24">
      <div role="tablist" aria-label="Tipo de mensaje" className="grid grid-cols-2 gap-1 rounded-xl border-2 border-foreground bg-[#f4f5f2] p-1">
        {(
          [
            ["problem", "Algo falló"],
            ["opinion", "Dejar mi opinión"]
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={kind === value}
            onClick={() => switchKind(value)}
            className={`min-h-[44px] rounded-lg text-sm md:text-[15px] font-bold transition-colors ${
              kind === value ? "bg-foreground text-white" : "text-[#3d413e] hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {status === "sent" ? (
        <div role="status" className="py-8 flex flex-col items-start gap-3">
          <span aria-hidden="true" className="w-12 h-12 rounded-xl border-2 border-foreground bg-primary text-white grid place-items-center">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12l5 5 9-10" />
            </svg>
          </span>
          <p className="font-heading font-bold text-2xl">{kind === "problem" ? "Recibido, gracias por avisar" : "Gracias por tu opinión"}</p>
          <p className="text-[15px] leading-relaxed text-[#3d413e]">
            {kind === "problem"
              ? "Lo lee una persona del equipo. Si necesitas respuesta, escríbenos también a "
              : "La revisamos y, si cumple las normas, la publicamos en esta página con tu nombre y ciudad."}
            {kind === "problem" ? (
              <a href={`mailto:${CONTACT_EMAIL}`} className="font-semibold break-all">
                {CONTACT_EMAIL}
              </a>
            ) : null}
          </p>
          <button type="button" onClick={reset} className="mt-2 min-h-[44px] rounded-xl border-2 border-foreground bg-white px-5 font-bold">
            Enviar otro mensaje
          </button>
        </div>
      ) : (
        <form onSubmit={submit} noValidate className="mt-5 flex flex-col gap-4">
          <fieldset>
            <legend className="font-bold text-[15px] mb-2.5">{kind === "problem" ? "¿Qué falló?" : "¿Cómo te fue?"}</legend>
            <div className="flex flex-wrap gap-2">
              {categories.map((c) => {
                const selected = category === c.id;
                return (
                  <label
                    key={c.id}
                    className={`min-h-[44px] inline-flex items-center rounded-full border-2 border-foreground px-4 text-sm font-semibold cursor-pointer select-none has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary ${
                      selected ? "bg-green-soft shadow-[3px_3px_0_hsl(var(--foreground))]" : "bg-white"
                    }`}
                  >
                    <input
                      type="radio"
                      name={`categoria-${kind}`}
                      value={c.id}
                      checked={selected}
                      onChange={() => (kind === "problem" ? setProblemCategory(c.id) : setOpinionCategory(c.id))}
                      className="sr-only"
                    />
                    {c.label}
                  </label>
                );
              })}
            </div>
          </fieldset>

          <label className="flex flex-col gap-2 text-[15px] font-bold">
            {kind === "problem" ? "Cuéntanos más (opcional)" : "Tu opinión"}
            <textarea
              rows={3}
              value={message}
              maxLength={FEEDBACK_LIMITS.message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={kind === "problem" ? "Ej.: busqué un cargo y la página se quedó cargando." : "Qué te gustó, qué mejorarías, si conseguiste empleo…"}
              className={`${inputClass} font-normal resize-y`}
            />
          </label>

          {kind === "opinion" ? (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="flex flex-col gap-2 text-[15px] font-bold">
                  Nombre que se mostrará
                  <input
                    type="text"
                    value={displayName}
                    maxLength={FEEDBACK_LIMITS.name}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Ej.: Ana M."
                    autoComplete="off"
                    className={`${inputClass} font-normal`}
                  />
                </label>
                <label className="flex flex-col gap-2 text-[15px] font-bold">
                  Ciudad (opcional)
                  <input
                    type="text"
                    value={city}
                    maxLength={FEEDBACK_LIMITS.city}
                    onChange={(e) => setCity(e.target.value)}
                    placeholder="Ej.: Medellín"
                    autoComplete="off"
                    className={`${inputClass} font-normal`}
                  />
                </label>
              </div>
              <label className="flex items-start gap-3 text-sm leading-relaxed text-[#3d413e]">
                <input
                  type="checkbox"
                  checked={consentPublish}
                  onChange={(e) => setConsentPublish(e.target.checked)}
                  className="mt-0.5 w-5 h-5 shrink-0 accent-[hsl(var(--primary))]"
                />
                <span>Acepto que mi opinión se publique en esta página después de revisarla, con el nombre y la ciudad que escribí.</span>
              </label>
            </>
          ) : context.pagePath || context.search ? (
            <label className="flex items-start gap-3 text-sm leading-relaxed text-[#3d413e]">
              <input
                type="checkbox"
                checked={attachContext}
                onChange={(e) => setAttachContext(e.target.checked)}
                className="mt-0.5 w-5 h-5 shrink-0 accent-[hsl(var(--primary))]"
              />
              <span>
                Adjuntar datos técnicos para encontrar el error: página{context.pagePath ? ` ${context.pagePath}` : ""}
                {context.search ? `, búsqueda «${context.search}»` : ""} y navegador.
              </span>
            </label>
          ) : null}

          {/* Honeypot: hidden from people and assistive tech; bots fill it. */}
          <div aria-hidden="true" className="absolute -left-[9999px] w-px h-px overflow-hidden">
            <label>
              No llenar
              <input ref={honeypot} type="text" name="website" tabIndex={-1} autoComplete="off" />
            </label>
          </div>

          {error ? (
            <p role="alert" className="rounded-xl border-2 border-foreground bg-[#fde8dc] px-4 py-3 text-sm text-[#4a1c05]">
              {error}
              {fallbackToEmail ? (
                <>
                  {" "}
                  Escríbenos a{" "}
                  <a href={`mailto:${CONTACT_EMAIL}`} className="font-bold break-all">
                    {CONTACT_EMAIL}
                  </a>
                  .
                </>
              ) : null}
            </p>
          ) : null}

          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <button
              type="submit"
              disabled={status === "sending"}
              className="ink-card-sm ink-lift min-h-[52px] rounded-xl bg-primary px-6 font-bold text-white disabled:opacity-60"
            >
              {status === "sending" ? "Enviando…" : kind === "problem" ? "Enviar reporte" : "Enviar opinión"}
            </button>
            <span className="text-[13px] text-muted-foreground">
              {kind === "problem" ? "Privado: solo lo lee el equipo." : "Se publica después de revisarla."}
            </span>
          </div>
        </form>
      )}
    </div>
  );
}

function OpinionCard({ opinion }: { opinion: PublishedOpinion }) {
  const date = new Date(opinion.publishedAt).toLocaleDateString("es-CO", { day: "numeric", month: "long", year: "numeric" });
  return (
    <article className="rounded-2xl border-2 border-foreground bg-white p-5 flex flex-col gap-3">
      <span className="self-start rounded-full border-2 border-foreground px-3 py-0.5 text-xs font-bold" style={{ backgroundColor: TINTS[0]!.bg }}>
        {opinionCategoryLabel(opinion.category)}
      </span>
      <p className="text-[15px] md:text-base leading-relaxed">«{opinion.message}»</p>
      <p className="text-sm text-muted-foreground">
        <strong className="text-foreground">{opinion.displayName}</strong>
        {opinion.city ? ` · ${opinion.city}` : ""} · {date}
      </p>
      {opinion.teamReply ? (
        <div className="border-t-2 border-foreground pt-3 text-sm leading-relaxed text-[#3d413e]">
          <strong className="block text-primary mb-1">Respuesta del equipo</strong>
          {opinion.teamReply}
        </div>
      ) : null}
    </article>
  );
}

export default function Opiniones() {
  const meta = ROUTE_META["/opiniones"]!;
  const location = useLocation();
  const linkState = (location.state as FeedbackLinkState | null)?.feedback;
  const [opinions, setOpinions] = useState<PublishedOpinion[] | null>(null);
  const [kind, setKind] = useState<FeedbackKind>(linkState?.kind === "opinion" ? "opinion" : "problem");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/opinions")
      .then((res) => (res.ok ? res.json() : { opinions: [] }))
      .then((body: { opinions?: PublishedOpinion[] }) => {
        if (!cancelled) setOpinions(Array.isArray(body.opinions) ? body.opinions : []);
      })
      .catch(() => {
        if (!cancelled) setOpinions([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="bg-white">
      <PageHero eyebrow="Opiniones y ayuda" heading={meta.heading!} aside={<FeedbackForm linkState={linkState} kind={kind} setKind={setKind} />}>
        <p>{meta.introduction}</p>
      </PageHero>

      {/* Opinions first, full width, in their own scroll box so a long
          list never pushes the rest of the page down; "Lo que mejoramos"
          below as a short list. */}
      <ContentSection>
        <div className="flex flex-wrap items-end justify-between gap-3 mb-4 md:mb-6">
          <SectionHeading>Opiniones publicadas</SectionHeading>
          {opinions && opinions.length ? (
            <a href="#escribir" onClick={() => setKind("opinion")} className="mb-4 md:mb-8 text-sm font-bold">
              Escribir la mía →
            </a>
          ) : null}
        </div>
        {opinions === null ? (
          <div aria-hidden="true" className="h-40 rounded-2xl border-2 border-dashed border-foreground/30" />
        ) : opinions.length ? (
          <div
            role="region"
            aria-label={`Opiniones publicadas (${opinions.length})`}
            tabIndex={0}
            className="sr ink-card-sm rounded-2xl bg-[#fbfaf6] p-3 md:p-4 max-h-[560px] md:max-h-[620px] overflow-y-auto overscroll-contain focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 md:gap-4 items-start">
              {opinions.map((opinion) => (
                <OpinionCard key={opinion.id} opinion={opinion} />
              ))}
            </div>
          </div>
        ) : (
          <div className="sr ink-card-sm rounded-2xl p-5 md:p-7 max-w-[880px]" style={{ backgroundColor: TINTS[0]!.bg, color: TINTS[0]!.fg }}>
            <p className="font-heading font-bold text-xl md:text-2xl">Todavía no hay opiniones publicadas</p>
            <p className="mt-2 text-[15px] leading-relaxed">
              ¿BuscoTrabajo te sirvió o encontraste trabajo? Cuéntalo y sé la primera persona en aparecer aquí. Publicamos también las críticas.
            </p>
            <a href="#escribir" onClick={() => setKind("opinion")} className="mt-4 inline-flex min-h-[44px] items-center rounded-xl border-2 border-foreground bg-white px-5 font-bold text-foreground no-underline">
              Dejar mi opinión
            </a>
          </div>
        )}
      </ContentSection>

      <ContentSection className="pt-0 md:pt-0">
        <SectionHeading>Lo que mejoramos</SectionHeading>
        <ol className="sr-stagger grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
          {SITE_CHANGELOG.slice(0, 6).map((entry) => (
            <li key={`${entry.date}-${entry.text}`} className="sr rounded-2xl border-2 border-foreground bg-white px-5 py-4 flex flex-col gap-1.5">
              <time dateTime={entry.date} className="font-mono text-xs font-semibold tracking-wide text-primary">
                {formatChangelogDate(entry.date)}
              </time>
              <span className="text-[15px] leading-relaxed">{entry.text}</span>
            </li>
          ))}
        </ol>
      </ContentSection>

      <ContentCta />
    </div>
  );
}
