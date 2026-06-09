import { supabase } from "@/app/backend/supabaseFunctions/supabaseClient"

export async function logInUser(email: string, password: string) {
    const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
    });

    if (error) {
        throw error;
    }

    return data.user;
}