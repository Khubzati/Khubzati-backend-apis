import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function POST() {
    try {
        // Clear any auth cookies if they exist
        const cookieStore = cookies();
        cookieStore.delete('auth-token');

        return NextResponse.json({
            status: 'success',
            message: 'Logged out successfully'
        });

    } catch (error: any) {
        console.error('Logout error:', error);
        return NextResponse.json(
            {
                status: 'error',
                message: error.message || 'An error occurred during logout',
                details: error
            },
            { status: 500 }
        );
    }
} 