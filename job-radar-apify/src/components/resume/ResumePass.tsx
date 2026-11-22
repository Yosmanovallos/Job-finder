import { useCallback, useEffect, useState, type CSSProperties } from "react";
import type { ResumeFacts, ResumeTemplateId } from "../../lib/resume-studio.js";
import { PASS_IDS, RESUME_PASSES, formatCop, type PassDefinition, type PassId } from "../../resume-studio/payments/passes.js";

// AI Resume Studio R4 — the «Pase» screen (prototype
// docs/resume-studio/mockups/resume-tailor-link-prototype.html, view «pay»;
// doc 06 §9.3, doc 11 §6). One-time passes, no renewal, prices with IVA,
// retracto text, and nothing that fakes urgency (no timers, no counters, no
// «N personas viendo»). Only benefits the server really enforces are listed.
// The pass is unlocked only by the verified webhook or by Wompi's API answer
// (/checkout/confirm); coming back from the checkout never unlocks anything.
// Only class names that already exist in the global CSS; the rest is inline.

const WOMPI_CHECKOUT_URL = "https://checkout.wompi.co/p/";
const RETURN_PATH = "/hoja-de-vida?pase=retorno";

const button =
  "inline-flex items-center justify-center gap-2 rounded-xl border-2 border-foreground bg-white px-3 py-1.5 text-sm font-semibold ink-lift";
const primary =
  "inline-flex items-center justify-center gap-2 rounded-xl border-2 border-foreground bg-primary text-white px-3 py-1.5 text-sm font-semibold ink-lift";

interface PassStatus {
  active: { passId: PassId; expiresAt: string; used: number; limit: number; periodEndsAt: string } | null;
  queued: number;
  free: { used: number; limit: number; resetsAt: string };
}

interface PassInfo {
  paymentsEnabled: boolean;
  status: PassStatus;
}

const date = (iso: string) => new Date(iso).toLocaleDateString("es-CO", { day: "numeric", month: "long", year: "numeric" });

function benefits(pass: PassDefinition): string[] {
  const quota =
    pass.durationDays === pass.periodDays
      ? `${pass.adaptationsPerPeriod} adaptaciones con IA`
      : `${pass.adaptationsPerPeriod} adaptaciones con IA cada 30 días`;
  return [quota, "Descarga en PDF y Word (.docx) sin marca de agua", `Vigencia de ${pass.durationDays} días desde el pago`];
}

function priceLine(pass: PassDefinition): { main: string; sub: string } {
  if (pass.durationDays === 90) {
    return { main: `${formatCop(pass.priceCop)}`, sub: `En un solo pago (equivale a ${formatCop(Math.round(pass.priceCop / 3))}/mes)` };
  }
  return { main: formatCop(pass.priceCop), sub: "Pago único" };
}

const planStyle = (selected: boolean): CSSProperties => ({
  border: "2px solid #0e1011",
  borderRadius: 20,
  padding: 16,
  background: selected ? "#fdf1d3" : "#fff",
  boxShadow: selected ? "4px 4px 0 #0e1011" : "none",
  display: "flex",
  flexDirection: "column",
  gap: 6,
  textAlign: "left"
});

export function ResumePass({
  accessToken,
  facts,
  templateId,
  printAreaId,
  onActiveChange
}: {
  accessToken: string;
  facts: ResumeFacts;
  templateId: ResumeTemplateId;
  printAreaId: string;
  onActiveChange: (active: boolean) => void;
}) {
  const [info, setInfo] = useState<PassInfo | null>(null);
  const [selected, setSelected] = useState<PassId>("pass_3m");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const api = useCallback(
    (path: string, init: RequestInit = {}) =>
      fetch(`/api/resume${path}`, {
        ...init,
        headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), Authorization: `Bearer ${accessToken}` }
      }),
    [accessToken]
  );

  const load = useCallback(async () => {
    try {
      const res = await api("/pass");
      if (!res.ok) return;
      const data = (await res.json()) as PassInfo;
      setInfo(data);
      onActiveChange(Boolean(data.status.active));
    } catch {
      /* the screen just stays without status */
    }
  }, [api, onActiveChange]);

  // Coming back from Wompi: ask Wompi (through our server) what happened.
  // The id in the URL only says which transaction to look up.
  useEffect(() => {
    // The session may arrive a render after the redirect: wait for it, and
    // keep the id in the URL until the confirm has actually been answered.
    if (!accessToken) return;
    const params = new URLSearchParams(window.location.search);
    const id = params.get("id");
    if (params.get("pase") !== "retorno") {
      void load();
      return;
    }
    if (!id) {
      window.history.replaceState(null, "", "/hoja-de-vida");
      void load();
      return;
    }
    void (async () => {
      setMessage({ kind: "ok", text: "Estamos confirmando tu pago con Wompi…" });
      try {
        const res = await api("/checkout/confirm", { method: "POST", body: JSON.stringify({ transactionId: id }) });
        const data = await res.json().catch(() => null);
        if (res.ok && data?.status === "approved") setMessage({ kind: "ok", text: "Pago aprobado. Tu pase ya está activo." });
        else if (res.ok && data?.status === "declined") setMessage({ kind: "error", text: "Wompi rechazó el pago. No se hizo ningún cobro por este intento." });
        else if (res.ok) setMessage({ kind: "ok", text: "Tu pago sigue en proceso. Te avisamos aquí cuando Wompi lo confirme; puedes recargar en unos minutos." });
        else setMessage({ kind: "error", text: data?.error ?? "No pudimos confirmar el pago todavía." });
      } catch {
        setMessage({ kind: "error", text: "No pudimos confirmar el pago todavía. Recarga en unos minutos." });
      }
      window.history.replaceState(null, "", "/hoja-de-vida");
      await load();
    })();
  }, [accessToken, api, load]);

  const pay = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await api("/checkout", { method: "POST", body: JSON.stringify({ passId: selected }) });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "No se pudo iniciar el pago.");
      const form = document.createElement("form");
      form.method = "GET";
      form.action = WOMPI_CHECKOUT_URL;
      const fields: Record<string, string> = {
        "public-key": data.publicKey,
        currency: data.currency,
        "amount-in-cents": String(data.amountInCents),
        reference: data.reference,
        "signature:integrity": data.signatureIntegrity,
        "redirect-url": `${window.location.origin}${RETURN_PATH}`
      };
      for (const [name, value] of Object.entries(fields)) {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = name;
        input.value = value;
        form.appendChild(input);
      }
      document.body.appendChild(form);
      form.submit();
    } catch (error) {
      setMessage({ kind: "error", text: (error as Error).message });
      setBusy(false);
    }
  };

  const printPdf = () => {
    const area = document.getElementById(printAreaId);
    if (!area) return;
    window.print();
  };

  const downloadDocx = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await api("/download/docx", { method: "POST", body: JSON.stringify({ facts, templateId }) });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "No se pudo descargar.");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "hoja-de-vida-buscotrabajo.docx";
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setMessage({ kind: "error", text: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const active = info?.status.active ?? null;

  return (
    <section className="ink-card-sm rounded-2xl bg-white p-4 md:p-5 space-y-3" aria-labelledby="rs-pass-title">
      <h2 id="rs-pass-title" className="text-base font-bold">
        {active ? "Descarga tu hoja de vida" : "Descárgala y postúlate"}
      </h2>

      {message ? (
        <p role="status" className="text-sm" style={{ color: message.kind === "error" ? "#b42318" : "#0b5a3e" }}>
          {message.text}
        </p>
      ) : null}

      {active ? (
        <>
          <p className="text-sm">
            <strong>{RESUME_PASSES[active.passId]?.name ?? "Pase"}</strong> vigente hasta el {date(active.expiresAt)}. Adaptaciones con IA en
            este periodo: <span className="font-mono">{active.used} de {active.limit}</span> (se renuevan el {date(active.periodEndsAt)}).
            {info && info.status.queued > 0 ? ` Tienes ${info.status.queued} pase(s) más que empiezan cuando este termine.` : ""}
          </p>
          <div className="flex flex-wrap gap-2">
            <button className={primary} disabled={busy} onClick={printPdf}>
              Descargar PDF
            </button>
            <button className={button} disabled={busy} onClick={() => void downloadDocx()}>
              Descargar Word (.docx)
            </button>
          </div>
          <p className="text-xs text-muted-foreground">El PDF se guarda desde la ventana de impresión de tu navegador («Guardar como PDF»).</p>
        </>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            La vista previa es gratis y lleva la marca «Vista previa — BuscoTrabajo». Con un pase descargas PDF y Word sin marca.
            {info ? ` Adaptaciones gratis este mes: ${info.status.free.used} de ${info.status.free.limit}.` : ""}
          </p>
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))" }} role="radiogroup" aria-label="Pase">
            {PASS_IDS.map((id) => {
              const pass = RESUME_PASSES[id];
              const price = priceLine(pass);
              return (
                <button key={id} role="radio" aria-checked={selected === id} style={planStyle(selected === id)} onClick={() => setSelected(id)}>
                  {pass.recommended ? (
                    <span className="font-mono" style={{ alignSelf: "flex-start", fontSize: 10.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".05em", background: "#0f6b4f", color: "#fff", borderRadius: 999, padding: "2px 9px" }}>
                      Recomendado
                    </span>
                  ) : null}
                  <b>{pass.name}</b>
                  <span className="font-heading" style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-.03em" }}>
                    {price.main}
                  </span>
                  <span className="text-xs text-muted-foreground">{price.sub}</span>
                  <ul style={{ margin: "4px 0 0", paddingLeft: 18, fontSize: 13.5 }}>
                    {benefits(pass).map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                  </ul>
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-2">
            {info?.paymentsEnabled ? (
              <button className={primary} disabled={busy} onClick={() => void pay()}>
                {busy ? "Abriendo Wompi…" : `Pagar ${formatCop(RESUME_PASSES[selected].priceCop)} con Wompi →`}
              </button>
            ) : (
              <span className="text-sm text-muted-foreground">Los pagos aún no están disponibles. Puedes seguir usando la vista previa.</span>
            )}
            <button className={button} disabled={busy} onClick={printPdf}>
              Imprimir vista previa (con marca)
            </button>
          </div>
        </>
      )}

      <p className="text-xs text-muted-foreground">
        Precios en pesos colombianos con IVA incluido. Pago único con Wompi, sin renovación automática: no guardamos tu tarjeta ni volvemos a
        cobrarte. Tienes derecho de retracto según la Ley 1480 de 2011 (estatuto del consumidor); escríbenos desde «Opiniones y ayuda» para
        ejercerlo. Tus datos y la vista previa siguen siendo tuyos aunque no pagues: puedes exportarlos o borrarlos.
      </p>
    </section>
  );
}
