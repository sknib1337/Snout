// Sanitizers and detectors. Defense-in-depth around an LLM that ingests
// untrusted user input AND untrusted web-search results.

/** Collapse whitespace, strip control chars, clamp length. For short fields
 *  this also removes newlines so a value can't break out of a prompt fence. */
export function sanitizeField(input: unknown, max = 600): string {
  return String(input ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ") // control chars -> space
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

const ALLOWED_PROTO = new Set(["http:", "https:"]);

function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".localhost")) return true;
  // IPv6 loopback / link-local / unique-local
  if (h === "::1" || h === "::" || h.startsWith("fe80:") || h.startsWith("fc") || h.startsWith("fd")) return true;
  // IPv4
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 10 || a === 127 || a === 0) return true;             // private / loopback / this-network
    if (a === 192 && b === 168) return true;                       // private
    if (a === 172 && b >= 16 && b <= 31) return true;              // private
    if (a === 169 && b === 254) return true;                       // link-local + cloud metadata (169.254.169.254)
    if (a === 100 && b >= 64 && b <= 127) return true;             // CGNAT
  }
  return false;
}

/** Returns a safe absolute http(s) URL, or null. Blocks dangerous schemes,
 *  embedded credentials, and private/loopback/metadata hosts (SSRF + link
 *  injection). Used for both the user-supplied URL and agent citations. */
export function safeUrl(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  if (!s || s.length > 2048) return null;
  let u: URL;
  try { u = new URL(s); } catch { return null; }
  if (!ALLOWED_PROTO.has(u.protocol)) return null;
  if (u.username || u.password) return null;
  if (!u.hostname || isPrivateHost(u.hostname)) return null;
  return u.href;
}

/** Neutralize text before sending to Slack/Teams: escape control characters
 *  used for links/mentions and strip broadcast mentions (LLM05 output handling). */
export function forChat(text: unknown, max = 700): string {
  return sanitizeField(text, max)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/@(everyone|here|channel)/gi, "$1");
}

// Heuristics for known injection phrasing. Conservative — used to LOG/flag, not
// to hard-block, since a real app name could coincidentally match. Structural
// defenses (fencing + output validation) are the real protection.
const INJECTION_PATTERNS = [
  /ignore (all |the )?(previous|prior|above) (instructions|prompts?)/i,
  /disregard (all |the )?(previous|prior|above)/i,
  /(reveal|print|show|repeat) (your |the )?(system )?(prompt|instructions)/i,
  /you are now\b/i,
  /\bdeveloper mode\b/i,
  /\bnew instructions?\b/i,
  /mark (all )?(controls?|capabilities?) as supported/i,
  /override (your |the )?(rules|guardrails|instructions)/i,
];

export function detectInjection(text: unknown): { flagged: boolean; pattern?: string } {
  const s = String(text ?? "");
  for (const p of INJECTION_PATTERNS) if (p.test(s)) return { flagged: true, pattern: p.source };
  return { flagged: false };
}
