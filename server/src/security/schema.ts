import { z } from "zod";
import { ControlKey, Verdict } from "../controls";
import { safeUrl, sanitizeField } from "./sanitize";

// Deterministic validation of the model's JSON. This is the load-bearing
// anti-injection control: even if a search result coerces the model into odd
// output, the result is clamped to this shape — bounded length, known enums,
// sanitized citation URLs — before it is ever stored, rendered, or sent to chat.

const clampStr = (max: number) => z.preprocess((v) => sanitizeField(v, max * 2), z.string().max(max).catch("").default(""));

const Verdicts: Verdict[] = ["supported", "partial", "unsupported", "unknown"];

const Citation = z.object({
  title: clampStr(160),
  url: z.preprocess((v) => safeUrl(v) ?? "", z.string()),
}).transform((c) => ({ title: c.title, url: c.url }))
  .refine((c) => c.url.length > 0 || c.title.length > 0, { message: "empty" })
  .catch({ title: "", url: "" });

const Finding = z.object({
  verdict: z.preprocess(
    (v) => (Verdicts.includes(v as Verdict) ? v : "unknown"),
    z.enum(["supported", "partial", "unsupported", "unknown"]),
  ),
  standards: z.array(clampStr(40)).max(8).catch([]).default([]),
  summary: clampStr(600),
  citations: z.array(Citation).max(3)
    .transform((arr) => arr.filter((c) => c.url || c.title))
    .catch([]).default([]),
}).catch({ verdict: "unknown", standards: [], summary: "", citations: [] });

const CONTROL_KEYS: ControlKey[] = ["sso", "ulm", "entitlements", "riskSignals", "logout", "tokenRevocation"];

const RawAssessment = z.object({
  app: clampStr(120),
  vendor: clampStr(120),
  category: clampStr(80),
  summary: clampStr(1200),
  capabilities: z.record(z.string(), Finding).default({}),
  extended: z.object({
    discoverability: clampStr(600),
    onboardingRecovery: clampStr(600),
    enterpriseDiscovery: clampStr(600),
    usageMonitoring: clampStr(600),
    usageRestrictions: clampStr(600),
  }).partial().catch({}).default({}),
  recommendation: z.preprocess(
    (v) => (["Approve", "Approve with conditions", "Hold", "Reject"].includes(v as string) ? v : "Hold"),
    z.enum(["Approve", "Approve with conditions", "Hold", "Reject"]),
  ),
  recommendationRationale: clampStr(1200),
  conditions: z.array(clampStr(280)).max(10).catch([]).default([]),
  ownerMap: z.array(z.object({ function: clampStr(60), responsibility: clampStr(400) })).max(12).catch([]).default([]),
  risks: z.array(clampStr(280)).max(6).catch([]).default([]),
});

type FindingT = z.infer<typeof Finding>;
export interface CleanAssessment {
  app: string;
  vendor: string;
  category: string;
  summary: string;
  capabilities: Record<ControlKey, FindingT>;
  extended: {
    discoverability: string;
    onboardingRecovery: string;
    enterpriseDiscovery: string;
    usageMonitoring: string;
    usageRestrictions: string;
  };
  recommendation: "Approve" | "Approve with conditions" | "Hold" | "Reject";
  recommendationRationale: string;
  conditions: string[];
  ownerMap: { function: string; responsibility: string }[];
  risks: string[];
}

/** Validate, coerce, and bound the model output. Always returns all six controls. */
export function validateAgentOutput(raw: unknown): CleanAssessment {
  const parsed = RawAssessment.parse(raw ?? {});
  const caps: Record<string, FindingT> = {};
  for (const k of CONTROL_KEYS) {
    caps[k] = (parsed.capabilities as any)?.[k] ?? { verdict: "unknown", standards: [], summary: "", citations: [] };
  }
  return {
    app: parsed.app,
    vendor: parsed.vendor,
    category: parsed.category,
    summary: parsed.summary,
    recommendation: parsed.recommendation,
    recommendationRationale: parsed.recommendationRationale,
    conditions: parsed.conditions,
    ownerMap: parsed.ownerMap,
    risks: parsed.risks,
    extended: {
      discoverability: parsed.extended.discoverability ?? "",
      onboardingRecovery: parsed.extended.onboardingRecovery ?? "",
      enterpriseDiscovery: parsed.extended.enterpriseDiscovery ?? "",
      usageMonitoring: parsed.extended.usageMonitoring ?? "",
      usageRestrictions: parsed.extended.usageRestrictions ?? "",
    },
    capabilities: caps as Record<ControlKey, FindingT>,
  };
}
