import { createClient } from "@/lib/supabase/client";

export async function logInUser(
    email: string,
    password: string
) {
    const supabase = createClient();

    const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password
    });

    if (error) {
        throw error;
    }

    return data;
}