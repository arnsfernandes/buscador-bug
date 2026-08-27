import { upsertProduct, supabase } from './repositories/products.js';
import { detectOpportunity } from './services/opportunity-detector.js';

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runOpportunitiesTest() {
  const testAsin = 'OPP-' + Math.random().toString(36).substring(2, 9).toUpperCase();
  console.log(`=== INICIANDO TESTES DE DETECÇÃO DE OPORTUNIDADES ===`);
  console.log(`ASIN de Teste Gerado: ${testAsin}\n`);

  try {
    const product = {
      asin: testAsin,
      name: 'Notebook Pro de Teste Oportunidade',
      price: 4000.00, // Preço inicial / Referência
      url: 'https://www.amazon.com.br/dp/' + testAsin
    };

    // 1. Inserir produto com preço inicial (4000.00)
    console.log('Inserindo produto novo com preço inicial R$ 4000.00...');
    const insertResult = await upsertProduct(product);
    const productId = insertResult.data.id;
    console.log(`- reference_price salvo: R$ ${insertResult.data.reference_price}`);
    console.log(`- current_price salvo: R$ ${insertResult.data.current_price}\n`);

    if (Number(insertResult.data.reference_price) !== 4000.00) {
      throw new Error('Falha: Preço de referência não foi salvo corretamente na inserção.');
    }

    // Sequência de simulação de preços
    const testCases = [
      { price: 3600.00, expectedClass: 'none' },              // Queda de 10%
      { price: 2400.00, expectedClass: 'great_opportunity' }, // Queda de 40%
      { price: 2000.00, expectedClass: 'great_opportunity' }, // Queda de 50%
      { price: 1600.00, expectedClass: 'bug' },               // Queda de 60%
      { price: 700.00, expectedClass: 'bug' }                 // Queda de 82.5%
    ];

    let allClassificationsPassed = true;

    for (const testCase of testCases) {
      console.log(`\nAtualizando preço para R$ ${testCase.price}...`);
      product.price = testCase.price;
      const updateResult = await upsertProduct(product);

      const currentRef = Number(updateResult.data.reference_price);
      const currentPrice = Number(updateResult.data.current_price);
      
      console.log(`- reference_price no banco: R$ ${currentRef} (Esperado: 4000)`);
      console.log(`- current_price no banco: R$ ${currentPrice}`);

      if (currentRef !== 4000.00) {
        throw new Error('Erro: O preço de referência original foi alterado incorretamente!');
      }

      // Rodar o detector de oportunidades
      const classification = detectOpportunity(currentPrice, currentRef);
      const dropPct = (((currentRef - currentPrice) / currentRef) * 100).toFixed(1);
      console.log(`- Queda calculada: ${dropPct}% | Classificação: "${classification}" (Esperado: "${testCase.expectedClass}")`);

      if (classification !== testCase.expectedClass) {
        console.error(`❌ FALHA: Esperava "${testCase.expectedClass}", mas obteve "${classification}"`);
        allClassificationsPassed = false;
      } else {
        console.log('✔ Classificação OK');
      }

      await delay(1000);
    }

    console.log('\n=== RESULTADO FINAL DO EXPERIMENTO ===');
    console.log(`- Validação do preço de referência fixo: PASSOU`);
    console.log(`- Validação de todas as classificações (none, great_opportunity, bug): ${allClassificationsPassed ? 'PASSOU' : 'FALHOU'}`);

    if (allClassificationsPassed) {
      console.log('\n✔ TESTE DE OPORTUNIDADES: APROVADO!');
    } else {
      throw new Error('O teste de oportunidades falhou em uma ou mais classificações.');
    }

    // Limpeza
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

runOpportunitiesTest();
