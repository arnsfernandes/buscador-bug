import { collectAmazonProducts } from './collectors/amazon.js';
import { upsertProduct, supabase } from './repositories/products.js';
import dotenv from 'dotenv';

dotenv.config();

const SOURCE = 'amazon';
const DEFAULT_TERM = 'notebook';
const PAGES_PER_RUN = parseInt(process.env.DISCOVERY_PAGES_PER_RUN || '10', 10);
const MAX_PAGE_LIMIT = parseInt(process.env.DISCOVERY_MAX_PAGE_LIMIT || '50', 10);

export async function runAmazonDiscovery() {
  console.log('=== INICIANDO DESCOBERTA AMAZON ===');
  console.log(`Hora de início: ${new Date().toLocaleString()}\n`);

  const startTime = Date.now();

  // 1. Obter ou criar o estado de progresso no Supabase
  let { data: state, error: stateError } = await supabase
    .from('discovery_state')
    .select('*')
    .eq('source', SOURCE)
    .eq('search_term', DEFAULT_TERM)
    .maybeSingle();

  if (stateError) {
    console.error('Erro ao obter o estado de progresso:', stateError.message);
    return;
  }

  if (!state) {
    console.log(`[LOG] Estado de progresso não encontrado para "${DEFAULT_TERM}". Criando...`);
    const { data: newState, error: createError } = await supabase
      .from('discovery_state')
      .insert({
        source: SOURCE,
        search_term: DEFAULT_TERM,
        last_page: 0,
        active: true
      })
      .select()
      .single();

    if (createError) {
      console.error('Erro ao criar estado de progresso inicial:', createError.message);
      return;
    }
    state = newState;
  }

  if (!state.active) {
    console.log(`[LOG] A busca para "${DEFAULT_TERM}" está desativada.`);
    return;
  }

  const startPage = state.last_page;
  console.log(`[INFO] Termo pesquisado: "${DEFAULT_TERM}"`);
  console.log(`[INFO] Última página processada: ${startPage}`);
  console.log(`[INFO] Páginas nesta rodada: até ${PAGES_PER_RUN} páginas (iniciando em ${startPage + 1})\n`);

  let currentPage = startPage;
  let totalFound = 0;
  let totalNew = 0;
  let totalKnown = 0;
  let resetToPage1 = false;

  for (let i = 0; i < PAGES_PER_RUN; i++) {
    currentPage++;
    const pageStartTime = Date.now();
    console.log(`[PÁGINA ${currentPage}] Coletando produtos...`);

    try {
      const { products, discarded } = await collectAmazonProducts(DEFAULT_TERM, currentPage);
      const pageDuration = ((Date.now() - pageStartTime) / 1000).toFixed(2);

      if (products.length === 0) {
        console.log(`[PÁGINA ${currentPage}] Nenhum produto válido retornado pela Amazon. Finalizando varredura.`);
        resetToPage1 = true;
        break;
      }

      // Filtrar produtos existentes em lote
      const asins = products.map(p => p.asin);
      const { data: existingProducts, error: selectError } = await supabase
        .from('products')
        .select('external_id')
        .eq('store', SOURCE)
        .in('external_id', asins);

      if (selectError) {
        throw new Error(`Erro ao consultar produtos existentes no lote: ${selectError.message}`);
      }

      const existingAsins = new Set(existingProducts.map(p => p.external_id));

      const newProducts = products.filter(p => !existingAsins.has(p.asin));
      const knownProducts = products.filter(p => existingAsins.has(p.asin));

      // Salvar produtos novos
      let pageInserted = 0;
      for (const prod of newProducts) {
        try {
          const res = await upsertProduct(prod);
          if (res.status === 'inserted') {
            pageInserted++;
          }
        } catch (err) {
          console.error(`Erro ao inserir produto novo ASIN ${prod.asin}:`, err.message);
        }
      }

      totalFound += products.length;
      totalNew += pageInserted;
      totalKnown += knownProducts.length;

      console.log(`[PÁGINA ${currentPage}] Resultados:`);
      console.log(`  - Encontrados: ${products.length}`);
      console.log(`  - Novos (inseridos): ${pageInserted}`);
      console.log(`  - Conhecidos (pulados): ${knownProducts.length}`);
      console.log(`  - Descartados: ${discarded.length}`);
      console.log(`  - Duração: ${pageDuration}s\n`);

      // Atualiza o estado da última página no banco a cada página processada com sucesso
      const { error: updateError } = await supabase
        .from('discovery_state')
        .update({ last_page: currentPage })
        .eq('id', state.id);

      if (updateError) {
        console.error(`Aviso: Erro ao atualizar o progresso no banco para a página ${currentPage}:`, updateError.message);
      }

      if (currentPage >= MAX_PAGE_LIMIT) {
        console.log(`[INFO] Limite final de páginas atingido (${MAX_PAGE_LIMIT}). A próxima rodada reiniciará na página 1.`);
        resetToPage1 = true;
        break;
      }

    } catch (error) {
      console.error(`[PÁGINA ${currentPage}] Erro durante a execução da página:`, error.message);
      // Se deu erro, paramos a rodada para não pular páginas com erro
      break;
    }
  }

  // Se a busca acabou ou bateu o limite máximo, reseta a contagem de páginas para 1
  if (resetToPage1) {
    const { error: resetError } = await supabase
      .from('discovery_state')
      .update({ last_page: 0 })
      .eq('id', state.id);

    if (resetError) {
      console.error('Erro ao resetar progresso para a página 1:', resetError.message);
    } else {
      console.log('[LOG] Progresso de descoberta resetado para a página 1.');
    }
  }

  const totalDuration = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log('=== RESUMO DA EXECUÇÃO ===');
  console.log(`- Termo pesquisado: ${DEFAULT_TERM}`);
  console.log(`- Páginas percorridas nesta rodada: ${currentPage - startPage}`);
  console.log(`- Total de produtos encontrados: ${totalFound}`);
  console.log(`- Total de produtos novos cadastrados: ${totalNew}`);
  console.log(`- Total de produtos conhecidos ignorados: ${totalKnown}`);
  console.log(`- Duração total: ${totalDuration}s`);
  console.log('===========================\n');
}

// Executa se rodar diretamente
import { fileURLToPath } from 'url';
const nodePath = fileURLToPath(import.meta.url);
if (process.argv[1] === nodePath) {
  runAmazonDiscovery();
}
