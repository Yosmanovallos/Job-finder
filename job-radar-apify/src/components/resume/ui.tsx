import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";

// AI Resume Studio R4c — shared pieces of the /hoja-de-vida screens: an
// accessible dialog (native <dialog> + showModal: Esc, inert background,
// focus kept inside and given back to the trigger), a promise-based
// confirm that replaces window.confirm, and the scoped CSS of these
// screens. RS_CSS is rendered as a <style> inside the lazy chunk, with
// «rs-» class names only, so the global CSS file stays byte-identical
// (dashboard performance runbook).

export const RS_CSS = `
.rs-root{--rs-ink:#0e1011;--rs-body:#3d413e;--rs-muted:#5a605b;--rs-line:#e5e8e1;--rs-green:#0f6b4f;--rs-green-soft:#e2f4ec;--rs-gold:#f3dfa2;--rs-add:#d9f5e6;--rs-add-fg:#0b5a3e;--rs-bad:#b42318}
.rs-root :focus-visible{outline:none;box-shadow:0 0 0 4px rgba(243,223,162,.95)!important;border-radius:12px}
.rs-dialog{border:2px solid var(--rs-ink,#0e1011);border-radius:22px;padding:0;width:min(560px,calc(100vw - 32px));max-height:calc(100dvh - 48px);background:#fff;color:#0e1011;box-shadow:6px 6px 0 #0e1011}
.rs-dialog.rs-wide{width:min(860px,calc(100vw - 32px))}
.rs-dialog::backdrop{background:rgba(14,16,17,.45)}
.rs-dialog[open]{display:flex;flex-direction:column;animation:rs-pop .16s cubic-bezier(0,0,.2,1)}
.rs-dialog-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:18px 20px 10px}
.rs-dialog-body{padding:4px 20px 16px;overflow-y:auto}
.rs-dialog-foot{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;padding:12px 20px 18px;border-top:1px solid #e5e8e1}
.rs-x{width:36px;height:36px;border-radius:999px;display:grid;place-items:center;border:2px solid transparent;flex:none}
.rs-x:hover{background:#f4f5f2}
@media (max-width:640px){
  .rs-dialog,.rs-dialog.rs-wide{width:100vw;max-width:100vw;margin:auto 0 0;border-radius:22px 22px 0 0;border-width:2px 0 0;box-shadow:none;max-height:92dvh}
  .rs-dialog[open]{animation:rs-up .2s cubic-bezier(0,0,.2,1)}
  .rs-dialog-foot{flex-direction:column-reverse}
  .rs-dialog-foot>*{width:100%;justify-content:center}
}
@keyframes rs-pop{from{opacity:0;transform:scale(.97)}to{opacity:1;transform:none}}
@keyframes rs-up{from{transform:translateY(24px);opacity:.4}to{transform:none;opacity:1}}
@keyframes rs-spin{to{transform:rotate(360deg)}}
@keyframes rs-pulse{0%,100%{opacity:.45}50%{opacity:1}}
.rs-spin{width:18px;height:18px;border-radius:999px;border:2.5px solid #cfd6cc;border-top-color:#0f6b4f;animation:rs-spin .8s linear infinite;flex:none}
.rs-steps{list-style:none;margin:0;padding:0;display:grid;gap:10px}
.rs-steps li{display:flex;align-items:center;gap:10px;font-size:15px;color:#5a605b}
.rs-steps li[data-state=active]{color:#0e1011;font-weight:600}
.rs-steps li[data-state=done]{color:#074a3a}
.rs-dot{width:18px;height:18px;border-radius:999px;border:2px solid #cfd6cc;flex:none;display:grid;place-items:center;font-size:11px;font-weight:800}
.rs-steps li[data-state=done] .rs-dot{background:#0f6b4f;border-color:#0f6b4f;color:#fff}
.rs-skel{background:#eef0ec;border-radius:8px;animation:rs-pulse 1.4s cubic-bezier(.4,0,.6,1) infinite}
.rs-tabs{display:inline-flex;background:#fff;border:2px solid #0e1011;border-radius:999px;padding:3px;gap:2px}
.rs-tabs button{padding:6px 14px;border-radius:999px;font-size:13.5px;font-weight:700;color:#3d413e}
.rs-tabs button[aria-selected=true]{background:#0e1011;color:#fff}
.rs-option{display:flex;gap:12px;align-items:flex-start;border:2px solid #e5e8e1;border-radius:16px;padding:12px 14px;background:#fff;cursor:pointer;text-align:left;width:100%}
.rs-option:hover{border-color:#b9c2b6}
.rs-option[data-on=true]{border-color:#0e1011;box-shadow:3px 3px 0 #0e1011}
.rs-input{width:100%;border:2px solid #0e1011;border-radius:14px;background:#fff;padding:11px 14px;font-size:16px;line-height:1.4}
.rs-input::placeholder{color:#8a918b}
.rs-input[aria-invalid=true]{border-color:#b42318}
.rs-menu{position:absolute;right:0;top:calc(100% + 8px);z-index:40;min-width:250px;background:#fff;border:2px solid #0e1011;border-radius:16px;box-shadow:4px 4px 0 #0e1011;padding:6px;display:grid}
.rs-menu button,.rs-menu a{display:flex;align-items:center;gap:10px;text-align:left;padding:10px 12px;border-radius:10px;font-size:14.5px;font-weight:600;color:#0e1011}
.rs-menu button:hover,.rs-menu a:hover,.rs-menu button:focus-visible,.rs-menu a:focus-visible{background:#f4f5f2}
.rs-menu hr{border:0;border-top:1px solid #e5e8e1;margin:4px 6px}
.rs-menu .rs-danger{color:#b42318}
.rs-num{font-variant-numeric:tabular-nums}
.rs-drop{border:2px dashed #b9c2b6;border-radius:16px;padding:18px;text-align:center;background:#fafafa}
.rs-drop[data-drag=true]{border-color:#0f6b4f;background:#e2f4ec}
@media (prefers-reduced-motion:reduce){.rs-root *,.rs-dialog,.rs-dialog *{animation:none!important;transition:none!important}}
@media print{dialog{display:none!important}}
`;

export function RsStyle() {
  return <style>{RS_CSS}</style>;
}

export const btn =
  "inline-flex items-center justify-center gap-2 rounded-xl border-2 border-foreground bg-white px-4 py-2 text-sm font-semibold ink-lift disabled:opacity-50 disabled:cursor-not-allowed";
export const btnPrimary =
  "inline-flex items-center justify-center gap-2 rounded-xl border-2 border-foreground bg-primary text-white px-4 py-2 text-sm font-bold ink-lift disabled:opacity-50 disabled:cursor-not-allowed";
export const btnGhost =
  "inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-white px-3 py-2 text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed";

/** Accessible modal. `open` drives showModal()/close(); Esc and the ✕ call onClose. */
export function Dialog({
  open,
  title,
  description,
  onClose,
  children,
  footer,
  wide = false,
  labelClose = "Cerrar"
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children?: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  labelClose?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      opener.current = document.activeElement;
      try {
        el.showModal();
      } catch {
        el.setAttribute("open", "");
      }
    } else if (!open && el.open) {
      el.close();
      const back = opener.current as HTMLElement | null;
      if (back && typeof back.focus === "function" && document.contains(back)) back.focus();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={`rs-dialog${wide ? " rs-wide" : ""}`}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        // A click on the backdrop (the dialog box itself, outside its content) closes.
        if (event.target === ref.current) onClose();
      }}
    >
      {open ? (
        <>
          <div className="rs-dialog-head">
            <div>
              <h2 id={titleId} className="text-lg font-bold" style={{ lineHeight: 1.25 }}>
                {title}
              </h2>
              {description ? (
                <p id={descId} className="text-sm mt-1" style={{ color: "#3d413e" }}>
                  {description}
                </p>
              ) : null}
            </div>
            <button type="button" className="rs-x" onClick={onClose} aria-label={labelClose}>
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          {children ? <div className="rs-dialog-body">{children}</div> : null}
          {footer ? <div className="rs-dialog-foot">{footer}</div> : null}
        </>
      ) : null}
    </dialog>
  );
}

export interface ConfirmOptions {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
}

/** Replaces window.confirm: `if (!(await confirm({...}))) return;`. Render `element` once. */
export function useConfirm(): [ReactNode, (options: ConfirmOptions) => Promise<boolean>] {
  const [state, setState] = useState<(ConfirmOptions & { resolve: (ok: boolean) => void }) | null>(null);
  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setState({ ...options, resolve });
      }),
    []
  );
  const finish = (ok: boolean) => {
    state?.resolve(ok);
    setState(null);
  };
  const element = (
    <Dialog
      open={state !== null}
      title={state?.title ?? ""}
      onClose={() => finish(false)}
      footer={
        <>
          <button type="button" className={btn} onClick={() => finish(false)}>
            {state?.cancelLabel ?? "Cancelar"}
          </button>
          <button
            type="button"
            className={btnPrimary}
            style={state?.danger ? { background: "#b42318" } : undefined}
            onClick={() => finish(true)}
            autoFocus
          >
            {state?.confirmLabel ?? "Continuar"}
          </button>
        </>
      }
    >
      <p className="text-sm" style={{ color: "#3d413e" }}>
        {state?.body}
      </p>
    </Dialog>
  );
  return [element, confirm];
}

/** One shared promise per key: React double effects and remounts never send a request twice. */
const inflight = new Map<string, Promise<unknown>>();
export function once<T>(key: string, run: () => Promise<T>): Promise<T> {
  const hit = inflight.get(key);
  if (hit) return hit as Promise<T>;
  const p = run();
  inflight.set(key, p);
  p.then(
    () => setTimeout(() => inflight.delete(key), 60_000),
    () => inflight.delete(key)
  );
  return p;
}

export function newKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // Old browsers: RFC 4122 v4 from getRandomValues.
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Steps that advance on a timer while one request is pending (perceived progress, never fake success). */
export function useStagedSteps(count: number, active: boolean, msPerStep = 2600): number {
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (!active) return;
    setStep(0);
    const timers = Array.from({ length: count - 1 }, (_, i) => setTimeout(() => setStep(i + 1), msPerStep * (i + 1)));
    return () => timers.forEach(clearTimeout);
  }, [active, count, msPerStep]);
  return step;
}

export function Steps({ labels, current, done }: { labels: string[]; current: number; done: boolean }) {
  return (
    <ol className="rs-steps" aria-live="polite">
      {labels.map((label, i) => {
        const state = done || i < current ? "done" : i === current ? "active" : "todo";
        return (
          <li key={label} data-state={state}>
            {state === "active" ? <span className="rs-spin" aria-hidden="true" /> : <span className="rs-dot" aria-hidden="true">{state === "done" ? "✓" : ""}</span>}
            <span>
              {label}
              {state === "active" ? <span className="sr-only"> (en curso)</span> : state === "done" ? <span className="sr-only"> (listo)</span> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
