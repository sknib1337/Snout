import express, { Request, Response } from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { config, assertStartup } from "./config";
import { assessments } from "./routes/assessments";
import { webhooks } from "./routes/webhooks";
import { slack } from "./routes/slack";
import { teams } from "./routes/teams";
import { apiAuth } from "./security/auth";
import { apiLimiter, webhookLimiter } from "./security/limits";
import { requestId, notFound, errorHandler } from "./security/errors";

const app = express();

// Accurate client IPs for rate limiting when behind a proxy/ingress.
app.set("trust proxy", config.trustProxy);

// Keep the raw body for HMAC / signature verification.
const rawSaver = (req: Request, _res: Response, buf: Buffer) => { (req as any).rawBody = buf; };

app.use(requestId);
app.use(helmet());            // sane security headers; CSP for the SPA is set in nginx
app.disable("x-powered-by");
app.use(cors({ origin: config.webOrigin, credentials: true }));
app.use(morgan("tiny"));
app.use(express.json({ limit: config.bodyLimit, verify: rawSaver }));
app.use(express.urlencoded({ extended: true, limit: config.bodyLimit, verify: rawSaver }));

app.get("/health", (_req, res) => res.json({ ok: true, model: config.anthropicModel }));

app.use("/api", apiLimiter, apiAuth, assessments);
app.use("/webhooks", webhookLimiter, webhooks);
app.use("/slack", webhookLimiter, slack);
app.use("/teams", webhookLimiter, teams);

app.use(notFound);
app.use(errorHandler);

assertStartup();
app.listen(config.port, () => console.log(`[trust-agent] server on :${config.port} (${config.env})`));
