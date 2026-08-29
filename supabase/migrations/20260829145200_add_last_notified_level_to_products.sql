-- Migração: Adiciona last_notified_opportunity_level para controle preciso de alertas enviados

ALTER TABLE products ADD COLUMN IF NOT EXISTS last_notified_opportunity_level TEXT DEFAULT NULL;
