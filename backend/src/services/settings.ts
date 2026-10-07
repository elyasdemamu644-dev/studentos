import { prisma } from "@/utils/prisma";

// ─────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────

export const settingsService = {
  /** Return the user's settings as a flat key → value map. */
  async get(userId: string): Promise<Record<string, string>> {
    return loadSettings(userId);
  },

  /**
   * Apply a batch of setting updates. A null value deletes the key.
   * Returns the full settings map after the update.
   */
  async update(userId: string, updates: Record<string, string | null>) {
    await prisma.$transaction(
      Object.entries(updates).map(([key, value]) => {
        if (value === null) {
          return prisma.userSetting.deleteMany({ where: { userId, key } });
        }
        return prisma.userSetting.upsert({
          where: { userId_key: { userId, key } },
          create: { userId, key, value },
          update: { value },
        });
      }),
    );

    return loadSettings(userId);
  },
};

async function loadSettings(userId: string): Promise<Record<string, string>> {
  const rows = await prisma.userSetting.findMany({
    where: { userId },
    select: { key: true, value: true },
  });

  const settings: Record<string, string> = {};
  for (const row of rows) settings[row.key] = row.value;
  return settings;
}