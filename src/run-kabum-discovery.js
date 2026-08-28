import { chromium } from 'playwright';
import { collectKaBuMProducts } from './collectors/kabum.js';
import { upsertProduct, supabase } from './repositories/products.js';
import { isConnectorActive, listDiscoveryTerms, createDiscoveryTerm, updateDiscoveryTerm } from './repositories/config.js';
import dotenv from 'dotenv';

dotenv.config();

const SOURCE = 'kabum';
const PAGES_PER_RUN = parseInt(process.env.DISCOVERY_PAGES_PER_RUN || '2', 10); // Execução rápida inicial
const MAX_PAGE_LIMIT = parseInt(process.env.DISCOVERY_MAX_PAGE_LIMIT || '50', 10);

/**
 * Executa a descoberta sequencial para a KaBuM!
 * @param {Object} options
 * @param {Array<string>} options.terms Lista opcional de termos customizados
 * @param {number} options.pagesPerRun Páginas por termo
 * @returns {Promise<Object>}
 */
export async function runKaBuMDiscovery({ terms = null, pagesPerRun = PAGES_PER_RUN } = {}) {
  // 0. Verificar se o conector está ativo
  if (!(await isConnectorActive(SOURCE))) {
    console.log(`[INFO] Conector "${SOURCE}" está inativo no banco de dados. Pulando descoberta.`);
    return {};
  }

  // 1. Obter ou inicializar termos ativos para a KaBuM!
  let termsToProcess = terms;
  if (!termsToProcess) {
    try {
      const dbTerms = await listDiscoveryTerms(SOURCE);
      termsToProcess = dbTerms.filter(t => t.active).map(t => t.search_term);
      console.log(`[INFO] Carregados ${termsToProcess.length} termos ativos da KaBuM!.`);
    } catch (err) {
      console.error('Erro ao listar termos da KaBuM!:', err.message);
      return {};
    }
  }

  console.log('=== INICIANDO DESCOBERTA MULTI-TERMOS KABUM! ===');
  console.log(`Hora de início: ${new Date().toLocaleString()}`);
  console.log(`Total de termos: ${termsToProcess.length}\n`);

  const startTime = Date.now();
  const summary = {};

  if (termsToProcess.length === 0) {
    console.log('[INFO] Nenhum termo ativo para processar.');
    return {};
  }

  const browser = await chromium.launch({ headless: true, timeout: 15000 });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: 'pt-BR',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  let page = await context.newPage();

  try {
    for (const term of termsToProcess) {
      console.log(`\n👉 Processando termo: "${term}"`);
      const termStartTime = Date.now();
      
      summary[term] = {
        found: 0,
        new: 0,
        known: 0,
        discarded: 0,
        errors: 0,
        pagesRun: 0,
        status: 'success'
      };

      // Carrega estado de progresso
      let { data: state, error: stateError } = await supabase
        .from('discovery_state')
        .select('*')
        .eq('source', SOURCE)
        .eq('search_term', term)
        .maybeSingle();

      if (stateError) {
        console.error(`  ❌ Erro ao carregar estado para o termo "${term}":`, stateError.message);
        summary[term].status = 'error_db_read';
        continue;
      }

      if (!state) {
        console.log(`  [LOG] Progresso não encontrado para "${term}". Criando no Supabase...`);
        const { data: newState, error: createError } = await supabase
          .from('discovery_state')
          .insert({
            source: SOURCE,
            search_term: term,
            last_page: 0,
            active: true
          })
          .select()
          .single();

        if (createError) {
          console.error(`  ❌ Erro ao criar progresso no banco para "${term}":`, createError.message);
          summary[term].status = 'error_db_create';
          summary[term].errors++;
          continue;
        }
        state = newState;
      }

      const startPage = state.last_page;
      let currentPage = startPage;
      let resetToPage1 = false;

      for (let i = 0; i < pagesPerRun; i++) {
        currentPage++;
        console.log(`  - [PÁGINA ${currentPage}] Coletando produtos...`);
        summary[term].pagesRun++;

        try {
          const { products, rawCount, discarded } = await collectKaBuMProducts(term, currentPage, page);
          
          summary[term].found += rawCount;
          summary[term].discarded += discarded.length;

          if (products.length === 0) {
            console.log(`  - [PÁGINA ${currentPage}] Nenhum produto válido. Fim da varredura.`);
            resetToPage1 = true;
            break;
          }

          // Persistir produtos (sem disparar Telegram neste script)
          for (const prod of products) {
            try {
              const upsertData = {
                asin: prod.external_id,
                name: prod.name,
                price: prod.price,
                url: prod.url,
                imageUrl: prod.imageUrl,
                originalPrice: prod.originalPrice
              };

              const res = await upsertProduct(upsertData, SOURCE, true);
              if (res.status === 'inserted') {
                summary[term].new++;
              } else {
                summary[term].known++;
              }
            } catch (dbErr) {
              console.error(`    ❌ Erro ao salvar produto ${prod.external_id}:`, dbErr.message);
              summary[term].errors++;
            }
          }

          // Atualizar progresso parcial
          await updateDiscoveryTerm(state.id, { last_page: currentPage });

          if (currentPage >= MAX_PAGE_LIMIT) {
            console.log(`  - [INFO] Limite de páginas (${MAX_PAGE_LIMIT}) atingido.`);
            resetToPage1 = true;
            break;
          }

        } catch (error) {
          console.error(`  - [PÁGINA ${currentPage}] Erro:`, error.message);
          summary[term].errors++;
          summary[term].status = 'partial_error';
          
          try {
            await page.close();
            page = await context.newPage();
          } catch (pe) {}
          break;
        }
      }

      if (resetToPage1) {
        await updateDiscoveryTerm(state.id, { last_page: 0 });
        console.log(`  [LOG] Progresso de descoberta para "${term}" resetado para página 1.`);
      }

      const duration = ((Date.now() - termStartTime) / 1000).toFixed(2);
      console.log(`📊 Termo "${term}" finalizado em ${duration}s. Novos: ${summary[term].new} | Conhecidos: ${summary[term].known}`);
    }
  } finally {
    if (page) await page.close();
    if (context) await context.close();
    if (browser) await browser.close();
  }

  const totalDuration = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log('\n=== RESUMO GERAL DA DESCOBERTA KABUM ===');
  console.log(`Duração Total: ${totalDuration}s`);
  console.log('------------------------------------------------------------');
  console.log('Termo\t\t\tStatus\t\tPág.\tNovos\tConhecidos\tDescartados\tErros');
  console.log('------------------------------------------------------------');
  for (const [term, data] of Object.entries(summary)) {
    console.log(`${term.padEnd(20, ' ')}\t${data.status.padEnd(10, ' ')}\t${data.pagesRun}\t${data.new}\t${data.known}\t\t${data.discarded}\t\t${data.errors}`);
  }
  console.log('============================================================\n');

  return summary;
}

// Execução de teste controlada
import { fileURLToPath } from 'url';
const nodePath = fileURLToPath(import.meta.url);
if (process.argv[1] === nodePath) {
  runKaBuMDiscovery({ terms: ['ssd'], pagesPerRun: 1 });
}
