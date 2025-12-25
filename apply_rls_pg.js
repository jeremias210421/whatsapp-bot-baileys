const { Client } = require('pg');

const client = new Client({
    connectionString: 'postgresql://postgres:SupabaseBot2025!@db.mfsuhrtvertzoggvlwxv.supabase.co:5432/postgres',
    ssl: { rejectUnauthorized: false }
});

async function run() {
    try {
        console.log('🔌 Connecting to Postgres (Direct)...');
        await client.connect();

        console.log('📝 Executing SQL fix...');
        await client.query(`
      ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
      
      DROP POLICY IF EXISTS "Allow public read access" ON messages;
      CREATE POLICY "Allow public read access" 
      ON messages FOR SELECT 
      USING (true);
    `);

        console.log('✅ Success! RLS Policies updated.');
    } catch (err) {
        console.error('❌ Error executing query:', err);
    } finally {
        await client.end();
    }
}

run();
