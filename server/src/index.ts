import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { config, assertStartup } from "./config";
import { assessments } from "./routes/assessments";
import { webhooks } from "./routes/webhooks";
import { slack } from "./routes/slack";
import { teams } from "./routes/teams";

const app = express();

// Keep the raw body around for HMAC / signature verification.
const rawSaver = (req: Request, _res: Response, buf: Buffer) => { (req as any).rawBody = buf; };

app.use(helmet());
app.use(cors({ origin: config.webOrigin, credentials: true }));
app.use(morgan("tiny"));
app.use(express.json({ limit: "1mb", verify: rawSaver }));
app.use(express.urlencoded({ extended: true, verify: rawSaver }));

app.get("/health", (_req, res) => res.json({ ok: true, model: config.anthropicModel }));

// Optional bearer-token gate on the browser-facing API.
function apiAuth(req: Request, res: Response, next: NextFunction) {
  if (!config.apiToken) return next();
  if (req.header("authorization") === `Bearer ${config.apiToken}`) return next();
  return res.status(401).json({ error: "Unauthorized" });
}

app.use("/api", apiAuth, assessments);
app.use("/webhooks", webhooks);
app.use("/slack", slack);
app.use("/teams", teams);

assertStartup();
app.listen(config.port, () => console.log(`[trust-agent] server on :${config.port}`));
