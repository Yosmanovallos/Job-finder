// Deterministic technology-tag extractor for job descriptions. Never an LLM
// call and never inference: every tag returned is an alias that appears
// literally, as a whole word/phrase, in the source text — same
// "nunca inventar datos" rule as job-filters.ts's role matcher, applied to
// a free-text description instead of a title. If a source never populates
// `description`, this simply has nothing to scan and returns [].
//
// Matching reuses job-filters.ts's word-boundary approach (a plain
// `.includes()` would let "SQL" match inside "SQLite", or "Go" match inside
// almost any Spanish paragraph) but adds boundary-side detection so aliases
// that start/end in a non-word character (".NET", "C#", "CI/CD") don't get
// a `\b` on the side where one can never match.

interface TechEntry {
  name: string;
  aliases: string[];
}

// Grouped by category purely for maintainability — extractTechnologies()
// flattens this and returns results in TECH_CATALOG order (roughly
// language/runtime -> framework -> data -> cloud/devops -> testing/QA ->
// PM/methodology -> design), not input order, so the tag row reads
// consistently across postings.
const TECH_CATALOG: TechEntry[] = [
  // Languages / runtimes
  { name: "TypeScript", aliases: ["TypeScript"] },
  { name: "JavaScript", aliases: ["JavaScript", "JS"] },
  { name: "Node.js", aliases: ["Node.js", "NodeJS", "Node"] },
  { name: "Python", aliases: ["Python"] },
  { name: "Java", aliases: ["Java"] },
  { name: "C#", aliases: ["C#", "C Sharp"] },
  { name: ".NET", aliases: [".NET", "ASP.NET", "dotnet"] },
  { name: "PHP", aliases: ["PHP"] },
  { name: "Ruby", aliases: ["Ruby"] },
  { name: "Kotlin", aliases: ["Kotlin"] },
  { name: "Swift", aliases: ["Swift"] },
  { name: "Rust", aliases: ["Rust"] },
  { name: "C++", aliases: ["C++"] },
  // "Golang" (not bare "Go") — the bare word is too ambiguous as a prose
  // substring/exact-tag match ("go" appears as an ordinary word constantly);
  // "golang" doesn't have that problem in either context.
  { name: "Go", aliases: ["Golang"] },
  { name: "HTML", aliases: ["HTML"] },
  { name: "CSS", aliases: ["CSS"] },

  // Frontend / mobile
  { name: "React", aliases: ["React", "React.js", "ReactJS"] },
  { name: "React Native", aliases: ["React Native"] },
  { name: "Angular", aliases: ["Angular"] },
  { name: "Vue", aliases: ["Vue.js", "VueJS", "Vue"] },
  { name: "Next.js", aliases: ["Next.js", "NextJS"] },
  { name: "Flutter", aliases: ["Flutter"] },

  // Backend frameworks
  { name: "Express", aliases: ["Express.js", "ExpressJS", "Express"] },
  { name: "Django", aliases: ["Django"] },
  { name: "Flask", aliases: ["Flask"] },
  { name: "Spring", aliases: ["Spring Boot", "Spring"] },
  { name: "Laravel", aliases: ["Laravel"] },
  { name: "Rails", aliases: ["Ruby on Rails", "Rails"] },

  // APIs / integration
  { name: "API REST", aliases: ["API REST", "REST API", "RESTful"] },
  { name: "GraphQL", aliases: ["GraphQL"] },
  { name: "Microservicios", aliases: ["Microservicios", "Microservices"] },

  // Data / databases
  { name: "SQL", aliases: ["SQL"] },
  { name: "PostgreSQL", aliases: ["PostgreSQL", "Postgres"] },
  { name: "MySQL", aliases: ["MySQL"] },
  { name: "MongoDB", aliases: ["MongoDB"] },
  { name: "Redis", aliases: ["Redis"] },
  { name: "Oracle", aliases: ["Oracle"] },
  { name: "Power BI", aliases: ["Power BI", "PowerBI"] },
  { name: "Tableau", aliases: ["Tableau"] },
  { name: "Excel", aliases: ["Excel"] },
  { name: "Pandas", aliases: ["Pandas"] },
  { name: "Spark", aliases: ["Apache Spark", "Spark"] },

  // Cloud / DevOps
  { name: "AWS", aliases: ["AWS", "Amazon Web Services"] },
  { name: "Azure", aliases: ["Azure"] },
  { name: "Google Cloud", aliases: ["Google Cloud", "GCP"] },
  { name: "Docker", aliases: ["Docker"] },
  { name: "Kubernetes", aliases: ["Kubernetes", "K8s"] },
  { name: "Terraform", aliases: ["Terraform"] },
  { name: "Ansible", aliases: ["Ansible"] },
  { name: "Jenkins", aliases: ["Jenkins"] },
  { name: "GitHub Actions", aliases: ["GitHub Actions"] },
  { name: "GitLab CI", aliases: ["GitLab CI", "GitLab CI/CD"] },
  { name: "CI/CD", aliases: ["CI/CD"] },
  { name: "Git", aliases: ["Git"] },
  { name: "Linux", aliases: ["Linux"] },
  { name: "Bash", aliases: ["Bash"] },

  // Testing / QA
  { name: "Playwright", aliases: ["Playwright"] },
  { name: "Cypress", aliases: ["Cypress"] },
  { name: "Selenium", aliases: ["Selenium"] },
  { name: "Jest", aliases: ["Jest"] },
  { name: "Postman", aliases: ["Postman"] },
  { name: "JMeter", aliases: ["JMeter"] },
  { name: "K6", aliases: ["K6", "k6"] },

  // PM / methodology
  { name: "Scrum", aliases: ["Scrum"] },
  { name: "Kanban", aliases: ["Kanban"] },
  { name: "Agile", aliases: ["Agile", "Ágil"] },
  { name: "Jira", aliases: ["Jira"] },
  { name: "Confluence", aliases: ["Confluence"] },
  { name: "Trello", aliases: ["Trello"] },

  // Design
  { name: "Figma", aliases: ["Figma"] },
  { name: "Adobe XD", aliases: ["Adobe XD"] }
];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const patternCache = new Map<string, RegExp>();

function patternFor(alias: string): RegExp {
  let re = patternCache.get(alias);
  if (re) return re;
  const escaped = escapeRegExp(alias);
  // \b only matches between a word char and a non-word char, so an alias
  // that starts or ends in a non-word char (".NET", "C#", "CI/CD") can never
  // satisfy a \b on that side — omit it there instead of silently matching
  // nothing.
  const startsWord = /\w/.test(alias[0]);
  const endsWord = /\w/.test(alias[alias.length - 1]);
  re = new RegExp(`${startsWord ? "\\b" : ""}${escaped}${endsWord ? "\\b" : ""}`, "i");
  patternCache.set(alias, re);
  return re;
}

// Returns canonical tech names actually present in `text`, in catalog order,
// deduplicated. Empty/undefined input returns []  — callers decide whether
// to hide the "Tecnologías" section entirely in that case.
export function extractTechnologies(text: string | undefined | null): string[] {
  if (!text) return [];
  // Collapse whitespace runs (including line breaks inside a bullet list)
  // to a single space so a multi-word alias like "GitHub Actions" still
  // matches when the source text wraps between the two words.
  const normalized = text.replace(/\s+/g, " ");
  const found: string[] = [];
  for (const entry of TECH_CATALOG) {
    if (entry.aliases.some((alias) => patternFor(alias).test(normalized))) {
      found.push(entry.name);
    }
  }
  return found;
}

const EXACT_ALIAS_TO_NAME = new Map<string, string>();
for (const entry of TECH_CATALOG) {
  for (const alias of entry.aliases) {
    EXACT_ALIAS_TO_NAME.set(alias.toLowerCase(), entry.name);
  }
}

// For sources that hand back a flat tag array instead of prose (RemoteOK's
// `tags` — confirmed live 2026-08-12: it mixes real skills with unrelated
// site-wide category tags like "customer support"/"marketing"/"exec"/
// "digital nomad" on the SAME listing, even for a role with nothing to do
// with any of them). Exact (not substring) case-insensitive membership
// against the same catalog `extractTechnologies()` uses — a tag survives
// only if it IS a known technology name/alias verbatim, never a guess.
export function filterKnownTechnologyTags(tags: string[] | undefined | null): string[] {
  if (!tags || tags.length === 0) return [];
  const found: string[] = [];
  const seen = new Set<string>();
  for (const tag of tags) {
    const name = EXACT_ALIAS_TO_NAME.get(tag.trim().toLowerCase());
    if (name && !seen.has(name)) {
      seen.add(name);
      found.push(name);
    }
  }
  return found;
}
