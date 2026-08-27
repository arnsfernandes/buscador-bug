-- Create price_history table
CREATE TABLE IF NOT EXISTS price_history (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    price numeric NOT NULL CONSTRAINT chk_price CHECK (price > 0),
    recorded_at timestamptz NOT NULL DEFAULT now()
);

-- Enable Row Level Security (RLS)
ALTER TABLE price_history ENABLE ROW LEVEL SECURITY;
