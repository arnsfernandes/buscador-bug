CREATE TABLE IF NOT EXISTS connector_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store TEXT NOT NULL UNIQUE,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Attach trigger to update updated_at automatically
CREATE TRIGGER trigger_update_connector_config_updated_at
    BEFORE UPDATE ON connector_config
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Seed Amazon connector as active
INSERT INTO connector_config (store, active)
VALUES ('amazon', true)
ON CONFLICT (store) DO NOTHING;

-- Seed default discovery terms
INSERT INTO discovery_state (source, search_term, active)
VALUES 
  ('amazon', 'eletrodomésticos', true),
  ('amazon', 'caixa de som', true),
  ('amazon', 'fone de ouvido', true),
  ('amazon', 'soundbar', true),
  ('amazon', 'headset', true),
  ('amazon', 'smartphone', true),
  ('amazon', 'ferramentas', true),
  ('amazon', 'notebook', true),
  ('amazon', 'monitor', true),
  ('amazon', 'teclado', true),
  ('amazon', 'mouse', true),
  ('amazon', 'SSD', true),
  ('amazon', 'placa de vídeo', true),
  ('amazon', 'memória RAM', true),
  ('amazon', 'roteador', true)
ON CONFLICT (source, search_term) DO NOTHING;
