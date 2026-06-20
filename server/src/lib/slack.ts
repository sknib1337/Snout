import { Request } from "express";
import { hmacHex, safeEqual } from "./hmac";
import { config } from "../config";

/**
 * Verify a Slack request signature.
 * https://api.slack.com/authentication/verifying-requests-from-slack
 * Requires the raw request body (captured in index.ts as req.rawBody).
 */
export function verifySlack(req: Request): boolean {
  if (!config.slackSigningSecret) return false;
  const ts = req.header("x-slack-request-timestamp");
  const sig = req.header("x-slack-signature");
  const raw = (req as any).rawBody as Buffer | undefined;
  if (!ts || !sig || !raw) return false;

  // Reject anything older than 5 minutes to blunt replay attacks.
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;

  const base = `v0:${ts}:${raw.toString("utf8")}`;
  const expected = `v0=${hmacHex(config.slackSigningSecret, base)}`;
  return safeEqual(expected, sig);
}
