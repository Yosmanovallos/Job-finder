import { SourceAdapter } from './types.js';
import { linkedinAdapter } from './linkedin.js';
import { computrabajoAdapter } from './computrabajo.js';
import { elempleoAdapter } from './elempleo.js';
import { torreAdapter } from './torre.js';
import { magnetoAdapter } from './magneto.js';
import { workanaAdapter } from './workana.js';
import { weremotoAdapter } from './weremoto.js';
import { getonboardAdapter } from './getonboard.js';
import { remoteokAdapter } from './remoteok.js';
import { remotiveAdapter } from './remotive.js';
import { indeedAdapter } from './indeed.js';
import { glassdoorAdapter } from './glassdoor.js';

export * from './types.js';

export const allAdapters: SourceAdapter[] = [
  linkedinAdapter,
  computrabajoAdapter,
  elempleoAdapter,
  torreAdapter,
  magnetoAdapter,
  workanaAdapter,
  weremotoAdapter,
  getonboardAdapter,
  remoteokAdapter,
  remotiveAdapter,
  indeedAdapter,
  glassdoorAdapter,
];

export {
  linkedinAdapter,
  computrabajoAdapter,
  elempleoAdapter,
  torreAdapter,
  magnetoAdapter,
  workanaAdapter,
  weremotoAdapter,
  getonboardAdapter,
  remoteokAdapter,
  remotiveAdapter,
  indeedAdapter,
  glassdoorAdapter,
};
