-- Add last_opportunity_level column to products table
ALTER TABLE products ADD COLUMN last_opportunity_level text NOT NULL DEFAULT 'none';
