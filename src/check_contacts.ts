
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("Missing env vars");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
    const { data, error } = await supabase
        .from('contacts')
        .select('*')
        .limit(1);

    if (error) {
        console.log("Error accessing contacts table:", error.message);
        if (error.code === '42P01') {
            console.log("Table 'contacts' does not exist.");
        }
    } else {
        console.log("Table 'contacts' exists. Row count:", data.length);
    }
}

check();
