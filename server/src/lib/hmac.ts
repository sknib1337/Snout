import crypto from "crypto";

export function hmacHex(secret: string, payload: Buffer | string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

export function hmacBase64(secret: string, payload: Buffer | string): string {
  // Microsoft Teams outgoing webhooks sign with a base64-decoded key.
  const key = Buffer.from(secret, "base64");
  return crypto.createHmac("sha256", key).update(payload).digest("base64");
}

/** Constant-time compare of two same-length strings; false on any mismatch. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}
