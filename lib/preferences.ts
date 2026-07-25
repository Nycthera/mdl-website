// lib/preferences.ts
//
// "App behavior" preferences — the things that affect how the dashboard
// behaves, as opposed to account fields (username/email/password) or pure
// client-side cosmetics (theme/density, which live in localStorage instead —
// see components/providers/density-provider.tsx).
//
// Stored in Supabase auth's `user_metadata.preferences` (a jsonb blob on the
// user, not a separate table) since there's no per-user settings table in
// this project yet, and these values are small and read alongside the user
// object we already fetch on sign-in.

export type DefaultSource = "mangadex" | "weebcentral" | "manual" | "auto";

export type AutoCheckFrequency = "off" | "daily" | "twice_daily" | "hourly";

export interface AppPreferences {
  defaultSource: DefaultSource;
  autoCheckFrequency: AutoCheckFrequency;
  notifyOnNewChapters: boolean;
  notifyOnFailedJobs: boolean;
}

export const DEFAULT_APP_PREFERENCES: AppPreferences = {
  defaultSource: "auto",
  autoCheckFrequency: "daily",
  notifyOnNewChapters: true,
  notifyOnFailedJobs: true,
};

/** Merges stored user_metadata.preferences over the defaults, so a user
 *  created before a new preference field existed doesn't end up with
 *  `undefined` for it. */
export function resolvePreferences(
  stored: Partial<AppPreferences> | null | undefined,
): AppPreferences {
  return {
    ...DEFAULT_APP_PREFERENCES,
    ...(stored ?? {}),
  };
}
