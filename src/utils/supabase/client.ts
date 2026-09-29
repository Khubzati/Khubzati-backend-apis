import { createBrowserClient } from "@supabase/ssr";

export const createClient = () => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
        console.warn('Supabase env vars missing; skipping Supabase client init.');
        return null;
    }

    return createBrowserClient(
        supabaseUrl,
        supabaseAnonKey,
    );
};
