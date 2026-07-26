import React from "react";

export function MonoLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-xs font-mono tracking-widest uppercase" style={{ color: "#9a9d98" }}>
      {children}
    </span>
  );
}
