import { upsertProduct, supabase } from './repositories/products.js';

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runAlertRepetitionTest() {
  const testAsin = 'ALERT-' + Math.random().toString(36).substring(2, 9).toUpperCase();
  console.log(`=== INICIANDO TESTE DE CONTROLE DE REPETIÇÃO DE ALERTAS ===`);
  console.log(`ASIN de Teste Gerado: ${testAsin}\n`);

  try {
    const product = {
      asin: testAsin,
      name: 'Notebook de Teste para Repetição de Alertas',
      price: 0,
      url: 'https://www.amazon.com.br/dp/' + testAsin
    };

    // Sequência de preços a testar
    const testCases = [
      { price: 4000, expectedAlert: false, desc: 'Inserção inicial (Referência: 4000)' },
      { price: 2350, expectedAlert: true,  desc: 'Queda para 2350 (41.25% de queda -> great_opportunity)' },
      { price: 2200, expectedAlert: false, desc: 'Queda para 2200 (45% de queda -> continua great_opportunity)' },
      { price: 1550, expectedAlert: true,  desc: 'Queda para 1550 (61.25% de queda -> evolui para bug)' },
      { price: 1400, expectedAlert: false, desc: 'Queda para 1400 (65% de queda -> continua bug)' }
    ];

    const alertsTriggered = [];
    let productId = null;

    for (const testCase of testCases) {
      console.log(`\nAtualizando preço para R$ ${testCase.price}... (${testCase.desc})`);
      product.price = testCase.price;

      const result = await upsertProduct(product);
      productId = result.data.id;

      console.log(`- Preço no Banco: R$ ${result.data.current_price}`);
      console.log(`- Nível de oportunidade salvo no banco: "${result.data.last_opportunity_level}"`);
      console.log(`- Sinalizar Alerta? ${result.shouldAlert ? 'SIM' : 'NÃO'}`);

      if (result.shouldAlert) {
        alertsTriggered.push({
          price: testCase.price,
          level: result.data.last_opportunity_level
        });
      }

      if (result.shouldAlert !== testCase.expectedAlert) {
        console.error(`❌ FALHA: Esperava shouldAlert = ${testCase.expectedAlert}, mas obteve ${result.shouldAlert}`);
      } else {
        console.log('✔ Alert logic OK');
      }

      await delay(1000);
    }

    console.log('\n=== REALIZANDO VALIDAÇÃO FINAL ===');
    console.log(`- Total de alertas disparados: ${alertsTriggered.length} (Esperado: 2)`);
    alertsTriggered.forEach((alert, index) => {
      console.log(`  Alert ${index + 1}: Nível "${alert.level}" no preço R$ ${alert.price}`);
    });

    const isTestPassed = alertsTriggered.length === 2 &&
                         alertsTriggered[0].level === 'great_opportunity' &&
                         alertsTriggered[1].level === 'bug';

    if (isTestPassed) {
      console.log('\n✔ TESTE DE REPETIÇÃO DE ALERTAS: APROVADO!');
    } else {
      throw new Error('O teste de repetição de alertas falhou nas asserções.');
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

runAlertRepetitionTest();
