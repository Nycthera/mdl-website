import { supabase } from "@/app/backend/supabaseFunctions/supabaseClient";

export async function logInUser(
  email: string,
  password: string,
  rememberMe: boolean = true
) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) throw error;

  // If "keep me signed in" is OFF, switch to session-only persistence
  // (session clears when the browser tab is closed)
  if (!rememberMe) {
    await supabase.auth.updateUser({}); // keeps current session
    // Override storage to session-only
    await supabase.auth.setSession({
      access_token: data.session!.access_token,
      refresh_token: data.session!.refresh_token,
    });
  }

  return data.user;
}
