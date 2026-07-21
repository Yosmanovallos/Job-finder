import fs from 'fs';
import path from 'path';

async function checkCacheJobs() {
  const cachePath = path.join(process.cwd(), 'data', 'jobs-cache.json');
  if (!fs.existsSync(cachePath)) {
    console.log('No cache file found.');
    return;
  }

  const data = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
  console.log(`Total runs in cache: ${data.runs ? data.runs.length : 0}`);
  console.log(`Total jobs in cache: ${data.jobs ? data.jobs.length : 0}\n`);

  const ctJobs = (data.jobs || []).filter((j: any) => j.source === 'Computrabajo' || (j.url && j.url.includes('computrabajo')));
  console.log(`Found ${ctJobs.length} Computrabajo jobs in cache.\n`);

  for (let i = 0; i < Math.min(ctJobs.length, 10); i++) {
    const job = ctJobs[i];
    console.log(`Job ${i + 1}: "${job.title}"`);
    console.log(`  URL: "${job.url}"`);

    try {
      const res = await fetch(job.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        redirect: 'follow'
      });
      console.log(`  Fetch Status: ${res.status} | Final URL: ${res.url}`);
      const body = await res.text();

      if (body.includes('Object reference not set') || body.includes('500 Server Error') || res.status >= 400) {
        console.log('  ❌ BROKEN / ERROR PAGE DETECTED!');
        console.log('  Body snippet:', body.substring(0, 250).replace(/\s+/g, ' '));
      } else {
        console.log('  ✅ WORKING PAGE!');
      }
    } catch (e: any) {
      console.log(`  Fetch Error: ${e.message}`);
    }
    console.log('--------------------------------------------------');
  }
}

checkCacheJobs();
