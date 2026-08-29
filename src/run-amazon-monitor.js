import { chromium } from 'playwright';
import { collectAmazonProductDetails } from './collectors/amazon.js';
import { upsertProduct, registerProductUnavailability, supabase } from './repositories/products.js';
import { isConnectorActive } from './repositories/config.js';
import { checkAndNotifyOpportunity } from './services/opportunity-notifier.js';
import { closeWithTimeout, closeBrowserWithTimeout } from './utils/playwright-helper.js';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Busca todos os produtos ativos/conhecidos da Amazon no Supabase usando paginação.
 * @returns {Promise<Array>}
 */
export async function getAmazonProductsFromDb() {
  let allProducts = [];
  let limit = 1000;
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .eq('store', 'amazon')
      .range(offset, offset + limit - 1);

    if (error) {
      throw new Error(`Erro ao buscar produtos do banco: ${error.message}`);
    }

    if (data && data.length > 0) {
      allProducts.push(...data);
      offset += limit;
    }

    if (!data || data.length < limit) {
      hasMore = false;
    }
  }

  return allProducts;
}

/**
 * Determina a prioridade e elegibilidade de um produto com base nas regras de preço e tempo desde a última checagem.
 * @param {Object} prod
 * @param {Date} now
 * @returns {Object}
 */
export function getProductPriorityAndEligibility(prod, now = new Date()) {
  if (prod.availability_status === 'temporarily_unavailable') {
    const delayMinutes = 360; // 6 horas
    const referenceTime = prod.last_unavailable_at ? new Date(prod.last_unavailable_at) : new Date(prod.last_checked_at || 0);
    const timeSinceMs = now.getTime() - referenceTime.getTime();
    const isEligible = timeSinceMs >= delayMinutes * 60 * 1000;
    
    return {
      priority: 'LOW',
      priorityRank: 1,
      isEligible,
      delayMinutes,
      timeSinceCheckedMs: timeSinceMs,
      reason: `Produto temporariamente indisponível (última indisponibilidade há ${(timeSinceMs / 60000).toFixed(1)} minutos, elegível a cada 6 horas)`
    };
  }

  if (prod.availability_status === 'inactive') {
    const delayMinutes = 10080; // 7 dias
    const referenceTime = prod.last_unavailable_at ? new Date(prod.last_unavailable_at) : new Date(prod.last_checked_at || 0);
    const timeSinceMs = now.getTime() - referenceTime.getTime();
    const isEligible = timeSinceMs >= delayMinutes * 60 * 1000;
    
    return {
      priority: 'LOW',
      priorityRank: 1,
      isEligible,
      delayMinutes,
      timeSinceCheckedMs: timeSinceMs,
      reason: `Produto inativo (última indisponibilidade há ${(timeSinceMs / (60000 * 1440)).toFixed(1)} dias, elegível a cada 7 dias)`
    };
  }

  const currentPrice = Number(prod.current_price || 0);
  const referencePrice = Number(prod.reference_price || 0);

  let priority = 'LOW';
  let delayMinutes = 30;
  let reason = '';

  if (referencePrice <= 0 || isNaN(referencePrice) || currentPrice <= 0 || isNaN(currentPrice)) {
    priority = 'NORMAL';
    delayMinutes = 10;
    reason = 'Preço de referência ou preço atual ausente/inválido (classificado como NORMAL)';
  } else {
    const dropPct = (referencePrice - currentPrice) / referencePrice;
    reason = `Queda de ${(dropPct * 100).toFixed(1)}% em relação ao preço de referência`;

    if (dropPct >= 0.25) {
      priority = 'HIGH';
      delayMinutes = 2;
    } else if (dropPct >= 0.05) {
      priority = 'NORMAL';
      delayMinutes = 10;
    } else {
      priority = 'LOW';
      delayMinutes = 30;
    }
  }

  if (!prod.last_checked_at) {
    return {
      priority,
      priorityRank: priority === 'HIGH' ? 3 : priority === 'NORMAL' ? 2 : 1,
      isEligible: true,
      delayMinutes,
      timeSinceCheckedMs: Infinity,
      reason: `${reason} (last_checked_at nulo - elegível imediatamente)`
    };
  }

  const lastChecked = new Date(prod.last_checked_at);
  const timeSinceCheckedMs = now.getTime() - lastChecked.getTime();
  const isEligible = timeSinceCheckedMs >= delayMinutes * 60 * 1000;

  return {
    priority,
    priorityRank: priority === 'HIGH' ? 3 : priority === 'NORMAL' ? 2 : 1,
    isEligible,
    delayMinutes,
    timeSinceCheckedMs,
    reason: `${reason} (última checagem há ${(timeSinceCheckedMs / 60000).toFixed(1)} minutos)`
  };
}

/**
 * Executa o ciclo de monitoramento direto para os produtos cadastrados.
 * @param {Object} options
 * @param {number|null} options.limit Limite de produtos para processar (null para todos)
 * @param {boolean} options.mockTelegram Se true, moca as notificações do Telegram
 * @returns {Promise<Object>} Estatísticas da execução
 */
export async function runAmazonMonitor({ limit = null, mockTelegram = false } = {}) {
  // 0. Verificar se o conector está ativo
  if (!(await isConnectorActive('amazon'))) {
    console.log('[INFO] Conector "amazon" está inativo no banco de dados. Pulando execução do monitoramento.');
    return {
      total: 0,
      success: 0,
      unavailable: 0,
      blocked: 0,
      navigationError: 0,
      unexpectedError: 0,
      durations: [],
      failures: []
    };
  }

  console.log('=== INICIANDO MONITORAMENTO DIRETO AMAZON ===');
  console.log(`Hora de início: ${new Date().toLocaleString()}`);
  console.log(`Mocando Telegram: ${mockTelegram ? 'SIM' : 'NÃO'}\n`);

  const startTime = Date.now();
  const stats = {
    total: 0,
    success: 0,
    unavailable: 0,
    blocked: 0,
    navigationError: 0,
    unexpectedError: 0,
    durations: [],
    failures: []
  };

  let allProducts = [];
  try {
    allProducts = await getAmazonProductsFromDb();
    console.log(`[INFO] Carregados ${allProducts.length} produtos conhecidos do Supabase.`);
  } catch (error) {
    console.error('Erro fatal ao iniciar monitoramento:', error.message);
    return stats;
  }

  const now = new Date();
  const evaluated = allProducts.map(p => ({
    product: p,
    evaluation: getProductPriorityAndEligibility(p, now)
  }));

  const eligibleEvaluated = evaluated.filter(e => e.evaluation.isEligible);
  const ignoredCount = evaluated.length - eligibleEvaluated.length;

  const eligibleHigh = eligibleEvaluated.filter(e => e.evaluation.priority === 'HIGH').length;
  const eligibleNormal = eligibleEvaluated.filter(e => e.evaluation.priority === 'NORMAL').length;
  const eligibleLow = eligibleEvaluated.filter(e => e.evaluation.priority === 'LOW').length;

  stats.evaluatedCount = evaluated.length;
  stats.eligibleCount = eligibleEvaluated.length;
  stats.ignoredCount = ignoredCount;
  stats.eligibleHigh = eligibleHigh;
  stats.eligibleNormal = eligibleNormal;
  stats.eligibleLow = eligibleLow;

  // Ordenar: prioridade decrescente, depois data de checagem mais antiga primeiro
  eligibleEvaluated.sort((a, b) => {
    if (b.evaluation.priorityRank !== a.evaluation.priorityRank) {
      return b.evaluation.priorityRank - a.evaluation.priorityRank;
    }
    const dateA = a.product.last_checked_at ? new Date(a.product.last_checked_at).getTime() : 0;
    const dateB = b.product.last_checked_at ? new Date(b.product.last_checked_at).getTime() : 0;
    return dateA - dateB;
  });

  let products = eligibleEvaluated.map(e => e.product);
  console.log(`[INFO] Elegíveis para monitorar: ${products.length} (Ignorados/Não vencidos: ${ignoredCount})`);

  if (limit !== null) {
    products = products.slice(0, limit);
    console.log(`[INFO] Limitando a execução para os primeiros ${limit} produtos para este teste.`);
  }

  stats.total = products.length;

  if (products.length === 0) {
    console.log('[INFO] Nenhum produto para monitorar.');
    return stats;
  }

  // Inicializa o browser e o contexto
  const concurrencyLimit = parseInt(process.env.AMAZON_MONITOR_CONCURRENCY || '1', 10);
  console.log(`[INFO] Concorrência configurada: ${concurrencyLimit} workers`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: 'pt-BR',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });

  let currentIndex = 0;
  const workers = [];
  const activeWorkersCount = Math.min(concurrencyLimit, products.length);

  try {
    for (let w = 0; w < activeWorkersCount; w++) {
      workers.push((async (workerId) => {
        let page = await context.newPage();
        let productsProcessed = 0;
        try {
          while (true) {
            // Pega o próximo produto da lista de forma atômica/síncrona (JS single-thread nos gaps de async)
            const index = currentIndex++;
            if (index >= products.length) break;

            // Recriar a página a cada 50 produtos para expurgar cache/DOM e registrar memória
            if (productsProcessed > 0 && productsProcessed % 50 === 0) {
              const memory = process.memoryUsage();
              const rssMb = (memory.rss / 1024 / 1024).toFixed(2);
              const heapUsedMb = (memory.heapUsed / 1024 / 1024).toFixed(2);
              console.log(`[Worker ${workerId}][MEMÓRIA] Processados ${productsProcessed} itens. RSS: ${rssMb} MB | Heap: ${heapUsedMb} MB. Recriando página...`);
              try {
                await closeWithTimeout(page);
              } catch (closeErr) {
                console.error(`[Worker ${workerId}][ERRO] Falha ao fechar página:`, closeErr.message);
              }
              page = await context.newPage();
            }

            productsProcessed++;
            const prod = products[index];
            const prodStartTime = Date.now();

            // Construção da URL canônica pelo ASIN (external_id) with fallback para a URL salva
            const canonicalUrl = prod.external_id 
              ? `https://www.amazon.com.br/dp/${prod.external_id}` 
              : prod.url;

            console.log(`[Worker ${workerId}][${index + 1}/${products.length}] Monitorando ASIN: ${prod.external_id || 'N/A'}`);
            console.log(`  - URL: ${canonicalUrl}`);

            try {
              const details = await collectAmazonProductDetails(page, canonicalUrl);
              const duration = (Date.now() - prodStartTime) / 1000;
              stats.durations.push(duration);

              if (details.isBlocked) {
                stats.blocked++;
                console.warn(`  ❌ [Worker ${workerId}][BLOQUEIO/WAF] CAPTCHA ou bloqueio da Amazon detectado.`);
                continue;
              }

              if (details.isUnavailable) {
                stats.unavailable++;
                console.log(`  ⚠️ [Worker ${workerId}][INDISPONÍVEL] Produto sem estoque ou indisponível.`);
                try {
                  await registerProductUnavailability(prod.external_id, 'amazon');
                } catch (dbErr) {
                  console.error(`  ❌ Erro ao registrar indisponibilidade no banco:`, dbErr.message);
                }
                continue;
              }

              if (details.price === null) {
                stats.unavailable++;
                console.log(`  ⚠️ [Worker ${workerId}][PREÇO NÃO ENCONTRADO] Nome: "${details.name.substring(0, 40)}..." (Preço retornado: "${details.rawPrice || 'N/A'}")`);
                try {
                  await registerProductUnavailability(prod.external_id, 'amazon');
                } catch (dbErr) {
                  console.error(`  ❌ Erro ao registrar indisponibilidade no banco:`, dbErr.message);
                }
                continue;
              }

              // Sucesso de Coleta
              stats.success++;
              console.log(`  ✔ [Worker ${workerId}][SUCESSO] Preço coletado: R$ ${details.price} (Duração: ${duration.toFixed(2)}s)`);

              // Executar upsert no banco
              const upsertData = {
                asin: prod.external_id,
                name: details.name || prod.name,
                price: details.price,
                url: canonicalUrl,
                imageUrl: details.imageUrl
              };

              const result = await upsertProduct(upsertData, 'amazon');

              if (mockTelegram) {
                if (result.shouldAlert) {
                  console.log(`  🔔 [Worker ${workerId}][MOCK TELEGRAM] Alerta dispararia! Nível: ${result.data?.last_opportunity_level.toUpperCase()}`);
                  console.log(`     Produto: "${result.data?.name.substring(0, 40)}..." | De R$ ${result.data?.reference_price} por R$ ${result.data?.current_price}`);
                }
              } else {
                const telegramResult = await checkAndNotifyOpportunity(result);
                if (telegramResult) {
                  console.log(`  🔔 [Worker ${workerId}][TELEGRAM] Alerta enviado com sucesso.`);
                }
              }

            } catch (err) {
              const duration = (Date.now() - prodStartTime) / 1000;
              stats.durations.push(duration);

              if (err.message.includes('net::') || err.message.includes('timeout') || err.message.includes('Navigation failed')) {
                stats.navigationError++;
                console.error(`  ❌ [Worker ${workerId}][ERRO DE NAVEGAÇÃO] Falha ao carregar: ${err.message}`);
                stats.failures.push({ asin: prod.external_id, type: 'Navegação/HTTP', error: err.message });
              } else {
                stats.unexpectedError++;
                console.error(`  ❌ [Worker ${workerId}][ERRO INESPERADO] Falha no processamento:`, err.stack || err.message);
                stats.failures.push({ asin: prod.external_id, type: 'Inesperado', error: err.message });
              }
            }
          }
        } finally {
          await closeWithTimeout(page);
        }
      })(w + 1));
    }

    await Promise.all(workers);

  } finally {
    await closeWithTimeout(context);
    await closeBrowserWithTimeout(browser);
  }


  const totalDuration = ((Date.now() - startTime) / 1000).toFixed(2);
  const avgDuration = stats.durations.length > 0
    ? (stats.durations.reduce((a, b) => a + b, 0) / stats.durations.length).toFixed(2)
    : '0.00';
  const minDuration = stats.durations.length > 0 ? Math.min(...stats.durations).toFixed(2) : '0.00';
  const maxDuration = stats.durations.length > 0 ? Math.max(...stats.durations).toFixed(2) : '0.00';

  console.log('\n=== RESUMO DO MONITORAMENTO DIRETO ===');
  console.log(`- Total de produtos monitorados: ${stats.total}`);
  console.log(`- Sucessos: ${stats.success}`);
  console.log(`- Indisponíveis / Sem Preço: ${stats.unavailable}`);
  console.log(`- Bloqueados/CAPTCHA: ${stats.blocked}`);
  console.log(`- Erros de navegação: ${stats.navigationError}`);
  console.log(`- Erros inesperados: ${stats.unexpectedError}`);
  console.log(`- Duração Total: ${totalDuration}s`);
  console.log(`- Duração Média por produto: ${avgDuration}s (Mín: ${minDuration}s / Máx: ${maxDuration}s)`);
  console.log('=======================================\n');

  return {
    ...stats,
    totalDuration,
    avgDuration,
    minDuration,
    maxDuration
  };
}

// Executa se rodar diretamente
import { fileURLToPath } from 'url';
const nodePath = fileURLToPath(import.meta.url);
if (process.argv[1] === nodePath) {
  runAmazonMonitor({ limit: 10, mockTelegram: true });
}
