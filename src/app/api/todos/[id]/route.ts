import { createClient } from '@/utils/supabase/server'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

// GET /api/todos/[id] - Get a specific todo
export async function GET(
    request: Request,
    { params }: { params: { id: string } }
) {
    try {
        const cookieStore = cookies()
        const supabase = await createClient(cookieStore)

        const { data: todo, error } = await supabase
            .from('todos')
            .select('*')
            .eq('id', params.id)
            .single()

        if (error) throw error

        if (!todo) {
            return NextResponse.json(
                { error: 'Todo not found' },
                { status: 404 }
            )
        }

        return NextResponse.json(todo)
    } catch (error) {
        console.error('Error fetching todo:', error)
        return NextResponse.json(
            { error: 'Failed to fetch todo' },
            { status: 500 }
        )
    }
}

// PUT /api/todos/[id] - Update a todo
export async function PUT(
    request: Request,
    { params }: { params: { id: string } }
) {
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

        const { title, completed } = await request.json()

        // Verify todo ownership
        const { data: existingTodo, error: fetchError } = await supabase
            .from('todos')
            .select('user_id')
            .eq('id', params.id)
            .single()

        if (fetchError || !existingTodo) {
            return NextResponse.json(
                { error: 'Todo not found' },
                { status: 404 }
            )
        }

        if (existingTodo.user_id !== user.id) {
            return NextResponse.json(
                { error: 'Unauthorized' },
                { status: 403 }
            )
        }

        const { data: todo, error } = await supabase
            .from('todos')
            .update({ title, completed })
            .eq('id', params.id)
            .select()
            .single()

        if (error) throw error

        return NextResponse.json(todo)
    } catch (error) {
        console.error('Error updating todo:', error)
        return NextResponse.json(
            { error: 'Failed to update todo' },
            { status: 500 }
        )
    }
}

// DELETE /api/todos/[id] - Delete a todo
export async function DELETE(
    request: Request,
    { params }: { params: { id: string } }
) {
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

        // Verify todo ownership
        const { data: existingTodo, error: fetchError } = await supabase
            .from('todos')
            .select('user_id')
            .eq('id', params.id)
            .single()

        if (fetchError || !existingTodo) {
            return NextResponse.json(
                { error: 'Todo not found' },
                { status: 404 }
            )
        }

        if (existingTodo.user_id !== user.id) {
            return NextResponse.json(
                { error: 'Unauthorized' },
                { status: 403 }
            )
        }

        const { error } = await supabase
            .from('todos')
            .delete()
            .eq('id', params.id)

        if (error) throw error

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('Error deleting todo:', error)
        return NextResponse.json(
            { error: 'Failed to delete todo' },
            { status: 500 }
        )
    }
} 