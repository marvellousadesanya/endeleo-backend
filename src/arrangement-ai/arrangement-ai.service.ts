// The AI layer behind the arrangement engine's modules.
//
// The specification describes M1 as NLP extraction, M2 as a regression + DSCR model, M3
// as a multi-objective optimiser and M5 as an ML pricing model. There is no closed-deal
// history to fit any of those to, so what runs is a language model reasoning over the
// deal's own figures and returning a structured opinion with its rationale.
//
// It sits *alongside* the deterministic computation rather than replacing it. Both are
// returned. That is not hedging: a model with nothing to calibrate against will
// sometimes be wrong in ways nobody can see from its output alone, and the arithmetic it
// was given is the only thing a reviewer can check it against. The UI shows the model's
// answer as the recommendation, with the computed figure beside it.
//
// Disabled unless ARRANGEMENT_AI_ENABLED is true and a key is set — same posture as
// EmailService, which logs and carries on rather than failing the request it was part of.
import Anthropic from "@anthropic-ai/sdk";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

/** The model's opinion on one module, and why. */
export interface AiOpinion {
  /** Short headline a panel can show, e.g. "Bankable, with tariff risk". */
  verdict: string;
  /** The reasoning, in the arranger's own register. Shown as "AI Rationale". */
  rationale: string;
  /**
   * The model's own number where the module has one — a score out of 100 for M2, a
   * spread in bps for M5. Null when it declined to give one.
   */
  value: number | null;
  /** How far the model would trust its own answer, 0–1. */
  confidence: number;
  /** Anything it wants a person to check before the deal moves on. */
  flags: string[];
}

const MODEL = "claude-sonnet-5";
/**
 * Headroom for the whole JSON object, not just the prose.
 *
 * Set to 900 first, and every reply came back stop_reason=max_tokens — cut mid-object,
 * so the JSON would not parse and all three modules silently fell back. The prompt now
 * bounds the rationale as well; this is the ceiling that stops a long one truncating
 * rather than the thing keeping replies short.
 */
const MAX_TOKENS = 2000;

@Injectable()
export class ArrangementAiService {
  private readonly logger = new Logger(ArrangementAiService.name);
  private readonly client: Anthropic | null;

  constructor(private readonly config: ConfigService) {
    const key = config.get<string>("ANTHROPIC_API_KEY");
    const enabled = config.get<boolean>("ARRANGEMENT_AI_ENABLED") === true;
    this.client = enabled && key ? new Anthropic({ apiKey: key }) : null;
    if (!this.client) {
      this.logger.log(
        "Arrangement AI is off — modules fall back to the deterministic computation",
      );
    }
  }

  get enabled(): boolean {
    return this.client !== null;
  }

  /** Recorded against each stored opinion, so it can be read in light of what produced it. */
  get modelName(): string {
    return MODEL;
  }

  /**
   * Ask the model for its opinion on one module.
   *
   * Returns null rather than throwing when the AI is off, the call fails, or the reply
   * cannot be parsed. Every caller already has a computed answer; an unavailable model
   * must degrade to that rather than take the screen down with it.
   */
  async opine(args: {
    module: string;
    /** What the module is being asked to decide. */
    task: string;
    /** The deal, already computed — the model reasons over this, it does not fetch. */
    facts: Record<string, unknown>;
  }): Promise<AiOpinion | null> {
    if (!this.client) return null;

    try {
      const response = await this.client.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              `Module: ${args.module}`,
              `Task: ${args.task}`,
              "",
              "Deal facts (already computed — treat these figures as given):",
              JSON.stringify(args.facts, null, 2),
              "",
              "Reply with JSON only, matching this shape:",
              `{"verdict": string, "rationale": string, "value": number|null, "confidence": number, "flags": string[]}`,
            ].join("\n"),
          },
        ],
      });

      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");

      const opinion = parseOpinion(text);
      if (!opinion) {
        // A reply that arrived but could not be read is a different problem from a call
        // that failed, and silently returning null for both makes the two impossible to
        // tell apart from the outside. stop_reason is the usual culprit: a rationale that
        // runs past max_tokens is cut mid-JSON.
        this.logger.warn(
          `AI reply for ${args.module} was unusable ` +
            `(stop_reason=${response.stop_reason}, ${text.length} chars): ` +
            text.slice(0, 300).replace(/\s+/g, " "),
        );
      }
      return opinion;
    } catch (err) {
      // Logged, not thrown: the caller has a deterministic answer to fall back to.
      this.logger.error(`AI opinion for ${args.module} failed: ${String(err)}`);
      return null;
    }
  }
}

const SYSTEM_PROMPT = [
  "You are the analytical layer of Endeleo's bond arrangement engine, working on Nigerian",
  "infrastructure debt denominated in naira.",
  "",
  "You are given figures that have already been computed deterministically from the",
  "sponsor's own cashflow projection. Do not recompute them and do not contradict the",
  "arithmetic — if debt service coverage is 0.79x, it is 0.79x. Your job is judgement on",
  "top of the arithmetic: what the numbers imply, what is missing, and what a credit",
  "committee would ask next.",
  "",
  "Be direct about weakness. A deal that cannot service its debt should be described as",
  "such in the first sentence, not softened. Where you are uncertain, lower your",
  "confidence rather than hedging the language.",
  "",
  "There is no closed-deal history behind this platform and no live market data feed, so",
  "you have no comparables to price against. Say so when it matters rather than implying",
  "a precision you do not have.",
  "",
  "Reply with a single JSON object and nothing else — no prose before or after, no code",
  "fences.",
  "",
  "Keep it tight enough to fit in one reply: `rationale` under 120 words, `verdict` a",
  "single line, and at most four `flags` of one sentence each. A reply that runs long is",
  "truncated mid-object and discarded, so length costs you the whole answer.",
].join("\n");

/** Tolerant of a model that wraps its JSON in prose or a fence, strict about the shape. */
export function parseOpinion(text: string): AiOpinion | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;

  try {
    const raw = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    const verdict = typeof raw.verdict === "string" ? raw.verdict.trim() : "";
    const rationale = typeof raw.rationale === "string" ? raw.rationale.trim() : "";
    if (!verdict || !rationale) return null;

    return {
      verdict,
      rationale,
      value: typeof raw.value === "number" && Number.isFinite(raw.value) ? raw.value : null,
      confidence:
        typeof raw.confidence === "number" && Number.isFinite(raw.confidence)
          ? Math.max(0, Math.min(1, raw.confidence))
          : 0.5,
      flags: Array.isArray(raw.flags)
        ? raw.flags.filter((f): f is string => typeof f === "string").slice(0, 10)
        : [],
    };
  } catch {
    return null;
  }
}
