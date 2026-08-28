import { getProductPriorityAndEligibility } from './run-amazon-monitor.js';
import { upsertProduct, supabase } from './repositories/products.js';

async function testSchedulerAvailability() {
  console.log('=== TESTANDO INTEGRAÇÃO DE INDISPONIBILIDADE AO AGENDADOR ===\n');

  const testAsin = 'TEST-ASIN-SCHEDULER';
  const testProduct = {
    asin: testAsin,
    name: 'SSD de Teste do Agendador',
    price: 400.00,
    url: 'https://www.amazon.com.br/dp/TEST-ASIN-SCHEDULER'
  };

  try {
    // 0. Garante que o produto existe inicialmente
    console.log('0. Inserindo produto inicial...');
    const insertRes = await upsertProduct(testProduct, 'amazon');
    const dbProduct = insertRes.data;

    const now = new Date();

    // Caso 1: temporarily_unavailable com 2 horas atrás
    console.log('\n1. Testando: temporarily_unavailable com 2 horas de atraso...');
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    const mockProd2h = {
      ...dbProduct,
      availability_status: 'temporarily_unavailable',
      last_unavailable_at: twoHoursAgo.toISOString(),
      last_checked_at: twoHoursAgo.toISOString()
    };
    
    let evaluation = getProductPriorityAndEligibility(mockProd2h, now);
    console.log('Resultado da avaliação (2h):', {
      isEligible: evaluation.isEligible,
      delayMinutes: evaluation.delayMinutes,
      reason: evaluation.reason
    });
    if (evaluation.isEligible === false) {
      console.log('✔ Sucesso: Produto com 2h não ficou elegível.');
    } else {
      console.error('❌ Falha: Produto com 2h ficou elegível incorretamente.');
    }

    // Caso 2: temporarily_unavailable com 7 horas atrás
    console.log('\n2. Testando: temporarily_unavailable com 7 horas de atraso...');
    const sevenHoursAgo = new Date(now.getTime() - 7 * 60 * 60 * 1000);
    const mockProd7h = {
      ...dbProduct,
      availability_status: 'temporarily_unavailable',
      last_unavailable_at: sevenHoursAgo.toISOString(),
      last_checked_at: sevenHoursAgo.toISOString()
    };

    evaluation = getProductPriorityAndEligibility(mockProd7h, now);
    console.log('Resultado da avaliação (7h):', {
      isEligible: evaluation.isEligible,
      delayMinutes: evaluation.delayMinutes,
      reason: evaluation.reason
    });
    if (evaluation.isEligible === true) {
      console.log('✔ Sucesso: Produto com 7h ficou elegível.');
    } else {
      console.error('❌ Falha: Produto com 7h não ficou elegível.');
    }

    // Caso 3: recuperação com preço
    console.log('\n3. Testando recuperação de preço (Voltar para active)...');
    console.log('Atualizando o produto simulando uma nova checagem com preço válido...');
    const recoveryRes = await upsertProduct(testProduct, 'amazon');
    console.log('Resultado da recuperação:', {
      availability_status: recoveryRes.data.availability_status,
      consecutive_unavailable: recoveryRes.data.consecutive_unavailable,
      last_available_at: recoveryRes.data.last_available_at
    });
    if (recoveryRes.data.availability_status === 'active' && recoveryRes.data.consecutive_unavailable === 0) {
      console.log('✔ Sucesso: Produto recuperou o status active e resetou as falhas.');
    } else {
      console.error('❌ Falha: Produto não recuperou o status corretamente.');
    }

    // Limpeza
    console.log('\n4. Limpando o produto de teste do banco...');
    await supabase.from('price_history').delete().eq('product_id', dbProduct.id);
    await supabase.from('products').delete().eq('id', dbProduct.id);
    console.log('✔ Limpeza concluída.');

    console.log('\n✔ Todos os testes do agendador finalizados com sucesso!');

  } catch (error) {
    console.error('❌ ERRO NO TESTE DO AGENDADOR:', error.message);
  }
}

testSchedulerAvailability();
