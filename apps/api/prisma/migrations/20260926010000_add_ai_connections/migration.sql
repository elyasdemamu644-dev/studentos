-- CreateTable
CREATE TABLE "ai_connections" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "user_id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "model" TEXT,
  "endpoint" TEXT,
  "credentials_encrypted" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "is_active" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ai_connections_userId_provider_key" UNIQUE ("user_id", "provider")
);

-- AddForeignKey
ALTER TABLE "ai_connections" ADD CONSTRAINT "ai_connections_userId_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
