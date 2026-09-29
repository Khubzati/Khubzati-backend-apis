import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

export async function middleware(request: NextRequest) {
    // Create an unmodified response
    let response = NextResponse.next({
        request: {
            headers: request.headers,
        },
    });

    // Check if Supabase environment variables are configured
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    // Only initialize Supabase if environment variables are present
    if (supabaseUrl && supabaseAnonKey) {
        try {
            const supabase = createServerClient(
                supabaseUrl,
                supabaseAnonKey,
                {
                    cookies: {
                        get(name: string) {
                            return request.cookies.get(name)?.value
                        },
                        set(name: string, value: string, options: CookieOptions) {
                            response.cookies.set({
                                name,
                                value,
                                ...options,
                            })
                        },
                        remove(name: string, options: CookieOptions) {
                            response.cookies.set({
                                name,
                                value: '',
                                ...options,
                                maxAge: 0
                            })
                        }
                    },
                },
            );

            // Refresh session if expired - required for Server Components
            await supabase.auth.getSession()
        } catch (error) {
            // Log error but don't block the request
            console.warn('Supabase middleware error:', error);
        }
    }

    return response
}

// Specify which routes this middleware should run on
export const config = {
    matcher: [
        /*
         * Match all request paths except for the ones starting with:
         * - _next/static (static files)
         * - _next/image (image optimization files)
         * - favicon.ico (favicon file)
         * Feel free to modify this pattern to include more paths.
         */
        '/((?!_next/static|_next/image|favicon.ico).*)',
    ],
} 