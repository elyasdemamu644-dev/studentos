-- Migration: Add unified AI model routing, capability metadata, health and usage
-- Created: 2026-10-20
--
-- Purely additive. Existing ai_connections / user_settings rows are untouched.
-- Introduces the shared routing architecture: one routing policy per user, the
-- ordered model preferences (global + per-conversation), capability + evidence
-- metadata, bounded provider health samples, and per-turn usage/cost telemetry.

-- ── Enums ───────────────────────────────────────────────────────────────────

CREATE TYPE "AiRoutingStrategy" AS ENUM (
    'FIXED',
    'AUTO'
);

CREATE TYPE "AiModelCapabilityKind" AS ENUM (
    'TEXT',
    'VISION',
    'TOOLS',
    'STRUCTURED_OUTPUT',
    'LONG_CONTEXT',
    'REASONING'
);

CREATE TYPE "AiCapabilityEvidence" AS ENUM (
    'VERIFIED',
    'PROVIDER_REPORTED',
    'USER_CONFIGURED',
    'UNKNOWN'
);

CREATE TYPE "AiHealthStatus" AS ENUM (
    'HEALTHY',
    'DEGRADED',
    'UNHEALTHY',
    'UNKNOWN'
);

CREATE TYPE "AiModelPreferenceScope" AS ENUM (
    'GLOBAL',
    'CONVERSATION'
);

-- ── 1. ai_routing_policies ──────────────────────────────────────────────────

CREATE TABLE "ai_routing_policies" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "strategy" "AiRoutingStrategy" NOT NULL DEFAULT 'AUTO',
    "fixedConnectionId" TEXT,
    "fixedModel" TEXT,
    "freeOnly" BOOLEAN NOT NULL DEFAULT false,
    "spendCeilingCents" INTEGER,
    "spendWindowDays" INTEGER NOT NULL DEFAULT 30,
    "allowAutoFallback" BOOLEAN NOT NULL DEFAULT true,
    "externalProcessingDisabled" BOOLEAN NOT NULL DEFAULT false,
    "preset" TEXT,
    "fallbackOrder" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_routing_policies_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ai_routing_policies_userId_key" ON "ai_routing_policies"("userId");

ALTER TABLE "ai_routing_policies"
    ADD CONSTRAINT "ai_routing_policies_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── 2. ai_model_preferences ─────────────────────────────────────────────────

CREATE TABLE "ai_model_preferences" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scope" "AiModelPreferenceScope" NOT NULL DEFAULT 'GLOBAL',
    "conversationId" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "connectionId" TEXT,
    "priority" INTEGER,
    "allowed" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_model_preferences_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ai_model_preferences_userId_scope_conversationId_provider_model_key"
    ON "ai_model_preferences"("userId", "scope", "conversationId", "provider", "model");
CREATE INDEX "ai_model_preferences_userId_scope_idx" ON "ai_model_preferences"("userId", "scope");
CREATE INDEX "ai_model_preferences_userId_conversationId_idx" ON "ai_model_preferences"("userId", "conversationId");

ALTER TABLE "ai_model_preferences"
    ADD CONSTRAINT "ai_model_preferences_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── 3. ai_model_capabilities ────────────────────────────────────────────────

CREATE TABLE "ai_model_capabilities" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "connectionId" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "kind" "AiModelCapabilityKind" NOT NULL,
    "evidence" "AiCapabilityEvidence" NOT NULL DEFAULT 'UNKNOWN',
    "note" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_model_capabilities_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ai_model_capabilities_userId_connectionId_provider_model_kind_key"
    ON "ai_model_capabilities"("userId", "connectionId", "provider", "model", "kind");
CREATE INDEX "ai_model_capabilities_provider_model_idx" ON "ai_model_capabilities"("provider", "model");
CREATE INDEX "ai_model_capabilities_userId_idx" ON "ai_model_capabilities"("userId");

ALTER TABLE "ai_model_capabilities"
    ADD CONSTRAINT "ai_model_capabilities_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── 4. ai_provider_health ───────────────────────────────────────────────────

CREATE TABLE "ai_provider_health" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" "AiHealthStatus" NOT NULL DEFAULT 'UNKNOWN',
    "latencyMs" INTEGER,
    "message" TEXT,
    "code" TEXT,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT now(),

    CONSTRAINT "ai_provider_health_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ai_provider_health_userId_connectionId_checkedAt_idx"
    ON "ai_provider_health"("userId", "connectionId", "checkedAt");
CREATE INDEX "ai_provider_health_connectionId_checkedAt_idx"
    ON "ai_provider_health"("connectionId", "checkedAt");

-- ── 5. ai_usage_records ─────────────────────────────────────────────────────

CREATE TABLE "ai_usage_records" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT,
    "connectionId" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "feature" TEXT NOT NULL DEFAULT 'chat',
    "promptTokens" INTEGER NOT NULL DEFAULT 0,
    "completionTokens" INTEGER NOT NULL DEFAULT 0,
    "totalTokens" INTEGER NOT NULL DEFAULT 0,
    "costCents" INTEGER,
    "estimated" BOOLEAN NOT NULL DEFAULT false,
    "free" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(),

    CONSTRAINT "ai_usage_records_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ai_usage_records_userId_createdAt_idx" ON "ai_usage_records"("userId", "createdAt");
CREATE INDEX "ai_usage_records_userId_provider_model_idx" ON "ai_usage_records"("userId", "provider", "model");
CREATE INDEX "ai_usage_records_conversationId_idx" ON "ai_usage_records"("conversationId");

ALTER TABLE "ai_usage_records"
    ADD CONSTRAINT "ai_usage_records_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
