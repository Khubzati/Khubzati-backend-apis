import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

type Cookie = {
    name: string;
    value: string;
    options?: CookieOptions;
};

export const createClient = (cookieStore: ReturnType<typeof cookies>) => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
        // In local/dev without Supabase configured, return null so callers can skip
        console.warn('Supabase env vars missing; skipping Supabase client init.');
        return null;
    }

    return createServerClient(
        supabaseUrl,
        supabaseAnonKey,
        {
            cookies: {
                get(name: string) {
                    return cookieStore.get(name)?.value
                },
                set(name: string, value: string, options: CookieOptions) {
                    cookieStore.set(name, value, options)
                },
                remove(name: string, options: CookieOptions) {
                    cookieStore.set(name, '', { ...options, maxAge: 0 })
                }
            },
        },
    );
};
