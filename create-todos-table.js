require('dotenv').config()
const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

const supabase = createClient(supabaseUrl, supabaseKey)

async function createTodosTable() {
    try {
        // Create todos table
        const { error } = await supabase
            .from('todos')
            .insert([
                {
                    title: 'Test Todo',
                    completed: false
                }
            ])
            .select()

        if (error) {
            if (error.code === '42P01') {
                console.log('Table does not exist. Creating it...')
                // Create the table using SQL
                const { error: createError } = await supabase
                    .from('todos')
                    .select('*')
                    .limit(1)

                if (createError) {
                    console.error('Error creating todos table:', createError)
                } else {
                    console.log('Successfully created todos table!')
                }
            } else {
                console.error('Error:', error)
            }
        } else {
            console.log('Successfully created test todo!')
        }
    } catch (error) {
        console.error('Error:', error)
    }
}

createTodosTable() 