import { createClient } from "@/lib/supabase/client";

export async function signUp(
    email: string,
    password: string
) {
    email = email.trim().toLowerCase();

    if (!email) {
        throw new Error("Email is required");
    }

    if (email.length > 254) {
        throw new Error("Email is too long");
    }

    const emailRegex =
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailRegex.test(email)) {
        throw new Error("Invalid email address");
    }


    const supabase = createClient();

    const { data, error } =
        await supabase.auth.signUp({
            email,
            password,
        });

    if (error) {
        throw error;
    }

    return data;
}