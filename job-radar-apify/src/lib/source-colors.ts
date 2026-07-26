// Per-platform accent colors for the source badge on job cards. Confirmed
// against each site's own declared theme-color/brand palette where
// reachable (LinkedIn, Glassdoor, GetOnBoard, Magneto); the rest use a
// distinguishing accent since their official brand hex isn't reliably
// documented — not a trademark claim, just enough contrast to tell sources
// apart at a glance.
export const SOURCE_COLORS: Record<string, { bg: string; text: string }> = {
  LinkedIn: { bg: "rgba(10,102,194,0.10)", text: "#0A66C2" },
  Indeed: { bg: "rgba(33,100,243,0.10)", text: "#2164F3" },
  Glassdoor: { bg: "rgba(12,170,65,0.10)", text: "#0CAA41" },
  GetOnBoard: { bg: "rgba(0,82,103,0.10)", text: "#005267" },
  Magneto: { bg: "rgba(206,64,44,0.10)", text: "#CE402C" },
  Computrabajo: { bg: "rgba(242,101,34,0.10)", text: "#F26522" },
  Elempleo: { bg: "rgba(14,165,160,0.10)", text: "#0EA5A0" },
  Workana: { bg: "rgba(0,152,116,0.10)", text: "#009874" },
  Torre: { bg: "rgba(75,85,99,0.10)", text: "#4B5563" },
  WeRemoto: { bg: "rgba(124,58,237,0.10)", text: "#7C3AED" },
  RemoteOK: { bg: "rgba(180,140,0,0.12)", text: "#B48C00" },
  Remotive: { bg: "rgba(79,70,229,0.10)", text: "#4F46E5" },
  Jooble: { bg: "rgba(29,78,216,0.10)", text: "#1D4ED8" }
};

export const DEFAULT_SOURCE_COLOR = { bg: "#f1f2f0", text: "#5b5f5c" };

export function getSourceColor(source: string): { bg: string; text: string } {
  return SOURCE_COLORS[source] || DEFAULT_SOURCE_COLOR;
}
