import { beforeEach, describe, expect, it, vi } from "vitest";

const setUserMock = vi.fn();
const createClientMock = vi.fn();
const createAdminClientMock = vi.fn();
const credentialsProviderMock = vi.fn((config: unknown) => ({ type: "credentials", config }));
const githubProviderMock = vi.fn((config: unknown) => ({ type: "github", config }));

vi.mock("@sentry/nextjs", () => ({
  setUser: setUserMock,
}));

vi.mock("next-auth/providers/credentials", () => ({
  default: credentialsProviderMock,
}));

vi.mock("next-auth/providers/github", () => ({
  default: githubProviderMock,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: createClientMock,
  createAdminClient: createAdminClientMock,
}));

describe("auth helpers", () => {
  beforeEach(() => {
    vi.resetModules();
    setUserMock.mockReset();
    createClientMock.mockReset();
    createAdminClientMock.mockReset();
    credentialsProviderMock.mockReset();
    githubProviderMock.mockReset();
    vi.unstubAllEnvs();
    vi.stubEnv("NODE_ENV", "test");
  });

  it("returns the configured next-auth secret", async () => {
    process.env.NEXTAUTH_SECRET = "sup3r-s3cr3t";

    const { getNextAuthSecret } = await import("@/lib/auth");

    expect(getNextAuthSecret()).toBe("sup3r-s3cr3t");
  });

  it("stores the resolved user in the jwt and session callbacks", async () => {
    const { authOptions } = await import("@/lib/auth");

    const token = {} as Record<string, unknown>;
    await authOptions.callbacks?.jwt?.({
      token,
      user: { id: "user-123", email: "user@example.com", name: "User" },
    } as never);

    expect(token).toMatchObject({ id: "user-123" });
    expect(setUserMock).toHaveBeenCalledWith({
      id: "user-123",
      email: "user@example.com",
      username: "User",
    });

    const session = { user: { name: "User", email: "user@example.com" } };
    const result = await authOptions.callbacks?.session?.({
      session: session as never,
      token: { id: "user-123", email: "user@example.com", name: "User" },
    } as never);

    expect(result).toMatchObject({ user: { id: "user-123" } });
    expect(setUserMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        id: "user-123",
        email: "user@example.com",
      }),
    );
    expect(setUserMock.mock.calls[1]?.[0]).toMatchObject({ username: "User" });
  });

  it("uses an existing Supabase auth user for github sign in", async () => {
    createAdminClientMock.mockReturnValue({
      auth: {
        admin: {
          listUsers: vi.fn().mockResolvedValue({
            data: { users: [{ id: "supabase-123", email: "person@example.com" }] },
            error: null,
          }),
        },
      },
    });

    const { authOptions } = await import("@/lib/auth");
    const result = await authOptions.callbacks?.signIn?.({
      user: { email: "person@example.com", name: "Person" },
      account: { provider: "github" },
    } as never);

    expect(result).toBe(true);
    expect(createAdminClientMock).toHaveBeenCalledTimes(1);
  });

  it("creates a new Supabase auth user when github sign in has no match", async () => {
    createAdminClientMock.mockReturnValue({
      auth: {
        admin: {
          listUsers: vi.fn().mockResolvedValue({
            data: { users: [] },
            error: null,
          }),
          createUser: vi.fn().mockResolvedValue({
            data: { user: { id: "created-123" } },
            error: null,
          }),
        },
      },
    });

    const { authOptions } = await import("@/lib/auth");
    const user = { email: "new@example.com", name: "New User" } as {
      email: string;
      name: string;
      id?: string;
    };
    const result = await authOptions.callbacks?.signIn?.({
      user,
      account: { provider: "github" },
    } as never);

    expect(result).toBe(true);
    expect(user.id).toBe("created-123");
  });
});
