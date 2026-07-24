import { Job } from '../sources/types.js';

export interface SocialDigest {
  category: string;
  jobCount: number;
  twitterCopy: string;
  instagramCopy: string;
  utmUrl: string;
  companies: string[];
  sources: string[];
}

export function slugifyCategory(category: string): string {
  return category
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Groups jobs by role/category and generates viral social media copies.
 */
export function generateSocialDigest(category: string, jobs: Job[]): SocialDigest {
  const categorySlug = slugifyCategory(category);
  const utmUrl = `https://jobradar.app/${categorySlug}?utm_source=social&utm_medium=digest`;

  // Deduplicate companies
  const companySet = new Set<string>();
  const sourceSet = new Set<string>();

  for (const job of jobs) {
    if (job.company && job.company !== 'Confidencial') {
      companySet.add(job.company);
    }
    if (job.source) {
      sourceSet.add(job.source);
    }
  }

  const topCompanies = Array.from(companySet).slice(0, 3);
  const companyStr = topCompanies.length > 0 ? topCompanies.join(', ') : 'Confidenciales y más';
  const sourcesStr = Array.from(sourceSet).join(', ');

  // Twitter Copy (Max 280 characters)
  const hashtag = `#${categorySlug.replace(/-/g, '')}`;
  let twitterCopy = `🔥 ${jobs.length} nuevas vacantes de ${category} hoy\n` +
    `\n` +
    `Verificadas y reciéntes.\n` +
    `Empresas: ${companyStr}\n` +
    `\n` +
    `👉 Aplica aquí: ${utmUrl} ${hashtag} #empleo`;

  // Truncate if exceeds 280 chars
  if (twitterCopy.length > 280) {
    twitterCopy = `🔥 ${jobs.length} nuevas vacantes de ${category} hoy\n` +
      `Verificadas y recientes.\n` +
      `👉 Aplica aquí: ${utmUrl} ${hashtag}`;
  }

  // Instagram / Facebook Copy (Richer markdown format)
  const instagramCopy = `🚀 ¡NUEVO DIGEST DE EMPLEOS DE HOY!\n\n` +
    `📌 Categoría: ${category}\n` +
    `💼 ${jobs.length} vacantes encontradas y verificadas en las últimas horas.\n\n` +
    `🏢 Algunas empresas contratando: ${companyStr}\n` +
    `🌐 Fuentes consultadas: ${sourcesStr}\n\n` +
    `🔒 Sé de los primeros en postularte antes de que expiren.\n\n` +
    `👉 Enlace en nuestra BIO o visita: ${utmUrl}\n\n` +
    `${hashtag} #trabajo #empleoscolombia #trabajoremoto #jobradar`;

  return {
    category,
    jobCount: jobs.length,
    twitterCopy,
    instagramCopy,
    utmUrl,
    companies: topCompanies,
    sources: Array.from(sourceSet)
  };
}
