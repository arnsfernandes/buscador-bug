-- Migração: Criação de crawler_tuning_state e crawler_cycle_logs

CREATE TABLE IF NOT EXISTS crawler_tuning_state (
    store TEXT PRIMARY KEY,
    request_rate DOUBLE PRECISION DEFAULT 1.0, -- taxa de requisição / concorrência / delays
    target_revisit_minutes DOUBLE PRECISION DEFAULT 1.0,
    last_stable_request_rate DOUBLE PRECISION DEFAULT 1.0,
    healthy_streak INTEGER DEFAULT 0,
    waf_streak INTEGER DEFAULT 0,
    cooldown_until TIMESTAMP WITH TIME ZONE NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS crawler_cycle_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store TEXT NOT NULL,
    started_at TIMESTAMP WITH TIME ZONE NOT NULL,
    finished_at TIMESTAMP WITH TIME ZONE NOT NULL,
    duration_sec DOUBLE PRECISION NOT NULL,
    total_processed INTEGER NOT NULL,
    success_count INTEGER NOT NULL,
    error_count INTEGER NOT NULL,
    waf_count INTEGER NOT NULL,
    http_direct_count INTEGER NOT NULL,
    fallback_playwright_count INTEGER NOT NULL,
    target_revisit_minutes DOUBLE PRECISION NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Inserir estado padrão inicial para a KaBuM!
INSERT INTO crawler_tuning_state (store, request_rate, target_revisit_minutes, last_stable_request_rate, healthy_streak, waf_streak, cooldown_until)
VALUES ('kabum', 1.0, 1.0, 1.0, 0, 0, NULL)
ON CONFLICT (store) DO NOTHING;
