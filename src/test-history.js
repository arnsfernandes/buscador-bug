import { upsertProduct, supabase } from './repositories/products.js';

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runHistoryTest() {
  const testAsin = 'HIST-' + Math.random().toString(36).substring(2, 9).toUpperCase();
  console.log(`=== INICIANDO TESTE CONTROLADO DE HISTÓRICO DE PREÇOS ===`);
  console.log(`ASIN de Teste Gerado: ${testAsin}\n`);

  try {
    const product = {
      asin: testAsin,
      name: 'Notebook Premium de Teste Histórico',
      price: 0, // será alterado
      url: 'https://www.amazon.com.br/dp/' + testAsin
    };

    // Sequência de preços a serem testados
    const priceSequence = [4000, 3900, 3700, 3600, 3500, 3240];
    let productId = null;

    for (let i = 0; i < priceSequence.length; i++) {
      const currentPrice = priceSequence[i];
      product.price = currentPrice;
      
      console.log(`Enviando preço: R$ ${currentPrice}...`);
      const result = await upsertProduct(product);
      productId = result.data.id;
      
      console.log(`- Status: "${result.status}" | Preço Atual no Banco: ${result.data.current_price}`);
      
      // Delay pequeno para garantir timestamps diferentes nas inserções
      await delay(1000);
    }

    // ----------------------------------------------------
    // Validações
    // ----------------------------------------------------
    console.log('\n=== REALIZANDO VALIDAÇÕES NO BANCO REMOTO ===');

    // 1. Verificar preço atual do produto
    const { data: dbProduct, error: prodError } = await supabase
      .from('products')
      .select('*')
      .eq('id', productId)
      .single();

    if (prodError) throw prodError;

    console.log(`✔ Preço atual no produto: R$ ${dbProduct.current_price} (Esperado: 3240)`);
    const isCurrentPriceCorrect = Number(dbProduct.current_price) === 3240;

    // 2. Verificar histórico de preços gravado
    const { data: historyList, error: histError } = await supabase
      .from('price_history')
      .select('*')
      .eq('product_id', productId)
      .order('recorded_at', { ascending: true });

    if (histError) throw histError;

    const recordedPrices = historyList.map(h => Number(h.price));
    console.log(`✔ Histórico de preços registrado: [${recordedPrices.join(', ')}]`);
    console.log(`✔ Esperado: [4000, 3600, 3240]`);

    const expectedPrices = [4000, 3600, 3240];
    const isHistoryCorrect = JSON.stringify(recordedPrices) === JSON.stringify(expectedPrices);

    console.log('\n=== RESULTADO FINAL DO TESTE ===');
    console.log(`- Validação do preço final: ${isCurrentPriceCorrect ? 'PASSOU' : 'FALHOU'}`);
    console.log(`- Validação do histórico filtrado (queda >= 10%): ${isHistoryCorrect ? 'PASSOU' : 'FALHOU'}`);

    if (isCurrentPriceCorrect && isHistoryCorrect) {
      console.log('\n✔ TESTE GERAL DE HISTÓRICO: APROVADO!');
    } else {
      throw new Error('O teste geral falhou devido a divergências nos preços registrados.');
    }

    // ----------------------------------------------------
    // Limpeza
    // ----------------------------------------------------
    console.log('\nLimpando registros de teste do banco remoto...');
    const { error: deleteError } = await supabase
      .from('products')
      .delete()
      .eq('id', productId);

    if (deleteError) {
      console.warn('Aviso: Não foi possível deletar o produto de teste:', deleteError.message);
    } else {
      console.log('Registros de teste excluídos com sucesso do Supabase.');
    }

  } catch (error) {
    console.error('\n❌ Falha durante a execução do teste:', error.message);
  }
}

runHistoryTest();
