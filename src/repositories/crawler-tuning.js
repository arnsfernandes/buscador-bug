import { supabase } from './products.js';

/**
 * Obtém o estado de tuning do crawler para uma loja específica.
 * @param {string} store Nome da loja (ex: 'kabum')
 * @returns {Promise<Object>} Estado de tuning ou nulo
 */
export async function getCrawlerTuningState(store) {
  const { data, error } = await supabase
    .from('crawler_tuning_state')
    .select('*')
    .eq('store', store)
    .maybeSingle();

  if (error) {
    throw new Error(`Erro ao obter tuning de ${store}: ${error.message}`);
  }

  return data;
}

/**
 * Atualiza ou insere o estado de tuning do crawler.
 * @param {string} store Nome da loja
 * @param {Object} stateUpdate Campos para atualizar
 * @returns {Promise<Object>} Registro atualizado
 */
export async function updateCrawlerTuningState(store, stateUpdate) {
  const { data, error } = await supabase
    .from('crawler_tuning_state')
    .upsert({
      store,
      ...stateUpdate,
      updated_at: new Date().toISOString()
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Erro ao atualizar tuning de ${store}: ${error.message}`);
  }

  return data;
}

/**
 * Salva um log de ciclo do crawler.
 * @param {Object} log Dados do log de ciclo
 * @returns {Promise<Object>} Registro criado
 */
export async function saveCrawlerCycleLog(log) {
  const { data, error } = await supabase
    .from('crawler_cycle_logs')
    .insert({
      store: log.store,
      started_at: log.startedAt.toISOString ? log.startedAt.toISOString() : log.startedAt,
      finished_at: log.finishedAt.toISOString ? log.finishedAt.toISOString() : log.finishedAt,
      duration_sec: log.durationSec,
      total_processed: log.totalProcessed,
      success_count: log.successCount,
      error_count: log.errorCount,
      waf_count: log.wafCount,
      http_direct_count: log.httpDirectCount,
      fallback_playwright_count: log.fallbackPlaywrightCount,
      target_revisit_minutes: log.targetRevisitMinutes
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Erro ao salvar log de ciclo para ${log.store}: ${error.message}`);
  }

  return data;
}
