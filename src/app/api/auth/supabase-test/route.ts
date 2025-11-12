import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

export async function POST(request: Request) {
    try {
        const { email, password, phoneNumber, fullName } = await request.json();

        // First, sign up the user
        const { data: authData, error: authError } = await supabase.auth.signUp({
            email,
            password,
            phone: phoneNumber,
            options: {
                data: {
                    full_name: fullName,
                }
            }
        });

        if (authError) {
            return NextResponse.json({
                status: 'error',
                message: authError.message
            }, { status: 400 });
        }

        // If signup successful, create user profile in the users table
        if (authData.user) {
            const { error: profileError } = await supabase
                .from('users')
                .insert([
                    {
                        id: authData.user.id,
                        email: email,
                        phone_number: phoneNumber,
                        full_name: fullName,
                        role: 'customer'
                    }
                ]);

            if (profileError) {
                return NextResponse.json({
                    status: 'error',
                    message: profileError.message
                }, { status: 400 });
            }
        }

        return NextResponse.json({
            status: 'success',
            data: authData
        }, { status: 201 });

    } catch (error: any) {
        console.error('Registration error:', error);
        return NextResponse.json({
            status: 'error',
            message: error.message || 'An error occurred during registration'
        }, { status: 500 });
    }
} 