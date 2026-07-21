import fs from 'fs';
import path from 'path';

const CACHE_FILE = path.join(process.cwd(), 'data', 'jobs-cache.json');

if (fs.existsSync(CACHE_FILE)) {
  let content = fs.readFileSync(CACHE_FILE, 'utf-8');
  content = content
    .replaceAll('https://co.computrabajo.com', 'https://www.computrabajo.com.co')
    .replaceAll('http://co.computrabajo.com', 'https://www.computrabajo.com.co')
    .replaceAll('http://www.computrabajo.com.co', 'https://www.computrabajo.com.co');
  
  fs.writeFileSync(CACHE_FILE, content, 'utf-8');
  console.log('[Cache Cleanup] All Computrabajo URLs in data/jobs-cache.json have been updated to https://www.computrabajo.com.co');
}
