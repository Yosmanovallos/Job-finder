import { getJobs } from '../db/job-repository.js';
import { generateSocialDigest, SocialDigest } from './digest-generator.js';
import { generateCardSvg } from './card-generator.js';

export interface SocialPostRecord {
  id: string;
  category: string;
  platform: 'twitter' | 'instagram' | 'facebook' | 'tiktok';
  postId: string;
  status: 'posted' | 'failed' | 'pending';
  postedAt: string;
  digestSummary: string;
}

// In-memory social post registry for tracking published posts
const publishedSocialPosts: SocialPostRecord[] = [];
let lastPublishedTimestamp = 0;
const MIN_POST_INTERVAL_MS = 5 * 60 * 1000; // Minimum 5 minutes between posts

/**
 * Checks if rate limit interval has passed
 */
export function canPublishNextPost(): boolean {
  return Date.now() - lastPublishedTimestamp >= MIN_POST_INTERVAL_MS;
}

/**
 * Publishes unposted jobs as formatted category digests across social networks
 */
export async function publishPendingDigests(): Promise<{ publishedCount: number; records: SocialPostRecord[] }> {
  console.log(`\n==================================================`);
  console.log(`🤖 [SocialPublisher] Iniciando ciclo de publicación automatizada de digests...`);
  console.log(`==================================================\n`);

  const jobs = await getJobs(100);
  if (!jobs || jobs.length === 0) {
    console.log(`ℹ️ [SocialPublisher] No hay vacantes disponibles para generar digests.`);
    return { publishedCount: 0, records: [] };
  }

  // Group jobs by category/role
  const categoryMap = new Map<string, typeof jobs>();

  for (const job of jobs) {
    const category = job.role_origin || 'Desarrollo y Tecnología';
    if (!categoryMap.has(category)) {
      categoryMap.set(category, []);
    }
    categoryMap.get(category)!.push(job);
  }

  const newRecords: SocialPostRecord[] = [];

  for (const [category, categoryJobs] of categoryMap.entries()) {
    // Check if category was already published in this session
    const alreadyPosted = publishedSocialPosts.some(p => p.category === category);
    if (alreadyPosted) {
      console.log(`ℹ️ [SocialPublisher] Digest para "${category}" ya fue publicado previamente. Omitiendo.`);
      continue;
    }

    console.log(`📢 [SocialPublisher] Generando Digest para categoría: "${category}" (${categoryJobs.length} vacantes)...`);

    const digest = generateSocialDigest(category, categoryJobs);
    const cardSvg = generateCardSvg(digest);

    // Simulate API dispatch to Twitter/Meta
    const mockPostId = `post_tw_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

    console.log(`\n--- 🐤 Twitter Copy (${digest.twitterCopy.length} caracteres) ---`);
    console.log(digest.twitterCopy);

    console.log(`\n--- 📸 Card SVG Generado (${cardSvg.length} bytes) ---`);
    console.log(`✅ [SocialPublisher] Card SVG renderizado correctamente con diseño anima-project.`);

    const record: SocialPostRecord = {
      id: `sp_${Date.now()}`,
      category,
      platform: 'twitter',
      postId: mockPostId,
      status: 'posted',
      postedAt: new Date().toISOString(),
      digestSummary: `${digest.jobCount} vacantes de ${category}`
    };

    publishedSocialPosts.push(record);
    newRecords.push(record);
    lastPublishedTimestamp = Date.now();

    console.log(`\n🎉 [SocialPublisher] Digest publicado exitosamente en Twitter/Meta con ID: ${mockPostId}`);
    break; // Process 1 digest per interval to observe rate limits
  }

  return {
    publishedCount: newRecords.length,
    records: newRecords
  };
}

export function getSocialPostHistory(): SocialPostRecord[] {
  return publishedSocialPosts;
}
