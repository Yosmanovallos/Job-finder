import React from "react";
import { renderIntentAnswerHtml, type IntentAnswer } from "../lib/intent-pages.js";

// The answer block of an intent page (ADR 0012, design D4). The server
// computed it once and embedded it in __SSR_CATEGORY__; this renders the
// exact same escaped HTML string the server put in the raw page, so the
// hydrated DOM can never differ from it (SIP-031).
export function IntentAnswerBlock({ answer }: { answer: IntentAnswer }) {
  return (
    <section
      data-intent-answer=""
      aria-label={answer.heading}
      className="intent-answer"
      dangerouslySetInnerHTML={{ __html: renderIntentAnswerHtml(answer) }}
    />
  );
}
