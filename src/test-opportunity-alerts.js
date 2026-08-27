import { upsertProduct, supabase } from './repositories/products.js';
import { checkAndNotifyOpportunity } from './services/opportunity-notifier.js';

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runOpportunityAlertsTest() {
  const testAsin = 'ALERT-TEL-' + Math.random().toString(36).substring(2, 9).toUpperCase();
  console.log(`=== INICIANDO TESTE DE ALERTAS DE OPORTUNIDADE COM TELEGRAM ===`);
  console.log(`ASIN de Teste Gerado: ${testAsin}\n`);

  try {
    const product = {
      asin: testAsin,
      name: 'Notebook Pro Ultra (Teste Alerta Telegram)',
      price: 0,
      url: 'https://www.amazon.com.br/dp/' + testAsin
    };

    // Sequência de preços
    const testCases = [
      { price: 4000, desc: 'Preço inicial (Referência: 4000)' },
      { price: 2350, desc: 'Queda para 2350 (41% de queda -> great_opportunity)' },
      { price: 2200, desc: 'Queda para 2200 (45% de queda -> continua great_opportunity)' },
      { price: 1550, desc: 'Queda para 1550 (61% de queda -> evolui para bug)' },
      { price: 1400, desc: 'Queda para 1400 (65% de queda -> continua bug)' }
    ];

    let productId = null;
    const sentAlerts = [];

    for (const testCase of testCases) {
      console.log(`\nProcessando preço R$ ${testCase.price}... (${testCase.desc})`);
      product.price = testCase.price;

      // Executa o upsert no Supabase
      const result = await upsertProduct(product);
      productId = result.data.id;

      // Dispara notificação caso a regra indique
      const telegramResult = await checkAndNotifyOpportunity(result);

      if (telegramResult) {
        console.log(`[TELEGRAM] Alerta disparado para o preço R$ ${testCase.price}!`);
        sentAlerts.push({
          price: testCase.price,
          level: result.data.last_opportunity_level,
          messageId: telegramResult.result.message_id
        });
      } else {
        console.log(`[TELEGRAM] Nenhum alerta enviado para R$ ${testCase.price}.`);
      }

      await delay(1500); // pequeno delay entre requisições
    }

    console.log('\n=== REALIZANDO VALIDAÇÃO FINAL ===');
    console.log(`- Total de alertas enviados ao Telegram: ${sentAlerts.length} (Esperado: 2)`);
    sentAlerts.forEach((alert, index) => {
      console.log(`  Alerta ${index + 1}: Nível "${alert.level}" no preço R$ ${alert.price} (Msg ID: ${alert.messageId})`);
    });

    const isTestPassed = sentAlerts.length === 2 &&
                         sentAlerts[0].level === 'great_opportunity' &&
                         sentAlerts[1].level === 'bug';

    if (isTestPassed) {
      console.log('\n✔ TESTE DE INTEGRAÇÃO TELEGRAM + ALERTAS: APROVADO!');
    } else {
      throw new Error('O teste falhou nas asserções de alertas disparados.');
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

runOpportunityAlertsTest();
