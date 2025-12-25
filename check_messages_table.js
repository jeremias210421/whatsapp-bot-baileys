
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY; // Use service key to bypass RLS for check

if (!supabaseUrl || !supabaseKey) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in .env");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkMessagesTable() {
    console.log("Checking 'messages' table schema...");

    // Check specific columns
    const columns = ['id', 'status', 'direction', 'from_number'];

    for (const col of columns) {
        const { error } = await supabase
            .from('messages')
            .select(col)
            .limit(1);

        if (error) {
            console.log(`❌ Column '${col}' check failed:`, error.message);
        } else {
            console.log(`✅ Column '${col}' exists.`);
        }
    }
}

checkMessagesTable();
