import { createClient } from '@/utils/supabase/server'
import { cookies } from 'next/headers'

export default async function Page() {
    const cookieStore = cookies()
    const supabase = createClient(cookieStore)

    const { data: todos } = await supabase.from('todos').select()

    return (
        <div className="p-4">
            <h1 className="text-2xl font-bold mb-4">Todos</h1>
            <ul className="space-y-2">
                {todos?.map((todo) => (
                    <li key={todo.id} className="p-2 bg-gray-100 rounded">
                        {todo.title}
                    </li>
                ))}
            </ul>
        </div>
    )
} 