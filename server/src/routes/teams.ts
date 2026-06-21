import { Router } from "express";
import { config } from "../config";
import { hmacBase64, safeEqual } from "../lib/hmac";
import { assessApp } from "../agent";
import { store } from "../store";
import { readiness } from "../controls";
import { forChat } from "../security/sanitize";

export const teams = Router();

function card(title: string, lines: string[], url?: string) {
  return {
    type: "message",
    attachments: [{
      contentType: "application/vnd.microsoft.card.adaptive",
      content: {
        type: "AdaptiveCard", version: "1.4",
        body: [
          { type: "TextBlock", size: "Large", weight: "Bolder", text: title },
          ...lines.map((t) => ({ type: "TextBlock", wrap: true, text: t })),
        ],
        ...(url ? { actions: [{ type: "Action.OpenUrl", title: "Open full report", url }] } : {}),
      },
    }],
  };
}

teams.post("/snout", async (req, res) => {
  if (!config.teamsSecurityToken) return res.status(501).json({ text: "TEAMS_SECURITY_TOKEN not configured" });

  // Teams outgoing webhooks sign the body: Authorization: HMAC <base64>.
  const auth = (req.header("authorization") || "").replace(/^HMAC\s+/i, "");
  const raw = (req as any).rawBody as Buffer | undefined;
  if (!raw || !safeEqual(auth, hmacBase64(config.teamsSecurityToken, raw))) {
    return res.status(401).json(card("Unauthorized", ["Signature check failed."]));
  }

  const text = String(req.body.text || "").replace(/<at>.*?<\/at>/g, "").trim();
  const appName = text.replace(/^assess\s+/i, "").trim();
  if (!appName) return res.json(card("Snout", ["Mention me with: `assess <app name>`"]));

  // Teams expects a reply within ~5s. If we have a recent assessment, return it now.
  const existing = (await store.list()).find((a) => a.app.toLowerCase() === appName.toLowerCase());
  if (existing) {
    return res.json(card(
      `${existing.app} — Trust ${existing.score}/100 · ${readiness(existing.score)}`,
      [`Verdict: ${existing.recommendation}`, forChat(existing.summary)],
      `${config.appBaseUrl}/?a=${existing.id}`,
    ));
  }

  // Otherwise kick it off and tell the user to check back. For a true async
  // reply, upgrade this route to a Bot Framework bot and post a proactive
  // message using the saved conversation reference (see README).
  assessApp({ name: appName }).then((a) => store.upsertByApp(a)).catch((e) => console.error("[teams]", e.message));
  res.json(card("Assessment started", [`Researching ${forChat(appName, 120)} — open Snout in ~30s for the full report.`], config.appBaseUrl));
});
