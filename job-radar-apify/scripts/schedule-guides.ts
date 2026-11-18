// Staggered /guias release (adsense-readiness F3, owner decision 2026-11-14):
// 4 guides on the go-live day, then 2 every 7 days. Sets `publicada` and
// `actualizada` in content/guias/*.md for approved guides only. The server
// shows each guide from its date on (America/Bogota), so later dates need no
// redeploy. Run it on release day, with the real deploy date.
//
//   npx tsx scripts/schedule-guides.ts --start 2026-11-20            # dry run
//   npx tsx scripts/schedule-guides.ts --start 2026-11-20 --write    # edits files
import fs from "node:fs";
import path from "node:path";
import { GUIDES_CONTENT_DIR } from "../src/server/guides-store.js";
import { colombiaToday, isOwnerApproved, parseGuide } from "../src/lib/guides.js";

// Most time-sensitive and most searched first (f3-temas-propuestos.md).
export const RELEASE_ORDER = [
  "trabajo-de-temporada",
  "trabajo-sin-experiencia",
  "trabajo-remoto-colombia",
  "agencia-publica-de-empleo-sena",
  "medio-tiempo-fines-de-semana-por-dias",
  "ofertas-de-empleo-falsas",
  "prestaciones-sociales",
  "tipos-de-contrato-de-trabajo",
  "periodo-de-prueba",
  "liquidacion-del-contrato",
  "como-hacer-una-hoja-de-vida",
  "entrevista-de-trabajo"
];
export const FIRST_DAY_COUNT = 4;
export const PER_WEEK = 2;

export function releaseDates(start: string, count: number): string[] {
  const dates: string[] = [];
  const base = new Date(`${start}T12:00:00Z`);
  for (let index = 0; index < count; index++) {
    const week = index < FIRST_DAY_COUNT ? 0 : 1 + Math.floor((index - FIRST_DAY_COUNT) / PER_WEEK);
    const day = new Date(base.getTime() + week * 7 * 86_400_000);
    dates.push(day.toISOString().slice(0, 10));
  }
  return dates;
}

function main(): void {
  const args = process.argv.slice(2);
  const start = args[args.indexOf("--start") + 1];
  const write = args.includes("--write");
  if (!args.includes("--start") || !start || !/^\d{4}-\d{2}-\d{2}$/.test(start)) {
    console.error("Uso: npx tsx scripts/schedule-guides.ts --start AAAA-MM-DD [--write]");
    process.exit(1);
  }
  if (start < colombiaToday()) {
    console.error(`--start ${start} es anterior a hoy en Colombia (${colombiaToday()}): no se publican fechas pasadas.`);
    process.exit(1);
  }
  const dates = releaseDates(start, RELEASE_ORDER.length);
  for (const [index, slug] of RELEASE_ORDER.entries()) {
    const file = path.join(GUIDES_CONTENT_DIR, `${slug}.md`);
    const source = fs.readFileSync(file, "utf-8");
    const guide = parseGuide(`${slug}.md`, source);
    if (!isOwnerApproved(guide.meta)) {
      console.log(`- ${slug}: sin aprobación del propietario, se omite`);
      continue;
    }
    const date = dates[index]!;
    console.log(`${date}  ${slug}`);
    if (write) {
      const next = source
        .replace(/^publicada:.*$/m, `publicada: ${date}`)
        .replace(/^actualizada:.*$/m, `actualizada: ${date}`);
      fs.writeFileSync(file, next);
    }
  }
  console.log(write ? "Fechas escritas." : "Simulación: no se cambió ningún archivo (usa --write).");
}

if (process.argv[1] && path.resolve(process.argv[1]).endsWith("schedule-guides.ts")) main();
