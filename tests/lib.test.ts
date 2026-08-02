// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

const { animateMock, staggerMock, getServerSessionMock } = vi.hoisted(() => ({
  animateMock: vi.fn(),
  staggerMock: vi.fn((ms: number, options: { start: number }) => ({
    ms,
    start: options.start,
  })),
  getServerSessionMock: vi.fn(),
}));

vi.mock("animejs", () => ({
  animate: animateMock,
  stagger: staggerMock,
}));

vi.mock("next-auth", () => ({
  getServerSession: getServerSessionMock,
}));

vi.mock("@/lib/auth", () => ({
  authOptions: { secret: "test-secret" },
}));

import { cn } from "@/lib/utils";
import { popIn, revealIn, shake } from "@/lib/animations";
import { getSessionUserId } from "@/lib/get-session";

describe("lib utility helpers", () => {
  beforeEach(() => {
    animateMock.mockReset();
    staggerMock.mockClear();
    getServerSessionMock.mockReset();
    document.body.innerHTML =
      '<div class="item">one</div><div class="item">two</div>';
  });

  it("merges class names with tailwind utilities", () => {
    expect(cn("px-2", "bg-red-500", "px-4", "text-sm")).toBe(
      "bg-red-500 px-4 text-sm",
    );
  });

  it("animates elements in with reveal options", () => {
    revealIn(".item", { duration: 900, delay: 12, staggerMs: 3, y: 15 });

    expect(animateMock).toHaveBeenCalledTimes(1);
    const [targets, options] = animateMock.mock.calls[0];
    expect(targets).toBeInstanceOf(NodeList);
    expect(options).toMatchObject({
      opacity: [0, 1],
      translateY: [15, 0],
      duration: 900,
      ease: "outExpo",
    });
    expect(options.delay).toEqual({ ms: 3, start: 12 });
  });

  it("animates elements in with a pop effect", () => {
    popIn(".item", { duration: 400, delay: 5, staggerMs: 2 });

    expect(animateMock).toHaveBeenCalledTimes(1);
    const [, options] = animateMock.mock.calls[0];
    expect(options).toMatchObject({
      opacity: [0, 1],
      scale: [0.9, 1],
      duration: 400,
      ease: "outBack",
    });
    expect(options.delay).toEqual({ ms: 2, start: 5 });
  });

  it("animates elements with a shake effect", () => {
    shake(".item", { duration: 300, delay: 8 });

    expect(animateMock).toHaveBeenCalledTimes(1);
    const [, options] = animateMock.mock.calls[0];
    expect(options).toMatchObject({
      translateX: [0, -8, 8, -6, 6, -3, 3, 0],
      duration: 300,
      delay: 8,
      ease: "outQuad",
    });
  });

  it("returns null for missing or invalid session ids", async () => {
    getServerSessionMock.mockResolvedValueOnce(null);
    await expect(getSessionUserId()).resolves.toBeNull();

    getServerSessionMock.mockResolvedValueOnce({ user: { id: "not-a-uuid" } });
    await expect(getSessionUserId()).resolves.toBeNull();
  });

  it("returns the validated session user id", async () => {
    getServerSessionMock.mockResolvedValueOnce({
      user: { id: "123e4567-e89b-12d3-a456-426614174000" },
    });

    await expect(getSessionUserId()).resolves.toBe(
      "123e4567-e89b-12d3-a456-426614174000",
    );
  });
});
