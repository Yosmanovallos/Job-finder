import React from "react";

export function MonoLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-xs font-mono tracking-widest uppercase" style={{ color: "#646B75" }}>
      {children}
    </span>
  );
}
