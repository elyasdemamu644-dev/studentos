import express from "express";
import helmet from "helmet";
import cors from "cors";
import compression from "compression";

import { config } from "@/config";
import { apiRouter } from "@/routes";
import { requestLogger, notFoundHandler, globalErrorHandler } from "@/config/http";
import { healthRouter } from "./modules/health/routes";

const app = express();

// ─────────────────────────────────────────────
// Security & formatting middleware
// ─────────────────────────────────────────────

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

app.use("/api/v1", apiRouter);

// ─────────────────────────────────────────────
// Error handling
// ─────────────────────────────────────────────

app.use(notFoundHandler);
app.use(globalErrorHandler);

export { app };
