/**
 * Optional local-embeddings hook (plan §13.1 stage 2). Phase 4 ships only the
 * seam: a provider interface plus the no-op default. A real local provider
 * (e.g. Ollama) plugs in behind a feature flag in a later phase — matching
 * must stay fully useful without it.
 */

export interface EmbeddingsProvider {
  readonly name: string;
  embed(texts: string[]): Promise<number[][]>;
}

export const noopEmbeddings: EmbeddingsProvider = {
  name: "none",
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map(() => []);
  }
};

export function cosineSimilarity(a: number[], b: number[]): number | null {
  if (a.length === 0 || a.length !== b.length) {
    return null;
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  if (normA === 0 || normB === 0) {
    return null;
  }
  return dot / Math.sqrt(normA * normB);
}
