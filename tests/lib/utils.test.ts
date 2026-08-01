import { describe, expect, it } from "vitest";

import { cn } from "@/lib/utils";

describe("cn", () => {
  it("merges conflicting Tailwind classes by keeping the last one", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });

  it("includes non-conflicting classes", () => {
    expect(cn("rounded", "bg-red-500", "text-white")).toContain("rounded");
    expect(cn("rounded", "bg-red-500", "text-white")).toContain("bg-red-500");
  });
});
