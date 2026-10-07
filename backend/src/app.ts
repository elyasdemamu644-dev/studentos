import express from "express";
import helmet from "helmet";
import cors from "cors";
import compression from "compression";

import { config } from "@/config";
import { apiRouter } from "@/routes";
import { requestLogger, notFoundHandler, globalErrorHandler } from "@/config/http";
import { apiRateLimiter } from "@/utils/rate-limit";
import { healthRouter } from "./routes/health";

const app = express();

// ─────────────────────────────────────────────
// Security & formatting middleware
// ─────────────────────────────────────────────

// Do not advertise the framework, and only trust X-Forwarded-* when the
// operator says a proxy is in front (TRUST_PROXY) — otherwise the rate
// limiter would bucket every client behind a proxy as one IP.
app.disable("x-powered-by");
app.set("trust proxy", config.trustProxy);

app.use(helmet());
app.use(
  cors({
    origin: config.corsOrigins,
    credentials: true,
  }),
);
app.use(compression());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

// ─────────────────────────────────────────────
// Request logging
// ─────────────────────────────────────────────

app.use(requestLogger);

// ─────────────────────────────────────────────
// Health check (no auth)
// ─────────────────────────────────────────────

app.use("/health", healthRouter);

// ─────────────────────────────────────────────
// API routes
// ─────────────────────────────────────────────
//
// Rate limiting sits in front of the API only — `/health` must stay
// reachable for orchestrators even when the API is under load. The
// middleware no-ops when config.isTest.

app.use("/api/v1", apiRateLimiter);
app.use("/api/v1", apiRouter);

// ─────────────────────────────────────────────
// Error handling
// ─────────────────────────────────────────────

app.use(notFoundHandler);
app.use(globalErrorHandler);

export { app };
