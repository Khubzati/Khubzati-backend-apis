import { createClient } from '@/utils/supabase/server'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

// GET /api/todos - Get all todos
export async function GET() {
    try {
        const cookieStore = cookies()
        const supabase = await createClient(cookieStore)

        const { data: todos, error } = await supabase
            .from('todos')
            .select('*')
            .order('created_at', { ascending: false })

        if (error) throw error

        return NextResponse.json(todos)
    } catch (error) {
        console.error('Error fetching todos:', error)
        return NextResponse.json(
            { error: 'Failed to fetch todos' },
            { status: 500 }
        )
    }
}

// POST /api/todos - Create a new todo
export async function POST(request: Request) {
    try {
        const cookieStore = cookies()
        const supabase = await createClient(cookieStore)

        // Check if user is authenticated
        const { data: { user }, error: authError } = await supabase.auth.getUser()
        if (authError || !user) {
            return NextResponse.json(
                { error: 'Unauthorized' },
                { status: 401 }
            )
        }

        const { title, completed = false } = await request.json()

        if (!title) {
            return NextResponse.json(
                { error: 'Title is required' },
                { status: 400 }
            )
        }

        const { data: todo, error } = await supabase
            .from('todos')
            .insert([
                {
                    title,
                    completed,
                    user_id: user.id
                }
            ])
            .select()
            .single()

        if (error) throw error

        return NextResponse.json(todo)
    } catch (error) {
        console.error('Error creating todo:', error)
        return NextResponse.json(
            { error: 'Failed to create todo' },
            { status: 500 }
        )
    }
} 