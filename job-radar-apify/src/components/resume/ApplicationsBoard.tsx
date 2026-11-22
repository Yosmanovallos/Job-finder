import { useCallback, useEffect, useState, type CSSProperties, type DragEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  APPLICATION_NOTE_MAX,
  APPLICATION_STATUSES,
  APPLICATION_STATUS_LABELS,
  type Application,
  type ApplicationStatus,
  type ApplicationSummary
} from "../../lib/resume-applications.js";
import type { ResumeFacts } from "../../lib/resume-studio.js";

// AI Resume Studio R4b — «Mis postulaciones» (doc 11 §1 fila 3 y §5.1;
// prototype «5 · Postulaciones»). Free for everyone. Five columns; each card
// carries its adapted CV and its score. Moving a card works with the status
// <select> on every card (keyboard, screen reader, phone) and, on desktop,
// also by drag and drop. Nothing here applies or contacts anyone: «Postulé»
// is a status the user sets (AGENTS.md rule 7).
// Only class names that already exist in the global CSS (it must stay
// byte-identical); layout specifics are inline styles.

const button =
  "inline-flex items-center gap-1.5 rounded-full border-2 border-foreground px-3 py-1.5 text-sm font-semibold bg-white hover:bg-[#f1f2f0] disabled:opacity-50 disabled:cursor-not-allowed";
const primary =
  "inline-flex items-center gap-1.5 rounded-full border-2 border-foreground px-4 py-1.5 text-sm font-bold bg-primary text-primary-foreground disabled:opacity-50 disabled:cursor-not-allowed";
const input =
  "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30";

const boardStyle: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 12, alignItems: "start" };
const columnStyle: CSSProperties = { background: "#f1f2f0", border: "2px solid", borderRadius: 16, padding: 10, minHeight: 150 };
const pillStyle: CSSProperties = { fontSize: 11, fontWeight: 600, borderRadius: 999, padding: "1px 8px", border: "1.5px solid", background: "#fff", whiteSpace: "nowrap" };

const dateLabel = (value: string) => new Date(value).toLocaleDateString("es-CO", { day: "numeric", month: "short" });

export function ApplicationsBoard({
  accessToken,
  canSave,
  onChangeConsent,
  onUseCv,
  renderPreview
}: {
  accessToken: string;
  canSave: boolean;
  onChangeConsent: () => void;
  onUseCv: (facts: ResumeFacts) => void;
  renderPreview: (facts: ResumeFacts) => ReactNode;
}) {
  const [items, setItems] = useState<ApplicationSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opened, setOpened] = useState<Application | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");

  const api = useCallback(
    async (path: string, init: RequestInit = {}) => {
      const res = await fetch(`/api/resume/applications${path}`, {
        ...init,
        headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), Authorization: `Bearer ${accessToken}` }
      });
      const data = res.status === 204 ? null : await res.json().catch(() => null);
      return { res, data };
    },
    [accessToken]
  );

  useEffect(() => {
    document.title = "Mis postulaciones | BuscoTrabajo";
    void (async () => {
      try {
        const { res, data } = await api("");
        if (!res.ok) return setError(data?.error ?? "No pudimos cargar tus postulaciones.");
        setItems(data.applications);
      } catch {
        setError("No pudimos cargar tus postulaciones.");
      }
    })();
  }, [api]);

  const patch = async (id: string, change: { status?: ApplicationStatus; note?: string }) => {
    const before = items;
    // Optimistic: the card moves at once and comes back if the server says no.
    setItems((list) => list?.map((a) => (a.id === id ? { ...a, ...change } : a)) ?? list);
    setError(null);
    try {
      const { res, data } = await api(`/${id}`, { method: "PATCH", body: JSON.stringify(change) });
      if (!res.ok) {
        setItems(before);
        return setError(data?.error ?? "No se pudo guardar el cambio.");
      }
      setItems((list) => list?.map((a) => (a.id === id ? data.application : a)) ?? list);
      if (change.status) setAnnounce(`«${data.application.job.title}» movida a ${APPLICATION_STATUS_LABELS[change.status]}.`);
    } catch {
      setItems(before);
      setError("No se pudo guardar el cambio.");
    }
  };

  const remove = async (item: ApplicationSummary) => {
    if (!window.confirm(`¿Quitar «${item.job.title}» de tus postulaciones? Se borra también su hoja de vida adaptada.`)) return;
    const { res, data } = await api(`/${item.id}`, { method: "DELETE" });
    if (!res.ok) return setError(data?.error ?? "No se pudo borrar.");
    setItems((list) => list?.filter((a) => a.id !== item.id) ?? list);
    if (opened?.id === item.id) setOpened(null);
  };

  const openCv = async (id: string) => {
    const { res, data } = await api(`/${id}`);
    if (!res.ok) return setError(data?.error ?? "No pudimos abrir esa hoja de vida.");
    setOpened(data.application);
  };

  const drop = (status: ApplicationStatus) => (event: DragEvent) => {
    event.preventDefault();
    const id = dragId ?? event.dataTransfer.getData("text/plain");
    setDragId(null);
    const item = items?.find((a) => a.id === id);
    if (item && item.status !== status && canSave) void patch(id, { status });
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 md:py-8">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          <p className="font-mono text-xs font-semibold uppercase tracking-wide text-muted-foreground">Mis postulaciones</p>
          <h1 className="text-2xl md:text-3xl font-bold">Cada vacante con su hoja de vida adaptada</h1>
          <p className="text-sm text-muted-foreground">Gratis para todos. Marca en qué va cada proceso; nosotros no enviamos nada por ti.</p>
        </div>
        <Link to="/hoja-de-vida" className={button}>Mi hoja de vida</Link>
      </div>

      {!canSave ? (
        <p className="mb-4 rounded-xl border p-3 text-sm" style={{ background: "#fff6dc", borderColor: "#e8d9a6" }}>
          Para guardar y mover postulaciones activa «Guardar mi hoja de vida en mi cuenta».{" "}
          <button className="underline font-semibold" onClick={onChangeConsent}>Cambiar autorización</button>
        </p>
      ) : null}
      {error ? <p role="alert" className="mb-4 text-sm text-destructive">{error}</p> : null}
      <p className="sr-only" aria-live="polite">{announce}</p>

      {opened ? (
        <section className="ink-card-sm rounded-2xl bg-white p-4 md:p-5 space-y-3 mb-4" aria-label="Hoja de vida adaptada">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-bold">
              Hoja de vida adaptada a «{opened.job.title}»
              {opened.scoreAfter !== null ? <span className="font-mono"> · {opened.scoreBefore ?? "–"} → {opened.scoreAfter}</span> : null}
            </h2>
            <div className="flex flex-wrap gap-2">
              {opened.facts ? (
                <button className={primary} onClick={() => onUseCv(opened.facts as ResumeFacts)}>Usar en el editor</button>
              ) : null}
              <button className={button} onClick={() => setOpened(null)}>Cerrar</button>
            </div>
          </div>
          {opened.facts ? (
            <div className="ink-card-sm rounded-2xl overflow-hidden bg-white max-h-[70vh] overflow-y-auto">{renderPreview(opened.facts)}</div>
          ) : (
            <p className="text-sm text-muted-foreground">Esta postulación no tiene hoja de vida adaptada.</p>
          )}
          <p className="text-xs text-muted-foreground">Para descargarla sin la marca «Vista previa», ábrela en el editor.</p>
        </section>
      ) : null}

      {items === null && !error ? <p className="text-muted-foreground">Cargando…</p> : null}
      {items && items.length === 0 ? (
        <p className="mb-4 text-sm text-[#3d413e]">
          Aún no tienes postulaciones. Adapta tu hoja de vida a una vacante y pulsa «Guardar en Mis postulaciones».
        </p>
      ) : null}

      {items ? (
        <div style={boardStyle}>
          {APPLICATION_STATUSES.map((status) => {
            const list = items.filter((a) => a.status === status);
            return (
              <section
                key={status}
                aria-label={`${APPLICATION_STATUS_LABELS[status]} (${list.length})`}
                className="border-foreground"
                style={{ ...columnStyle, outline: dragId ? "2px dashed rgba(15, 107, 79, 0.35)" : undefined }}
                onDragOver={(event) => {
                  if (canSave) event.preventDefault();
                }}
                onDrop={drop(status)}
              >
                <h2 className="text-sm font-bold flex justify-between items-center gap-2">
                  {APPLICATION_STATUS_LABELS[status]}
                  <span className="font-mono border-foreground" style={pillStyle}>{list.length}</span>
                </h2>
                {list.map((item) => (
                  <ApplicationCard
                    key={item.id}
                    item={item}
                    canSave={canSave}
                    onDragStart={(event) => {
                      setDragId(item.id);
                      event.dataTransfer.setData("text/plain", item.id);
                      event.dataTransfer.effectAllowed = "move";
                    }}
                    onDragEnd={() => setDragId(null)}
                    onStatus={(next) => void patch(item.id, { status: next })}
                    onNote={(note) => void patch(item.id, { note })}
                    onOpenCv={() => void openCv(item.id)}
                    onDelete={() => void remove(item)}
                  />
                ))}
              </section>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function ApplicationCard({
  item,
  canSave,
  onDragStart,
  onDragEnd,
  onStatus,
  onNote,
  onOpenCv,
  onDelete
}: {
  item: ApplicationSummary;
  canSave: boolean;
  onDragStart: (event: DragEvent) => void;
  onDragEnd: () => void;
  onStatus: (status: ApplicationStatus) => void;
  onNote: (note: string) => void;
  onOpenCv: () => void;
  onDelete: () => void;
}) {
  const [note, setNote] = useState(item.note);
  const [editing, setEditing] = useState(false);
  const selectId = `rs-app-status-${item.id}`;
  return (
    <article
      className="border-foreground text-sm"
      style={{ background: "#fff", border: "2px solid", borderRadius: 12, padding: 10, marginTop: 8, cursor: canSave ? "grab" : undefined }}
      draggable={canSave}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <b className="block">{item.job.title}</b>
      {item.job.company ? <span className="text-muted-foreground">{item.job.company}</span> : null}
      <div className="flex justify-between items-center gap-2 text-xs text-muted-foreground" style={{ marginTop: 6 }}>
        {item.hasCv ? (
          <button className="underline font-semibold text-primary" onClick={onOpenCv}>CV adaptado</button>
        ) : (
          <span>sin adaptar</span>
        )}
        <span className="font-mono border-foreground" style={pillStyle} title="Compatibilidad estimada">
          {item.scoreAfter !== null ? `${item.scoreAfter} pts` : "– pts"}
        </span>
      </div>
      <p className="text-xs text-muted-foreground" style={{ marginTop: 4 }}>
        Guardada {dateLabel(item.createdAt)}
        {item.appliedAt ? ` · postulé ${dateLabel(item.appliedAt)}` : ""}
      </p>

      <label htmlFor={selectId} className="block text-xs font-semibold text-muted-foreground" style={{ marginTop: 8 }}>
        Estado
      </label>
      <select
        id={selectId}
        className={input}
        style={{ paddingTop: 4, paddingBottom: 4 }}
        value={item.status}
        disabled={!canSave}
        onChange={(event) => onStatus(event.target.value as ApplicationStatus)}
      >
        {APPLICATION_STATUSES.map((s) => (
          <option key={s} value={s}>{APPLICATION_STATUS_LABELS[s]}</option>
        ))}
      </select>

      {editing ? (
        <div className="space-y-1" style={{ marginTop: 8 }}>
          <label className="block text-xs font-semibold text-muted-foreground" htmlFor={`${selectId}-note`}>Nota</label>
          <textarea
            id={`${selectId}-note`}
            className={input}
            rows={3}
            maxLength={APPLICATION_NOTE_MAX}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <button
              className={button}
              onClick={() => {
                onNote(note);
                setEditing(false);
              }}
            >
              Guardar nota
            </button>
            <button className="underline text-xs" onClick={() => { setNote(item.note); setEditing(false); }}>Cancelar</button>
          </div>
        </div>
      ) : item.note ? (
        <p className="text-xs text-[#3d413e]" style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>{item.note}</p>
      ) : null}

      <div className="flex flex-wrap gap-3 text-xs" style={{ marginTop: 8 }}>
        {item.job.url ? (
          <a className="underline text-primary font-semibold" href={item.job.url} target="_blank" rel="noopener noreferrer nofollow">
            Ir a la vacante
          </a>
        ) : null}
        {!editing && canSave ? (
          <button className="underline" onClick={() => setEditing(true)}>{item.note ? "Editar nota" : "Añadir nota"}</button>
        ) : null}
        <button className="underline text-destructive" onClick={onDelete}>Quitar</button>
      </div>
    </article>
  );
}
