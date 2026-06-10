import { supabase } from "@/app/backend/supabaseFunctions/supabaseClient"

export async function registerUser(
  email: string,
  password: string,
  username: string
) {

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        username,
      },
    },
  });

  if (error) throw new Error(error.message);
  if (!data.user) throw new Error("Failed to create account");

  return data.user;
}