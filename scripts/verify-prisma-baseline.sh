#!/usr/bin/env bash
set -euo pipefail

# Verifies the Prisma baseline migration against the dev and test databases.
# Run from anywhere: paths are resolved relative to this script.

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT/apps/api"

echo "========================================="
echo "  StudentOS — Prisma baseline verification"
echo "========================================="
echo ""

echo "1. Prisma validate (schema integrity)..."
npx prisma validate
echo "   OK"
echo ""

echo "2. Migration directory structure..."
ls -la prisma/migrations/
echo ""

echo "3. migration_lock.toml..."
cat prisma/migrations/20260926004652_baseline/migration_lock.toml
echo ""

echo "4. Table count (dev database)..."
psql -U postgres -d studentos -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public'"
echo ""

echo "5. Table count (test database)..."
psql -U postgres -d studentos_test -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public'"
echo ""

echo "========================================="
echo "  Baseline verification complete"
echo "========================================="
