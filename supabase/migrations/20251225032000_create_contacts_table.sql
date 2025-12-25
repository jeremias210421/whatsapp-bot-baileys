CREATE TABLE IF NOT EXISTS contacts (
    jid TEXT PRIMARY KEY,
    name TEXT,
    profile_picture_url TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;

-- Allow read access for authenticated users (frontend)
CREATE POLICY "Enable read access for authenticated users" ON contacts
    FOR SELECT
    TO authenticated
    USING (true);

-- Allow all access for service role (bot)
CREATE POLICY "Enable all access for service role" ON contacts
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
