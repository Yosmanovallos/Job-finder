import React from "react";

// Frame of every account screen around /login (reset password, the
// OAuth/email callback, the "checking your session" wait): the login page's
// soft-green band and ink card, so the whole sign-in flow looks like one.

export const authInputClass =
  "h-12 w-full rounded-xl border-2 border-foreground bg-[#fbfaf6] px-4 text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-4 focus:ring-gold-1/60";
export const authPrimaryButtonClass =
  "ink-card-sm ink-lift flex h-12 w-full items-center justify-center rounded-xl bg-primary text-base font-bold text-white no-underline disabled:opacity-60";

export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <section className="min-h-[calc(100vh-4rem)] bg-gradient-to-b from-green-soft to-white px-4 py-10 md:py-16">
      <div className="mx-auto w-full max-w-[460px] ink-card rounded-[28px] bg-white p-6 md:p-9 md:shadow-[8px_8px_0_hsl(var(--foreground))]">
        <img src="/BT.png" alt="BuscoTrabajo.co" width={150} height={28} className="mb-6 h-7 w-auto" />
        {children}
      </div>
    </section>
  );
}

export function AuthTitle({ children }: { children: React.ReactNode }) {
  return <h1 className="mb-1.5 font-heading text-[28px] font-bold leading-tight tracking-[-0.03em] text-foreground">{children}</h1>;
}

export function AuthText({ children }: { children: React.ReactNode }) {
  return <p className="mb-6 text-[15px] leading-relaxed text-[#3d413e]">{children}</p>;
}

/** Same frame while a session resolves, so nothing jumps when it does. */
export function AuthSpinner() {
  return (
    <section className="min-h-[calc(100vh-4rem)] bg-gradient-to-b from-green-soft to-white flex items-center justify-center">
      <div role="status" aria-label="Cargando" className="w-7 h-7 rounded-full border-[3px] border-primary border-t-transparent animate-spin" />
    </section>
  );
}
