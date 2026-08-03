import { SourceAdapter } from "./types.js";
import { linkedinAdapter } from "./linkedin.js";
import { computrabajoAdapter } from "./computrabajo.js";
import { elempleoAdapter } from "./elempleo.js";
import { torreAdapter } from "./torre.js";
import { magnetoAdapter } from "./magneto.js";
import { workanaAdapter } from "./workana.js";
import { workanaV2Adapter } from "./workana-v2.js";
import { weremotoAdapter } from "./weremoto.js";
import { getonboardAdapter } from "./getonboard.js";
import { remoteokAdapter } from "./remoteok.js";
import { remotiveAdapter } from "./remotive.js";
import { indeedAdapter } from "./indeed.js";
import { glassdoorAdapter } from "./glassdoor.js";
import { joobleAdapter } from "./jooble.js";
import { linkedinVEAdapter } from "./linkedin-ve.js";
import { computrabajoVEAdapter } from "./computrabajo-ve.js";
import { joobleVEAdapter } from "./jooble-ve.js";

export * from "./types.js";

export const allAdapters: SourceAdapter[] = [
  linkedinAdapter,
  computrabajoAdapter,
  elempleoAdapter,
  torreAdapter,
  magnetoAdapter,
  workanaAdapter,
  workanaV2Adapter,
  weremotoAdapter,
  getonboardAdapter,
  remoteokAdapter,
  remotiveAdapter,
  indeedAdapter,
  glassdoorAdapter,
  joobleAdapter,
  linkedinVEAdapter,
  computrabajoVEAdapter,
  joobleVEAdapter
];

export {
  linkedinAdapter,
  computrabajoAdapter,
  elempleoAdapter,
  torreAdapter,
  magnetoAdapter,
  workanaAdapter,
  workanaV2Adapter,
  weremotoAdapter,
  getonboardAdapter,
  remoteokAdapter,
  remotiveAdapter,
  indeedAdapter,
  glassdoorAdapter,
  joobleAdapter,
  linkedinVEAdapter,
  computrabajoVEAdapter,
  joobleVEAdapter
};
