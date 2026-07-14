import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GitHubProvider from "next-auth/providers/github";
import * as Sentry from "@sentry/nextjs";
import { createClient } from "@/lib/supabase/server";

/**
 * Pushes the authenticated user into Sentry's current scope so every
 * server-side error captured during this request is tagged with who
 * triggered it.
 *
 * Called from the `jwt` callback after we've definitively resolved the
 * user id (post-GitHub-user-upsert, post-Credentials-sign-in). We only
 * set id + email + username — never the access token or anything that
 * could leak credentials. PII stays minimal: id is a Supabase UUID
 * (opaque), email is already in Sentry's allowlist of standard user
 * fields, and `username` is the user's chosen display name.
 *
 * Note: the `jwt` callback runs on every authenticated request, not
 * just at sign-in. `Sentry.setUser` is idempotent and cheap, so calling
 * it every time is fine — and necessary, because the Sentry scope is
 * per-request on the server (Vercel reuses the isolate but the scope
 * resets between requests via Next.js's request scope handling).
 */
function setSentryUser(user: {
  id?: string | null;
  email?: string | null;
  name?: string | null;
}) {
  if (!user.id) return;
  Sentry.setUser({
    id: user.id,
    email: user.email ?? undefined,
    username: user.name ?? undefined,
  });
}

/**
 * Resolves the NextAuth secret from the environment.
 *
 * Tries `NEXTAUTH_SECRET` (NextAuth v4 convention) first, then
 * `AUTH_SECRET` (v5 convention) — so the same env var works whether you're
 * on v4 or v5. Throws a clear, actionable error at startup if neither is
 * set in production.
 *
 * This exists because silently passing `undefined` as the secret makes
 * NextAuth throw `MissingSecretError` on every auth request, which shows
 * up as a flood of identical 500s in the Vercel logs and is much harder
 * to diagnose than a single startup-time error. The "Please define a
 * `secret` in production" message NextAuth prints is technically
 * accurate but doesn't tell you *how* — this error does.
 */
function resolveNextAuthSecret(): string {
  const secret = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET;

  if (secret) return secret;

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "NEXTAUTH_SECRET (or AUTH_SECRET) is not set. " +
        "Generate one with `openssl rand -base64 32` and add it as an " +
        "environment variable in your Vercel project settings " +
        "(Settings → Environment Variables → Production). " +
        "See https://next-auth.js.org/configuration/options#secret.",
    );
  }

  // In development NextAuth auto-generates a secret if none is provided,
  // so returning an empty string here is fine — it'll never reach the
  // config object because assertConfig only enforces it in production.
  return "";
}

const NEXTAUTH_SECRET = resolveNextAuthSecret();

/** Exported for other modules (e.g. proxy.ts's getToken call) so the
 *  secret is resolved once at module load and shared — re-resolving per
 *  request would re-throw the startup error on every request. */
export function getNextAuthSecret(): string {
  return NEXTAUTH_SECRET;
}

/** Supabase admin's `listUsers` only supports pagination — there's no
 *  server-side "filter by email" option (unlike what the old code
 *  assumed). So finding a user by email means paging through results
 *  ourselves and matching case-insensitively. */
async function findSupabaseUserByEmail(
  supabase: ReturnType<
    typeof import("@/lib/supabase/server").createAdminClient
  >,
  email: string,
): Promise<{ id: string } | null> {
  const target = email.toLowerCase();
  const perPage = 200;

  for (let page = 1; ; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage,
    });
    if (error) throw error;

    const match = data.users.find((u) => u.email?.toLowerCase() === target);
    if (match) return { id: match.id };

    if (data.users.length < perPage) return null; // last page, no match
  }
}

export const authOptions: NextAuthOptions = {
  providers: [
    // ── Email/Password via Supabase ──────────────────────────────────
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const supabase = await createClient();

        const { data, error } = await supabase.auth.signInWithPassword({
          email: credentials.email,
          password: credentials.password,
        });

        if (error || !data.user) return null;

        // Return a shape that NextAuth expects
        return {
          id: data.user.id,
          email: data.user.email,
          name:
            data.user.user_metadata?.username ?? data.user.email?.split("@")[0],
          image: data.user.user_metadata?.avatar_url,
        };
      },
    }),

    // ── GitHub OAuth ─────────────────────────────────────────────────
    GitHubProvider({
      clientId: process.env.GITHUB_ID ?? "",
      clientSecret: process.env.GITHUB_SECRET ?? "",
    }),
  ],

  callbacks: {
    // Called when a user signs in — upsert into Supabase for GitHub users
    async signIn({ user, account }) {
      if (account?.provider === "github" && user.email) {
        const { createAdminClient } = await import("@/lib/supabase/server");
        const supabase = createAdminClient();

        // Check if the user already exists in Supabase Auth
        const existing = await findSupabaseUserByEmail(supabase, user.email);

        if (existing) {
          // IMPORTANT: overwrite NextAuth's `user.id`. For GitHub, that id
          // is GitHub's own numeric profile id (e.g. "94730074"), not a
          // Supabase UUID. The jwt() callback below copies user.id onto
          // the session token, and every API route (and download_history,
          // a `uuid` column) expects that to be the real Supabase user id.
          user.id = existing.id;
        } else {
          // User doesn't exist — create them via admin API so they appear in Supabase
          const { data: created, error: createErr } =
            await supabase.auth.admin.createUser({
              email: user.email!,
              password: crypto.randomUUID(), // random password (they'll use GitHub to log in)
              email_confirm: true,
              user_metadata: {
                username: user.name ?? user.email!.split("@")[0],
                avatar_url: user.image,
                provider: "github",
              },
            });

          if (createErr || !created?.user) {
            // Don't let a numeric GitHub id silently leak through as the
            // session's user id — fail the sign-in instead.
            return false;
          }

          user.id = created.user.id;
        }
      }
      return true; // allow sign-in to proceed
    },

    // Called after a user signs in — attach extra fields to the JWT
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        // Tag every server-side Sentry event with the now-known user.
        // Runs once at sign-in; subsequent requests re-derive the user
        // from the token in `session` below.
        setSentryUser(user);
      }
      return token;
    },
    // Called whenever a session is checked — expose JWT fields to the client
    async session({ session, token }) {
      if (session.user && token.id) {
        session.user.id = token.id as string;
        // Re-tag the Sentry scope on every session read. The jwt()
        // callback only sets the user once at sign-in, but the Sentry
        // scope resets between requests on the server — so without
        // this, errors raised on a return visit (cookie-based session,
        // no fresh sign-in) wouldn't be user-tagged.
        setSentryUser({
          id: token.id as string,
          email: session.user.email ?? token.email,
          name: session.user.name ?? token.name,
        });
      }
      return session;
    },
  },

  session: {
    strategy: "jwt",
  },

  pages: {
    signIn: "/login",
  },

  secret: NEXTAUTH_SECRET,
};
