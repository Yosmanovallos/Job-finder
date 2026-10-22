import assert from "node:assert/strict";
import test from "node:test";
import { getOfficialCareersUrl } from "../src/data/official-careers-links.js";

/**
 * Company pages of employers whose vacancies can't be read link to the
 * employer's own careers site (owner decision 2026-10-22).
 */

test("every spelling of a listed employer gets its own careers site", () => {
  const accenture = "https://www.accenture.com/co-es/careers/jobsearch";
  assert.equal(getOfficialCareersUrl(["Accenture"]), accenture);
  assert.equal(getOfficialCareersUrl(["Accenture Colombia"]), accenture);
  assert.equal(getOfficialCareersUrl(["ACCENTURE S.A.S."]), accenture);
  assert.equal(getOfficialCareersUrl(["IBM"]), "https://www.ibm.com/careers/search?field_keyword_05%5B0%5D=Colombia");
});

test("first spelling with an entry wins; unknown employers get no link", () => {
  assert.equal(getOfficialCareersUrl(["Desconocida SAS", "Globant"]), "https://career.globant.com/");
  assert.equal(getOfficialCareersUrl(["Bancolombia"]), null, "read from its own board, no link needed");
  assert.equal(getOfficialCareersUrl(["Meta Consultores"]), null, "a different company, not Meta");
  assert.equal(getOfficialCareersUrl([]), null);
});

test("every link is https on the employer's own site", () => {
  for (const name of ["Amazon", "Meta", "IBM", "Globant", "Accenture", "Deloitte", "D1", "Oracle", "Hilton", "Nokia"]) {
    const url = getOfficialCareersUrl([name]);
    assert.ok(url && url.startsWith("https://"), name);
  }
});
