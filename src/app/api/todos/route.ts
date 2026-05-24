import { NextResponse } from 'next/server'

// Demo disabled: return 404 for all Todo routes
export async function GET() {
    return NextResponse.json(
        { error: 'Supabase demo disabled' },
        { status: 404 }
    )
}

export async function POST() {
    return NextResponse.json(
        { error: 'Supabase demo disabled' },
        { status: 404 }
    )
}
