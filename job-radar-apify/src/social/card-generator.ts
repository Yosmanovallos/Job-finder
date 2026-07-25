import { SocialDigest } from "./digest-generator.js";
import { SITE_DOMAIN } from "../config.js";

/**
 * Renders a square 1080x1080 SVG visual Card image styled with `anima-project` design tokens:
 * - Background: #0A0B0D
 * - Card Container: #131519
 * - Border: #262A31
 * - Primary Accent: #34D399 (Emerald Green)
 * - Text Primary: #F4F5F7
 * - Text Muted: #9AA1AC
 */
export function generateCardSvg(digest: SocialDigest): string {
  const { category, jobCount, companies, sources } = digest;
  const companyListStr = companies.length > 0 ? companies.join(" · ") : "Empresas destacadas";
  const sourcesBadges = sources
    .slice(0, 4)
    .map((s) => `<tspan fill="#34D399" font-weight="bold">[${s}]</tspan>`)
    .join("  ");

  return `<svg width="1080" height="1080" viewBox="0 0 1080 1080" fill="none" xmlns="http://www.w3.org/2000/svg">
  <!-- Background with grid pattern -->
  <rect width="1080" height="1080" fill="#0A0B0D"/>

  <!-- Radial Glow -->
  <circle cx="540" cy="180" r="450" fill="#34D399" fill-opacity="0.08"/>

  <!-- Grid Overlay -->
  <path d="M0 120H1080M0 240H1080M0 360H1080M0 480H1080M0 600H1080M0 720H1080M0 840H1080M0 960H1080" stroke="#262A31" stroke-opacity="0.4" stroke-width="1"/>
  <path d="M120 0V1080M240 0V1080M360 0V1080M480 0V1080M600 0V1080M720 0V1080M840 0V1080M960 0V1080" stroke="#262A31" stroke-opacity="0.4" stroke-width="1"/>

  <!-- Main Card Container -->
  <rect x="90" y="140" width="900" height="800" rx="32" fill="#131519" stroke="#262A31" stroke-width="4"/>

  <!-- Header Branding -->
  <circle cx="150" cy="210" r="12" fill="#34D399"/>
  <text x="180" y="218" fill="#646B75" font-family="'JetBrains Mono', monospace" font-size="28" font-weight="600">job-radar / digest diario</text>

  <!-- Live Status Chip -->
  <rect x="680" y="185" width="250" height="48" rx="24" fill="rgba(52,211,153,0.10)" stroke="rgba(52,211,153,0.30)" stroke-width="2"/>
  <circle cx="710" cy="209" r="8" fill="#34D399"/>
  <text x="732" y="217" fill="#34D399" font-family="'JetBrains Mono', monospace" font-size="22" font-weight="bold">VERIFICADO</text>

  <!-- Big Category Title -->
  <text x="150" y="340" fill="#9AA1AC" font-family="'Space Grotesk', sans-serif" font-size="32" font-weight="600" letter-spacing="-0.02em">NUEVAS VACANTES EN</text>
  <text x="150" y="420" fill="#F4F5F7" font-family="'Space Grotesk', sans-serif" font-size="64" font-weight="700" letter-spacing="-0.03em">${category.toUpperCase()}</text>

  <!-- Big Job Count Display -->
  <rect x="150" y="470" width="780" height="180" rx="24" fill="#1B1E24" stroke="#262A31" stroke-width="2"/>
  <text x="200" y="580" fill="#34D399" font-family="'Space Grotesk', sans-serif" font-size="110" font-weight="800">${jobCount}</text>
  <text x="360" y="550" fill="#F4F5F7" font-family="'Space Grotesk', sans-serif" font-size="38" font-weight="700">Ofertas Publicadas Hoy</text>
  <text x="360" y="595" fill="#9AA1AC" font-family="'JetBrains Mono', monospace" font-size="24">Filtradas por vigencia (Últimas 24-48h)</text>

  <!-- Companies Row -->
  <text x="150" y="700" fill="#646B75" font-family="'JetBrains Mono', monospace" font-size="24">EMPRESAS CONTRATANDO:</text>
  <text x="150" y="745" fill="#F4F5F7" font-family="'Space Grotesk', sans-serif" font-size="32" font-weight="600">${companyListStr}</text>

  <!-- Footer Banner / CTA -->
  <rect x="90" y="820" width="900" height="120" fill="rgba(52,211,153,0.12)" stroke="rgba(52,211,153,0.30)" stroke-width="2"/>
  <text x="150" y="890" fill="#34D399" font-family="'Space Grotesk', sans-serif" font-size="34" font-weight="700">Aplica primero en 👉 ${SITE_DOMAIN}</text>
</svg>`;
}

export function generateCardBuffer(digest: SocialDigest): Buffer {
  const svgString = generateCardSvg(digest);
  return Buffer.from(svgString, "utf-8");
}
