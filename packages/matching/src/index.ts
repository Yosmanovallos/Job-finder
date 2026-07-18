export {
  SKILL_SYNONYMS,
  normalizeSkill,
  skillInText,
  seniorityFromTitle,
  seniorityDistance,
  normalizeTitle,
  titleMatches,
  SENIORITY_ORDER
} from "./taxonomy.js";
export { computeFeatures, type MatchFeatures } from "./features.js";
export { scoreJob, rankResults, hardBlockers, type MatchResult } from "./score.js";
export {
  ScoringConfigSchema,
  loadScoringConfig,
  defaultScoringConfig,
  DEFAULT_SCORING_PATH,
  type ScoringConfig
} from "./scoring-config.js";
export { searchJobs, type FulltextHit } from "./fulltext.js";
export { noopEmbeddings, cosineSimilarity, type EmbeddingsProvider } from "./embeddings.js";
export {
  evaluateMatching,
  renderEvalMarkdown,
  type LabeledItem,
  type EvalMetrics
} from "./evaluate.js";
export { DatasetSchema, DatasetItemSchema, expandDataset, type Dataset } from "./dataset.js";
