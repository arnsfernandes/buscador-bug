import { chromium } from 'playwright';
import { collectAmazonProducts } from './collectors/amazon.js';
import { upsertProduct, supabase } from './repositories/products.js';
import dotenv from 'dotenv';

dotenv.config();

const SOURCE = 'amazon';
const PAGES_PER_RUN = parseInt(process.env.DISCOVERY_PAGES_PER_RUN || '10', 10);
const MAX_PAGE_LIMIT = parseInt(process.env.DISCOVERY_MAX_PAGE_LIMIT || '50', 10);

export const SEARCH_CATEGORIES = {
  ELETRODOMESTICOS: ['eletrodomésticos'],
  AUDIO: ['caixa de som', 'fone de ouvido', 'soundbar', 'headset'],
  SMARTPHONE: ['smartphone'],
  FERRAMENTAS: ['ferramentas'],
  INFORMATICA: ['notebook', 'monitor', 'teclado', 'mouse', 'SSD', 'placa de vídeo', 'memória RAM', 'roteador']
};

export const ALL_TERMS = Object.values(SEARCH_CATEGORIES).flat();

/**
 * Executa a descoberta sequencial para uma lista de termos de forma robusta e otimizada.
 * @param {Object} options
 * @param {Array<string>} options.terms Lista de termos para pesquisar
 * @param {number} options.pagesPerRun Páginas para percorrer por termo nesta rodada
 * @returns {Promise<Object>} Resumo dos resultados por termo
 */
export async function runAmazonDiscovery({ terms = ALL_TERMS, pagesPerRun = PAGES_PER_RUN } = {}) {
  console.log('=== INICIANDO DESCOBERTA MULTI-TERMOS AMAZON ===');
  console.log(`Hora de início: ${new Date().toLocaleString()}`);
  console.log(`Total de termos na lista: ${terms.length}\n`);

  const startTime = Date.now();
  const summary = {};

  // 1. Inicializa o browser único de controle de ciclo
  const browser = await chromium.launch({ headless: true, timeout: 15000 });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: 'pt-BR',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  let page = await context.newPage();

  try {
    for (const term of terms) {
      console.log(`\n============================================================`);
      console.log(`👉 Processando termo: "${term}"`);
      console.log(`============================================================`);

      const termStartTime = Date.now();
      summary[term] = {
        found: 0,
        new: 0,
        known: 0,
        errors: 0,
        pagesRun: 0,
        status: 'success'
      };

      // Obter ou criar o estado de progresso no Supabase para este termo
      let { data: state, error: stateError } = await supabase
        .from('discovery_state')
        .select('*')
        .eq('source', SOURCE)
        .eq('search_term', term)
        .maybeSingle();

      if (stateError) {
        console.error(`  ❌ Erro ao carregar progresso do termo "${term}":`, stateError.message);
        summary[term].status = 'error_db_read';
        summary[term].errors++;
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

      if (!state.active) {
        console.log(`  [INFO] O termo "${term}" está inativo. Pulando.`);
        summary[term].status = 'inactive';
        continue;
      }

      const startPage = state.last_page;
      let currentPage = startPage;
      let resetToPage1 = false;

      console.log(`  - Última página processada: ${startPage}`);
      console.log(`  - Planejado: Rodar até ${pagesPerRun} páginas (iniciando em ${startPage + 1})`);

      for (let i = 0; i < pagesPerRun; i++) {
        currentPage++;
        const pageStartTime = Date.now();
        console.log(`  - [PÁGINA ${currentPage}] Coletando produtos da Amazon...`);

        try {
          const { products, discarded } = await collectAmazonProducts(term, currentPage, page);
          const pageDuration = ((Date.now() - pageStartTime) / 1000).toFixed(2);

          if (products.length === 0) {
            console.log(`  - [PÁGINA ${currentPage}] Nenhum produto válido retornado. Finalizando varredura.`);
            resetToPage1 = true;
            break;
          }

          // Consultar no Supabase quais ASINs já existem (em lote)
          const asins = products.map(p => p.asin);
          const { data: existingProducts, error: selectError } = await supabase
            .from('products')
            .select('external_id')
            .eq('store', SOURCE)
            .in('external_id', asins);

          if (selectError) {
            throw new Error(`Erro ao verificar ASINs existentes: ${selectError.message}`);
          }

          const existingAsins = new Set(existingProducts.map(p => p.external_id));

          const newProducts = products.filter(p => !existingAsins.has(p.asin));
          const knownProducts = products.filter(p => existingAsins.has(p.asin));

          // Salvar apenas produtos novos
          let pageInsertedCount = 0;
          for (const prod of newProducts) {
            try {
              const res = await upsertProduct(prod, SOURCE);
              if (res.status === 'inserted') {
                pageInsertedCount++;
              }
            } catch (err) {
              console.error(`    ❌ Erro ao salvar novo produto ASIN ${prod.asin}:`, err.message);
              summary[term].errors++;
            }
          }

          summary[term].found += products.length;
          summary[term].new += pageInsertedCount;
          summary[term].known += knownProducts.length;
          summary[term].pagesRun++;

          console.log(`    ✔ Resultados da Página ${currentPage}:`);
          console.log(`      - Encontrados: ${products.length} | Novos: ${pageInsertedCount} | Conhecidos: ${knownProducts.length} | Descartados: ${discarded.length}`);
          console.log(`      - Duração da página: ${pageDuration}s`);

          // Atualiza a última página processada no banco a cada página de sucesso
          const { error: updateError } = await supabase
            .from('discovery_state')
            .update({ last_page: currentPage })
            .eq('id', state.id);

          if (updateError) {
            console.error(`    Aviso: Erro ao atualizar last_page para ${currentPage}:`, updateError.message);
          }

          if (currentPage >= MAX_PAGE_LIMIT) {
            console.log(`  - [INFO] Limite final de páginas (${MAX_PAGE_LIMIT}) atingido.`);
            resetToPage1 = true;
            break;
          }

        } catch (error) {
          console.error(`  - [PÁGINA ${currentPage}] Erro durante a rodada:`, error.message);
          summary[term].errors++;
          summary[term].status = error.message.includes('Timeout') ? 'timeout' : 'partial_error';
          
          // Fecha a página atual travada e cria uma nova para o próximo termo limpar estado
          try {
            await page.close();
            page = await context.newPage();
            console.log(`  [INFO] Página de navegação reiniciada para recuperação de erros.`);
          } catch (pageErr) {
            console.error(`  [ERRO] Falha crítica ao reiniciar página:`, pageErr.message);
          }
          // Interrompe as páginas deste termo para prosseguir para o próximo
          break;
        }
      }

      // Reseta para a página 1 se necessário
      if (resetToPage1) {
        const { error: resetError } = await supabase
          .from('discovery_state')
          .update({ last_page: 0 })
          .eq('id', state.id);

        if (resetError) {
          console.error(`  ❌ Erro ao resetar last_page para 0:`, resetError.message);
        } else {
          console.log(`  [LOG] Progresso de descoberta para "${term}" resetado de volta para a página 1.`);
        }
      }

      const termDuration = ((Date.now() - termStartTime) / 1000).toFixed(2);
      console.log(`📊 Termo "${term}" finalizado em ${termDuration}s. Novos cadastrados: ${summary[term].new}.`);
    }
  } finally {
    if (page) await page.close();
    if (context) await context.close();
    if (browser) await browser.close();
  }

  const totalDuration = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log('\n=== RESUMO GERAL DA DESCOBERTA MULTI-TERMOS ===');
  console.log(`Duração Total: ${totalDuration}s`);
  console.log('------------------------------------------------------------');
  console.log('Termo\t\t\t\tStatus\t\tPág.\tEncontrados\tNovos\tConhecidos\tErros');
  console.log('------------------------------------------------------------');
  for (const [term, data] of Object.entries(summary)) {
    const paddedTerm = term.padEnd(25, ' ');
    const paddedStatus = data.status.padEnd(15, ' ');
    console.log(`${paddedTerm}\t${paddedStatus}\t${data.pagesRun}\t${data.found}\t\t${data.new}\t${data.known}\t\t${data.errors}`);
  }
  console.log('============================================================\n');

  return summary;
}

// Executa se rodar diretamente
import { fileURLToPath } from 'url';
const nodePath = fileURLToPath(import.meta.url);
if (process.argv[1] === nodePath) {
  runAmazonDiscovery();
}
