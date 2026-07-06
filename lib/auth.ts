import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GitHubProvider from "next-auth/providers/github";
import { createClient } from "@/lib/supabase/server";

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
      }
      return token;
    },
    // Called whenever a session is checked — expose JWT fields to the client
    async session({ session, token }) {
      if (session.user && token.id) {
        session.user.id = token.id as string;
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

  secret: process.env.NEXTAUTH_SECRET,
};
