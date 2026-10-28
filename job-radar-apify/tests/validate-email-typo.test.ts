import assert from "node:assert/strict";
import test from "node:test";
import { suggestEmailCorrection } from "../src/lib/email-typo.js";

test("email typo: mistyped webmail domains get a suggestion", () => {
  // The real 2026-10-28 signup that never received its confirmation email.
  assert.equal(suggestEmailCorrection("ana@gmail.comv"), "ana@gmail.com");
  assert.equal(suggestEmailCorrection("ana@gmial.com"), "ana@gmail.com");
  assert.equal(suggestEmailCorrection("ana@gmail.co"), "ana@gmail.com");
  assert.equal(suggestEmailCorrection("ana@hotmial.com"), "ana@hotmail.com");
  assert.equal(suggestEmailCorrection("ana@outlok.com"), "ana@outlook.com");
  assert.equal(suggestEmailCorrection(" Ana.P@GMAIL.CON "), "Ana.P@gmail.com");
});

test("email typo: valid and unrelated domains are left alone", () => {
  for (const email of [
    "ana@gmail.com",
    "ana@hotmail.es",
    "ana@mail.com",
    "ana@ymail.com",
    "ana@me.com",
    "ana@ice.com",
    "ana@empresa.com.co",
    "ana@unal.edu.co",
    "sin-arroba",
    "@gmail.com",
    "ana@"
  ]) {
    assert.equal(suggestEmailCorrection(email), null, email);
  }
});
