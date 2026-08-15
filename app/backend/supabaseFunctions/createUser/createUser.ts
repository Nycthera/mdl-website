// app/backend/supabaseFunctions/createUser/createUser.ts
//
// Browser-side Supabase signup. Wraps supabase.auth.signUp() and
// surfaces enough info for the register page to react to the
// "email confirmation required" case — which is the most common
// reason signup appears to "silently fail" in production.
//
// PROBLEM this fixes:
//   Supabase projects default to "Confirm email = ON" in production
//   (but OFF in the local Supabase CLI). When email confirmation is
//   required, `signUp()` creates the user but does NOT establish a
//   session — `data.session` is null. The register page used to
//   immediately call signIn("credentials") right after, which would
//   fail with "Email not confirmed" from signInWithPassword(). The
//   register page then silently redirected to /login with zero
//   feedback, leaving the user thinking the signup had broken.
//
// By returning `emailConfirmationRequired` explicitly, the register
// page can show a clear "check your inbox" message instead of a
// silent bounce.
import { supabase } from "@/app/backend/supabaseFunctions/supabaseClient";
import { DEFAULT_APP_PREFERENCES } from "@/lib/preferences";

export interface RegisterResult {
  /** The created Supabase user object. */
  user: {
    id: string;
    email: string | null;
  };
  /**
   * True when Supabase created the user but did NOT establish a
   * session — i.e. the project requires email confirmation before
   * login is allowed. The register page uses this to decide whether
   * to attempt an auto-sign-in or to redirect to /login with a
   * "check your inbox" message.
   */
  emailConfirmationRequired: boolean;
}

export async function registerUser(
  email: string,
  password: string,
  username: string,
): Promise<RegisterResult> {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        username,
        // Seed preferences at signup so user_metadata.preferences is a
        // real object from the start instead of null until the user's
        // first PATCH to /api/v1/preferences. resolvePreferences() would
        // paper over the null either way, but this keeps the stored row
        // consistent with what the API actually returns.
        preferences: DEFAULT_APP_PREFERENCES,
      },
      // Override the confirmation link so it points to the current
      // deployment origin (e.g. https://mdl-website-kappa.vercel.app)
      // instead of the Supabase dashboard's Site URL (which is
      // typically http://localhost:3000). Without this, users on
      // Vercel get a broken localhost confirmation link.
      emailRedirectTo: `${window.location.origin}/login`,
    },
  });

  if (error) throw new Error(error.message);
  if (!data.user) throw new Error("Failed to create account");

  // When Supabase returns a user but no session, it means email
  // confirmation is required. This is the production default — local
  // Supabase CLI turns it off, which is why signup→login works
  // locally but silently fails on Vercel.
  return {
    user: {
      id: data.user.id,
      email: data.user.email ?? null,
    },
    emailConfirmationRequired: !data.session,
  };
}
