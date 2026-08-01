import { describe, expect, it } from "vitest";

import { DEFAULT_APP_PREFERENCES, resolvePreferences } from "@/lib/preferences";

describe("resolvePreferences", () => {
  it("returns the default preferences when no stored values exist", () => {
    expect(resolvePreferences(null)).toEqual(DEFAULT_APP_PREFERENCES);
  });

  it("merges stored overrides over the defaults", () => {
    const resolved = resolvePreferences({
      defaultSource: "mangadex",
      notifyOnFailedJobs: false,
    });

    expect(resolved.defaultSource).toBe("mangadex");
    expect(resolved.notifyOnFailedJobs).toBe(false);
    expect(resolved.autoCheckFrequency).toBe(
      DEFAULT_APP_PREFERENCES.autoCheckFrequency,
    );
  });
});
