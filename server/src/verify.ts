// Adversarial verification (depth D3). A second LLM pass tries to *refute* each
// non-`unknown`, non-KB-verified verdict; deterministically demote anything it can't
// defend to `unknown` and cap the recommendation. The LLM call is the trigger; the
// demotion below is deterministic and unit-tested (mirrors the schema-clamp philosophy).
import { ControlKey, ControlFinding, Verdict, Assessment } from "./controls";

type Rec = Assessment["recommendation"];
const POSITIVE: Verdict[] = ["supported", "partial"];

export interface Refutation { control: ControlKey; refuted: boolean; reason?: string }

export const VERIFY_SYSTEM =
  `You are a skeptical identity-security reviewer auditing another analyst's findings. For EACH control you are given, decide whether the claimed verdict is genuinely supported by the cited evidence. ` +
  `Be adversarial: if the evidence is weak, missing, generic, or doesn't clearly prove the capability on an enterprise plan, mark it refuted. Default to refuted=true when uncertain. ` +
  `Output ONLY this JSON: {"refutations":[{"control":"","refuted":true,"reason":""}]} — no prose, no code fences.`;

/** Build the user prompt listing the current findings to be challenged. */
export function buildRefutationPrompt(app: string, caps: Record<ControlKey, ControlFinding>): string {
  const lines = (Object.keys(caps) as ControlKey[])
    .filter((k) => caps[k].verdict !== "unknown" && caps[k].source !== "kb-verified")
    .map((k) => {
      const f = caps[k];
      const cites = f.citations.map((c) => c.url).filter(Boolean).join(" ") || "(no citations)";
      return `- ${k}: verdict=${f.verdict}; evidence="${f.summary}"; citations=${cites}`;
    });
  if (!lines.length) return `App: ${app}\nNo non-trivial findings to review. Return {"refutations":[]}.`;
  return `App: ${app}\nReview these findings and refute any not clearly proven:\n${lines.join("\n")}`;
}

/** Parse the reviewer's JSON defensively into a list of refutations. */
export function parseRefutations(raw: unknown): Refutation[] {
  let obj: any = raw;
  if (typeof raw === "string") {
    const s = raw.indexOf("{"), e = raw.lastIndexOf("}");
    if (s === -1 || e === -1) return [];
    try { obj = JSON.parse(raw.slice(s, e + 1)); } catch { return []; }
  }
  const arr = Array.isArray(obj?.refutations) ? obj.refutations : [];
  const out: Refutation[] = [];
  for (const r of arr) {
    if (r && typeof r.control === "string") {
      out.push({ control: r.control as ControlKey, refuted: r.refuted !== false, reason: typeof r.reason === "string" ? r.reason.slice(0, 200) : undefined });
    }
  }
  return out;
}

/** Deterministically demote refuted positive verdicts to `unknown` (KB-verified facts
 *  are never demoted) and cap the recommendation if anything was demoted. */
export function applyRefutations(
  caps: Record<ControlKey, ControlFinding>,
  recommendation: Rec,
  refutations: Refutation[],
): { caps: Record<ControlKey, ControlFinding>; recommendation: Rec; demoted: ControlKey[] } {
  const map = new Map(refutations.map((r) => [r.control, r]));
  const out = {} as Record<ControlKey, ControlFinding>;
  const demoted: ControlKey[] = [];
  for (const k of Object.keys(caps) as ControlKey[]) {
    const f = caps[k];
    const r = map.get(k);
    if (r?.refuted && f.source !== "kb-verified" && POSITIVE.includes(f.verdict)) {
      out[k] = { ...f, verdict: "unknown", citations: [], confidence: f.confidence != null ? Math.min(f.confidence, 0.3) : undefined };
      demoted.push(k);
    } else {
      out[k] = f;
    }
  }
  const rec = demoted.length && (recommendation === "Approve" || recommendation === "Approve with conditions") ? "Hold" : recommendation;
  return { caps: out, recommendation: rec, demoted };
}
