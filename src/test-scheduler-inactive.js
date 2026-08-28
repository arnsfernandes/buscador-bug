import { getProductPriorityAndEligibility } from './run-amazon-monitor.js';
import { upsertProduct, supabase } from './repositories/products.js';

async function testSchedulerInactive() {
  console.log('=== TESTANDO INTEGRAÇÃO DE PRODUTOS INATIVOS AO AGENDADOR ===\n');

  const testAsin = 'TEST-ASIN-SCHEDULER-INACTIVE';
  const testProduct = {
    asin: testAsin,
    name: 'SSD de Teste Inativo Agendador',
    price: 499.00,
    url: 'https://www.amazon.com.br/dp/TEST-ASIN-SCHEDULER-INACTIVE'
  };

  try {
    // 0. Garante que o produto existe inicialmente
    console.log('0. Inserindo produto inicial...');
    const insertRes = await upsertProduct(testProduct, 'amazon');
    const dbProduct = insertRes.data;

    const now = new Date();

    // Caso 1: inactive com 2 dias atrás
    console.log('\n1. Testando: inactive com 2 dias de indisponibilidade (deve ser NÃO elegível)...');
    const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
    const mockProd2d = {
      ...dbProduct,
      availability_status: 'inactive',
      last_unavailable_at: twoDaysAgo.toISOString(),
      last_checked_at: twoDaysAgo.toISOString()
    };
    
    let evaluation = getProductPriorityAndEligibility(mockProd2d, now);
    console.log('Resultado da avaliação (2d):', {
      isEligible: evaluation.isEligible,
      delayMinutes: evaluation.delayMinutes,
      reason: evaluation.reason
    });
    if (evaluation.isEligible === false) {
      console.log('✔ Sucesso: Produto inativo com 2 dias não ficou elegível.');
    } else {
      console.error('❌ Falha: Produto inativo com 2 dias ficou elegível incorretamente.');
    }

    // Caso 2: inactive com 8 dias atrás
    console.log('\n2. Testando: inactive com 8 dias de indisponibilidade (deve ser ELEGÍVEL)...');
    const eightDaysAgo = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000);
    const mockProd8d = {
      ...dbProduct,
      availability_status: 'inactive',
      last_unavailable_at: eightDaysAgo.toISOString(),
      last_checked_at: eightDaysAgo.toISOString()
    };

    evaluation = getProductPriorityAndEligibility(mockProd8d, now);
    console.log('Resultado da avaliação (8d):', {
      isEligible: evaluation.isEligible,
      delayMinutes: evaluation.delayMinutes,
      reason: evaluation.reason
    });
    if (evaluation.isEligible === true) {
      console.log('✔ Sucesso: Produto inativo com 8 dias ficou elegível.');
    } else {
      console.error('❌ Falha: Produto inativo com 8 dias não ficou elegível.');
    }

    // Caso 3: recuperação com preço
    console.log('\n3. Testando recuperação de inativo com preço (deve voltar para active)...');
    const recoveryRes = await upsertProduct(testProduct, 'amazon');
    console.log('Resultado da recuperação:', {
      availability_status: recoveryRes.data.availability_status,
      consecutive_unavailable: recoveryRes.data.consecutive_unavailable,
      last_available_at: recoveryRes.data.last_available_at
    });
    if (recoveryRes.data.availability_status === 'active' && recoveryRes.data.consecutive_unavailable === 0) {
      console.log('✔ Sucesso: Produto inativo recuperou o status active e resetou as falhas.');
    } else {
      console.error('❌ Falha: Produto inativo não recuperou o status corretamente.');
    }

    // Limpeza
    console.log('\n4. Limpando o produto de teste do banco...');
    await supabase.from('price_history').delete().eq('product_id', dbProduct.id);
    await supabase.from('products').delete().eq('id', dbProduct.id);
    console.log('✔ Limpeza concluída.');

    console.log('\n✔ Todos os testes de agendamento de inativos finalizados com sucesso!');

  } catch (error) {
    console.error('❌ ERRO NO TESTE DO AGENDADOR DE INATIVOS:', error.message);
  }
}

testSchedulerInactive();
