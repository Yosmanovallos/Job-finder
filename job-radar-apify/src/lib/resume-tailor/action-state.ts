import { LANGUAGE_NAME, type CvLanguage } from "./language.js";
import { missingNotice } from "./assist.js";

// AI Resume Studio R4d — «botones que parecen no hacer nada» (report P0,
// NN/g response-time limits). Every AI button goes through this state:
//   click  → «working» at once (the button itself shows the spinner and a
//            verb: «Redactando…»; same render, well under 0.1 s);
//   10 s   → «slow»: «Esto está tardando más de lo normal» + Cancelar;
//   answer → «result», shown IN PLACE of the button at normal size, with the
//            next steps (never grey small print at the foot of the card).
// Pure: the reducer and the outcome texts are unit-tested.

export const SLOW_AFTER_MS = 10_000;

export type NextStep = "back" | "tell" | "skip" | "retry";

export type ActionState =
  | { kind: "idle" }
  | { kind: "working"; action: string; startedAt: number; slow: boolean }
  | { kind: "result"; action: string; tone: "ok" | "info" | "error"; title: string; text: string; next: NextStep[] };

export type ActionEvent =
  | { type: "start"; action: string; at: number }
  | { type: "tick"; at: number }
  | { type: "cancel" }
  | { type: "done"; outcome: Omit<Extract<ActionState, { kind: "result" }>, "kind" | "action"> | null }
  | { type: "clear" };

export const IDLE: ActionState = { kind: "idle" };

export function actionReducer(state: ActionState, event: ActionEvent): ActionState {
  switch (event.type) {
    case "start":
      // One AI call at a time per card: a second click while working is ignored.
      return state.kind === "working" ? state : { kind: "working", action: event.action, startedAt: event.at, slow: false };
    case "tick":
      return state.kind === "working" && !state.slow && event.at - state.startedAt >= SLOW_AFTER_MS ? { ...state, slow: true } : state;
    case "cancel":
      return state.kind === "working"
        ? { kind: "result", action: state.action, tone: "info", title: "Cancelado", text: "No se cambió nada. Puedes intentarlo de nuevo cuando quieras.", next: ["retry", "skip"] }
        : state;
    case "done":
      if (state.kind !== "working") return state;
      return event.outcome ? { kind: "result", action: state.action, ...event.outcome } : IDLE;
    case "clear":
      return IDLE;
  }
}

/** What the server answered for one AI turn, as the card's response (copy: report proposal, not tested with users). */
export type CardAnswer =
  | { status: "proposal" }
  | { status: "question"; claims: { kind: string; value: string }[]; question: string }
  | { status: "discarded"; claims: { kind: string; value: string }[]; reason?: string; language?: CvLanguage | null }
  | { status: "error"; error: string };

export function outcomeFor(
  answer: CardAnswer,
  requirement: string,
  /** The turn came from the user's own request («agrega que…», «mejóralo»): explain THAT, not the requirement. */
  options: { userRequest?: boolean; retried?: boolean } = {}
): Omit<Extract<ActionState, { kind: "result" }>, "kind" | "action"> | null {
  if (answer.status === "proposal") return null;
  if ((options.userRequest || options.retried) && answer.status !== "error" && !answer.claims.length && !(answer.status === "discarded" && answer.reason === "language")) {
    const why = answer.status === "question" && answer.question.trim() ? answer.question.trim() : "Tu hoja de vida no muestra ese dato.";
    // «Redactar solo con mi CV» after a «no evidence» card: the card already said what's missing; say only the new part.
    return options.retried
      ? { tone: "info", title: "Tampoco con tu CV", text: `${why} No escribimos nada que tu hoja de vida no diga.`, next: ["back", "tell", "skip"] }
      : { tone: "info", title: "No lo agregamos", text: `${why} No escribimos nada que tu hoja de vida no diga.`, next: ["tell", "skip"] };
  }
  if (answer.status === "error") return { tone: "error", title: "No se pudo esta vez", text: answer.error, next: ["retry", "tell", "skip"] };
  if (answer.status === "discarded" && answer.reason === "language") {
    const lang = answer.language ? LANGUAGE_NAME[answer.language] : "el idioma de tu hoja de vida";
    return {
      tone: "info",
      title: "Salió en otro idioma",
      text: `Tu hoja de vida está en ${lang} y la propuesta no, así que no la aplicamos. Puedes intentarlo de nuevo o escribirlo tú.`,
      next: ["retry", "tell", "skip"]
    };
  }
  // The proposal cited a CV line that doesn't exist, or came back empty: nothing specific is «missing».
  if (answer.status === "discarded" && !answer.claims.length) {
    return {
      tone: "info",
      title: "No pudimos verificarla",
      text: "La propuesta se apoyaba en algo que no encontramos en tu hoja de vida, así que no la mostramos. Puedes pedir otra redactada solo con tu CV o escribirlo tú.",
      next: ["retry", "tell", "skip"]
    };
  }
  const n = missingNotice({ claims: answer.claims, requirement, question: answer.status === "question" ? answer.question : "" });
  return {
    tone: "info",
    title: "Tu CV no lo muestra",
    text: `Tu hoja de vida no menciona «${n.missing}», así que no lo escribimos por ti. ${n.ask}`,
    next: ["back", "tell", "skip"]
  };
}
