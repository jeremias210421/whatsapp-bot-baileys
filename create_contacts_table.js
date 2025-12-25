const { createClient } = require('@supabase/supabase-js');

// Using credentials from apply_rls_fix.js (Service Role Key)
const supabase = createClient(
    'https://mfsuhrtvertzoggvlwxv.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1mc3VocnR2ZXJ0em9nZ3Zsd3h2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NjU5MTYzMCwiZXhwIjoyMDgyMTY3NjMwfQ.q8IZxmSOzzPEnwlf1FAfi_EtbAzGX7ScgQwRH00ARik'
);

async function createTable() {
    console.log('🔧 Creating contacts table...');

    const sql = `
    CREATE TABLE IF NOT EXISTS public.contacts (
        phone_number TEXT PRIMARY KEY,
        name TEXT,
        profile_pic_url TEXT,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
    
    -- Drop policies to avoid errors if they exist
    DROP POLICY IF EXISTS "Public read access" ON public.contacts;
    DROP POLICY IF EXISTS "Service role full access" ON public.contacts;

    CREATE POLICY "Public read access" ON public.contacts FOR SELECT USING (true);
    CREATE POLICY "Service role full access" ON public.contacts FOR ALL USING (true) WITH CHECK (true);
    `;

    // Try executing via RPC
    const { data, error } = await supabase.rpc('exec_sql', { sql });

    if (error) {
        console.error('❌ RPC Error:', error.message);
        console.log('Detailed:', error);

        // Check if function exists
        if (error.code === '42883') { // undefined_function
            console.log('⚠️ The function "exec_sql" does not exist in your database.');
            console.log('Please run the SQL manually in the Supabase Dashboard SQL Editor.');
        }
    } else {
        console.log('✅ Table "contacts" created/verified successfully!');
    }
}

createTable();
