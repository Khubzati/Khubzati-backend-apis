require('dotenv').config()
const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

console.log('Supabase URL:', supabaseUrl)
console.log('Supabase Key:', supabaseKey)

const supabase = createClient(supabaseUrl, supabaseKey)

async function testConnection() {
    try {
        // Test connection by creating a todos table
        const { error } = await supabase
            .from('todos')
            .select('*')
            .limit(1)

        if (error) {
            console.error('Error connecting to Supabase:', error)
        } else {
            console.log('Successfully connected to Supabase!')
        }
    } catch (error) {
        console.error('Error:', error)
    }
}

testConnection() 