import { chromium } from 'playwright';
import { collectKaBuMProductDetails } from './collectors/kabum.js';
import { upsertProduct, registerProductUnavailability, supabase } from './repositories/products.js';
import { isConnectorActive } from './repositories/config.js';
import { getProductPriorityAndEligibility } from './run-amazon-monitor.js';
import { checkAndNotifyOpportunity } from './services/opportunity-notifier.js';
import dotenv from 'dotenv';

dotenv.config();

const SOURCE = 'kabum';

/**
 * Busca todos os produtos da KaBuM! cadastrados no banco usando paginação.
 * @returns {Promise<Array>}
 */
export async function getKaBuMProductsFromDb() {
  let allProducts = [];
  let limit = 1000;
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .eq('store', SOURCE)
      .range(offset, offset + limit - 1);

    if (error) {
      throw new Error(`Erro ao buscar produtos da KaBuM! do banco: ${error.message}`);
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
 * Executa o ciclo de monitoramento direto para os produtos da KaBuM!.
 * @param {Object} options
 * @param {number|null} options.limit Limite de produtos para processar (null para todos)
 * @returns {Promise<Object>} Estatísticas da execução
 */
export async function runKaBuMMonitor({ limit = null } = {}) {
  // 0. Verificar se o conector está ativo
  if (!(await isConnectorActive(SOURCE))) {
    console.log(`[INFO] Conector "${SOURCE}" está inativo no banco de dados. Pulando monitoramento.`);
    return { total: 0, success: 0 };
  }

  console.log('=== INICIANDO MONITORAMENTO DIRETO KABUM! ===');
  console.log(`Hora de início: ${new Date().toLocaleString()}\n`);

  const startTime = Date.now();
  const stats = {
    total: 0,
    success: 0,
    unavailable: 0,
    blocked: 0,
    navigationError: 0,
    unexpectedError: 0,
    durations: [],
    failures: [],
    usedHttp: 0,
    usedFallback: 0,
    priority1Count: 0,
    priority2Count: 0,
    priority3Count: 0
  };

  let allProducts = [];
  try {
    allProducts = await getKaBuMProductsFromDb();
    console.log(`[INFO] Carregados ${allProducts.length} produtos conhecidos da KaBuM! do banco.`);
  } catch (error) {
    console.error('Erro fatal ao iniciar monitoramento KaBuM!:', error.message);
    return stats;
  }

  const now = new Date();
  const evaluated = allProducts.map(p => ({
    product: p,
    evaluation: getProductPriorityAndEligibility(p, now)
  }));

  const eligibleEvaluated = evaluated.filter(e => limit !== null ? true : e.evaluation.isEligible);
  const ignoredCount = limit !== null ? 0 : evaluated.length - eligibleEvaluated.length;

  // Ordenar prioridades
  eligibleEvaluated.sort((a, b) => {
    if (b.evaluation.priorityRank !== a.evaluation.priorityRank) {
      return b.evaluation.priorityRank - a.evaluation.priorityRank;
    }
    const dateA = a.product.last_checked_at ? new Date(a.product.last_checked_at).getTime() : 0;
    const dateB = b.product.last_checked_at ? new Date(b.product.last_checked_at).getTime() : 0;
    return dateA - dateB;
  });

  let products = eligibleEvaluated.map(e => ({
    ...e.product,
    priorityRank: e.evaluation.priorityRank
  }));
  console.log(`[INFO] Elegíveis para monitorar: ${products.length} (Ignorados: ${ignoredCount})`);

  if (limit !== null) {
    products = products.slice(0, limit);
    console.log(`[INFO] Limitando a execução para os primeiros ${limit} produtos para este teste.`);
  }

  stats.total = products.length;

  if (products.length === 0) {
    console.log('[INFO] Nenhum produto KaBuM! para monitorar neste ciclo.');
    return stats;
  }

  const concurrencyLimit = parseInt(process.env.KABUM_MONITOR_CONCURRENCY || '2', 10);
  console.log(`[INFO] Concorrência configurada: ${concurrencyLimit} workers`);

  let currentIndex = 0;
  const workers = [];
  const activeWorkersCount = Math.min(concurrencyLimit, products.length);

  try {
    for (let w = 0; w < activeWorkersCount; w++) {
      workers.push((async (workerId) => {
        let workerBrowser = null;
        let workerContext = null;
        let workerPage = null;
        let productsProcessed = 0;

        const getLazyPage = async () => {
          if (!workerPage) {
            console.log(`[Worker ${workerId}] Inicializando Chromium sob demanda para Fallback...`);
            workerBrowser = await chromium.launch({ headless: true });
            workerContext = await workerBrowser.newContext({
              viewport: { width: 1280, height: 800 },
              locale: 'pt-BR',
              userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            });
            workerPage = await workerContext.newPage();
          }
          return workerPage;
        };

        try {
          while (true) {
            const index = currentIndex++;
            if (index >= products.length) break;

            if (workerPage && productsProcessed > 0 && productsProcessed % 50 === 0) {
              const memory = process.memoryUsage();
              console.log(`[Worker ${workerId}][MEMÓRIA] Processados ${productsProcessed}. RSS: ${(memory.rss/1024/1024).toFixed(2)} MB. Reiniciando página...`);
              await workerPage.close();
              workerPage = await workerContext.newPage();
            }

            productsProcessed++;
            const prod = products[index];
            const prodStartTime = Date.now();

            console.log(`[Worker ${workerId}][${index + 1}/${products.length}] Monitorando ID: ${prod.external_id}`);

            try {
              const details = await collectKaBuMProductDetails(getLazyPage, prod.external_id);
              const duration = (Date.now() - prodStartTime) / 1000;
              stats.durations.push(duration);

              if (details.usedHttp) {
                stats.usedHttp++;
              } else {
                stats.usedFallback++;
              }

              if (prod.priorityRank === 3) stats.priority3Count++;
              else if (prod.priorityRank === 2) stats.priority2Count++;
              else stats.priority1Count++;

              if (details.isBlocked) {
                stats.blocked++;
                console.warn(`  ❌ [Worker ${workerId}][BLOQUEIO] WAF impediu a extração.`);
                continue;
              }

              if (details.isUnavailable || details.price === null) {
                stats.unavailable++;
                console.log(`  ⚠️ [Worker ${workerId}][INDISPONÍVEL/SEM PREÇO]`);
                await registerProductUnavailability(prod.external_id, SOURCE);
                continue;
              }

              stats.success++;
              const viaStr = details.usedHttp ? 'HTTP' : 'Fallback Playwright';
              console.log(`  ✔ [Worker ${workerId}][SUCESSO] De R$ ${prod.current_price} por R$ ${details.price} (Pix) | Via: ${viaStr} | Duração: ${duration.toFixed(2)}s`);

              const upsertData = {
                asin: prod.external_id,
                name: details.name || prod.name,
                price: details.price,
                url: prod.url,
                imageUrl: details.imageUrl,
                originalPrice: details.originalPrice
              };

              const result = await upsertProduct(upsertData, SOURCE);
              if (result.shouldAlert) {
                console.log(`  🔔 [OPORTUNIDADE] Nível: ${result.data?.last_opportunity_level.toUpperCase()} detectado. Enviando Telegram...`);
                await checkAndNotifyOpportunity(result.data);
              }

            } catch (err) {
              const duration = (Date.now() - prodStartTime) / 1000;
              stats.durations.push(duration);
              stats.unexpectedError++;
              console.error(`  ❌ [Worker ${workerId}][ERRO]`, err.message);
              stats.failures.push({ id: prod.external_id, error: err.message });
            }
          }
        } finally {
          if (workerPage) await workerPage.close();
          if (workerContext) await workerContext.close();
          if (workerBrowser) await workerBrowser.close();
        }
      })(w + 1));
    }

    await Promise.all(workers);
  } catch (err) {
    console.error('Erro na execução dos workers:', err.message);
  }

  const totalDuration = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log('\n=== RESUMO DO MONITORAMENTO KABUM ===');
  console.log(`- Total de produtos monitorados: ${stats.total}`);
  console.log(`- Sucessos: ${stats.success}`);
  console.log(`- Indisponíveis: ${stats.unavailable}`);
  console.log(`- Bloqueados/WAF: ${stats.blocked}`);
  console.log(`- Erros: ${stats.unexpectedError}`);
  console.log(`- Via HTTP Direto: ${stats.usedHttp}`);
  console.log(`- Via Fallback Playwright: ${stats.usedFallback}`);
  console.log(`- Duração Total: ${totalDuration}s`);
  console.log('======================================\n');

  stats.catalogCount = allProducts.length;
  return stats;
}

// Execução de teste controlada
import { fileURLToPath } from 'url';
const nodePath = fileURLToPath(import.meta.url);
if (process.argv[1] === nodePath) {
  runKaBuMMonitor({ limit: 5 }); // Amostra de 5 produtos
}
