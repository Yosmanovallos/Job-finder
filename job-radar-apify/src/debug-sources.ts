import {
  scrapeLinkedIn,
  scrapeComputrabajo,
  scrapeElempleo,
  scrapeTorre,
  scrapeWorkana,
  scrapeMagneto,
  scrapeWeRemoto,
  scrapeGetOnBoard,
  scrapeRemoteOK
} from './index.js';

async function debugAllSources() {
  const keyword = "Project Manager";
  console.log(`=== DEBUGGING ALL SOURCES FOR KEYWORD: "${keyword}" ===\n`);

  console.log('1. Torre...');
  const torre = await scrapeTorre(keyword);
  console.log(`Torre returned ${torre.length} jobs.`);
  if (torre.length > 0) console.log('Sample:', torre[0]);

  console.log('\n2. Workana...');
  const workana = await scrapeWorkana(keyword);
  console.log(`Workana returned ${workana.length} jobs.`);
  if (workana.length > 0) console.log('Sample:', workana[0]);

  console.log('\n3. Magneto...');
  const magneto = await scrapeMagneto(keyword);
  console.log(`Magneto returned ${magneto.length} jobs.`);
  if (magneto.length > 0) console.log('Sample:', magneto[0]);

  console.log('\n4. Elempleo...');
  const elempleo = await scrapeElempleo(keyword);
  console.log(`Elempleo returned ${elempleo.length} jobs.`);
  if (elempleo.length > 0) console.log('Sample:', elempleo[0]);

  console.log('\n5. WeRemoto...');
  const weremoto = await scrapeWeRemoto();
  console.log(`WeRemoto returned ${weremoto.length} jobs.`);

  console.log('\n6. GetOnBoard...');
  const getonboard = await scrapeGetOnBoard();
  console.log(`GetOnBoard returned ${getonboard.length} jobs.`);
}

debugAllSources();
