-- Create discovery_state table
CREATE TABLE IF NOT EXISTS discovery_state (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    source text NOT NULL,
    search_term text NOT NULL,
    last_page integer NOT NULL DEFAULT 0,
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT unique_source_search_term UNIQUE (source, search_term)
);

-- Attach trigger to update updated_at automatically if not already exists
CREATE TRIGGER trigger_update_discovery_state_updated_at
    BEFORE UPDATE ON discovery_state
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Enable Row Level Security (RLS)
ALTER TABLE discovery_state ENABLE ROW LEVEL SECURITY;
