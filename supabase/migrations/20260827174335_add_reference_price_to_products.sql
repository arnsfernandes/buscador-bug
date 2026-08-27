-- Add reference_price column to products table
ALTER TABLE products ADD COLUMN reference_price numeric CONSTRAINT chk_reference_price CHECK (reference_price > 0);
