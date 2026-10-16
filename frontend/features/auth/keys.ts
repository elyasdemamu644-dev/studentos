/**
 * React Query cache keys for authentication.
 *
 * Kept in its own module (no React/Next imports) so any feature can write to
 * the session-user cache entry without importing the provider. Profile
 * mutations previously used a lookalike key (`["auth", "user"]`), so the
 * updated user never reached the UI that reads `ME_KEY`.
 */
export const ME_KEY = ["auth", "me"] as const;
