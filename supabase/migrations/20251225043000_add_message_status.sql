-- Migration: Add message status and typing indicator support
-- This adds status tracking to messages and creates a typing_status table

-- Add status column to messages table
ALTER TABLE messages ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'sent';
-- Possible values: 'sending', 'sent', 'delivered', 'read'

-- Add reply_to for message threading
ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to UUID;

-- Create typing status table for real-time typing indicators
CREATE TABLE IF NOT EXISTS typing_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id TEXT NOT NULL,
  is_typing BOOLEAN DEFAULT false,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create unique constraint on chat_id
CREATE UNIQUE INDEX IF NOT EXISTS typing_status_chat_id_idx ON typing_status(chat_id);

-- Enable realtime for typing_status
ALTER PUBLICATION supabase_realtime ADD TABLE typing_status;

-- Create index for faster message status queries
CREATE INDEX IF NOT EXISTS messages_status_idx ON messages(status);
CREATE INDEX IF NOT EXISTS messages_from_number_idx ON messages(from_number);
