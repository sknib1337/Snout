import { Router } from "express";
import { config } from "../config";
import { verifySlack } from "../lib/slack";
import { assessApp } from "../agent";
import { store } from "../store";
import { readiness } from "../controls";
import { forChat } from "../security/sanitize";

export const slack = Router();

slack.post("/snout", async (req, res) => {
  if (!config.slackSigningSecret) return res.status(501).send("SLACK_SIGNING_SECRET not configured");
  if (!verifySlack(req)) return res.status(401).send("Bad signature");

  const appName = String(req.body.text || "").trim();
  const responseUrl = req.body.response_url as string;
  if (!appName) return res.json({ response_type: "ephemeral", text: "Usage: `/snout <app name>`" });

  // Acknowledge within 3s; deliver the result asynchronously.
  res.json({ response_type: "ephemeral", text: `Assessing *${appName}*… this takes ~30s.` });

  try {
    const a = await assessApp({ name: appName });
    await store.upsertByApp(a);
    await fetch(responseUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        response_type: "in_channel",
        blocks: [
          { type: "header", text: { type: "plain_text", text: `${a.app} — Trust ${a.score}/100 · ${readiness(a.score)}` } },
          { type: "section", text: { type: "mrkdwn", text: `*Verdict:* ${a.recommendation}\n${forChat(a.summary)}` } },
          { type: "actions", elements: [
            { type: "button", text: { type: "plain_text", text: "Open full report" }, url: `${config.appBaseUrl}/?a=${a.id}` },
          ] },
        ],
      }),
    });
  } catch (e: any) {
    await fetch(responseUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ response_type: "ephemeral", text: `Assessment failed: ${e.message}` }),
    });
  }
});
