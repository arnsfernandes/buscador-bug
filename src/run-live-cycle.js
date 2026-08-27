import { collectAmazonProducts } from './collectors/amazon.js';
import { upsertProduct, supabase } from './repositories/products.js';
import { checkAndNotifyOpportunity } from './services/opportunity-notifier.js';

export async function runLiveCycle() {
  console.log('=== INICIANDO EXECUÇÃO DO CICLO REAL ===');
  console.log(`Hora de início: ${new Date().toLocaleString()}\n`);

  const stats = {
    collected: 0,
    inserted: 0,
    updatedSamePrice: 0,
    priceChanged: 0,
    greatOpportunities: 0,
    bugs: 0,
    alertsSent: 0,
    failures: 0,
    totalInDb: 0
  };

  try {
    // 1. Coleta na Amazon Brasil
    console.log('[LOG] Início da coleta Amazon...');
    const { products, discarded } = await collectAmazonProducts('notebook');
    stats.collected = products.length;
    console.log(`[LOG] Fim da coleta Amazon. Encontrados ${stats.collected} produtos válidos. (Descartados: ${discarded.length})\n`);

    // 2. Processa cada produto pelo fluxo de persistência e detecção de oportunidades
    console.log('[LOG] Início do processamento no Supabase...');
    
    let processedCount = 0;
    for (const prod of products) {
      processedCount++;
      if (processedCount % 10 === 0 || processedCount === products.length) {
        console.log(`[LOG] Processamento: ${processedCount}/${products.length} produtos processados no Supabase...`);
      }

      try {
        const result = await upsertProduct(prod);

        // Atualizar estatísticas de persistência
        if (result.status === 'inserted') {
          stats.inserted++;
        } else if (result.status === 'price_changed') {
          stats.priceChanged++;
        } else if (result.status === 'updated') {
          stats.updatedSamePrice++;
        }

        // Se ocorreu alerta, processar classificação do alerta
        const level = result.data.last_opportunity_level;
        if (level === 'great_opportunity') {
          stats.greatOpportunities++;
        } else if (level === 'bug') {
          stats.bugs++;
        }

        // Dispara o Telegram se for elegível (shouldAlert = true)
        const telegramResult = await checkAndNotifyOpportunity(result);
        if (telegramResult) {
          stats.alertsSent++;
          console.log(`[ALERTA DISPARADO] ${level.toUpperCase()}: "${prod.name.substring(0, 50)}..." no preço R$ ${prod.price}`);
        }
      } catch (err) {
        stats.failures++;
        console.error(`Erro ao processar ASIN ${prod.asin}:`, err.stack || err.message);
      }
    }

    // 3. Obter total de produtos Amazon na base de dados
    const { count, error: countError } = await supabase
      .from('products')
      .select('*', { count: 'exact', head: true })
      .eq('store', 'amazon');

    if (countError) {
      throw countError;
    }
    stats.totalInDb = count;

    console.log('\n=== CICLO COMPLETO EXECUTADO COM SUCESSO ===');
    console.log('Métricas finais:');
    console.log(`- Coletados da Amazon: ${stats.collected}`);
    console.log(`- Inseridos (Novos): ${stats.inserted}`);
    console.log(`- Atualizados (Mesmo Preço): ${stats.updatedSamePrice}`);
    console.log(`- Mudanças de preço detectadas: ${stats.priceChanged}`);
    console.log(`- Nível Great Opportunity atual ativo: ${stats.greatOpportunities}`);
    console.log(`- Nível Bug atual ativo: ${stats.bugs}`);
    console.log(`- Alertas enviados ao Telegram: ${stats.alertsSent}`);
    console.log(`- Falhas de processamento: ${stats.failures}`);
    console.log(`- Total de produtos Amazon na base: ${stats.totalInDb}`);

  } catch (error) {
    console.error('\n❌ Erro geral durante o ciclo de processamento:', error.message);
  }
}

// Executa se rodar diretamente
import { fileURLToPath } from 'url';
const nodePath = fileURLToPath(import.meta.url);
if (process.argv[1] === nodePath) {
  runLiveCycle();
}
