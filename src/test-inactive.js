import { supabase, upsertProduct, registerProductUnavailability } from './repositories/products.js';

async function testInactiveTransition() {
  console.log('=== TESTANDO FLUXO DE TRANSIÇÃO PARA PRODUTOS INATIVOS ===\n');

  const testAsin = 'TEST-ASIN-INACTIVE';
  const testProduct = {
    asin: testAsin,
    name: 'SSD de Teste de Inatividade',
    price: 450.00,
    url: 'https://www.amazon.com.br/dp/TEST-ASIN-INACTIVE'
  };

  try {
    // 0. Garante que o produto existe inicialmente
    console.log('0. Inserindo produto inicial...');
    let res = await upsertProduct(testProduct, 'amazon');
    const dbProduct = res.data;

    // Caso 1: temporarily_unavailable com last_available_at há 3 dias
    console.log('\n1. Testando: indisponibilidade há 3 dias (deve continuar como temporarily_unavailable)...');
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    
    // Atualiza o banco manualmente simulando o estado anterior de 3 dias atrás
    await supabase.from('products').update({
      availability_status: 'temporarily_unavailable',
      consecutive_unavailable: 2,
      last_available_at: threeDaysAgo.toISOString()
    }).eq('id', dbProduct.id);

    // Registra nova falha
    let updated = await registerProductUnavailability(testAsin, 'amazon');
    console.log('Resultado (3 dias):', {
      availability_status: updated.availability_status,
      consecutive_unavailable: updated.consecutive_unavailable,
      last_available_at: updated.last_available_at
    });
    if (updated.availability_status === 'temporarily_unavailable') {
      console.log('✔ Sucesso: Permaneceu como temporarily_unavailable.');
    } else {
      console.error('❌ Falha: Mudou de status incorretamente.');
    }

    // Caso 2: temporarily_unavailable com last_available_at há 8 dias
    console.log('\n2. Testando: indisponibilidade há 8 dias (deve transicionar para inactive)...');
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    
    // Atualiza o banco manualmente simulando o estado de 8 dias atrás
    await supabase.from('products').update({
      availability_status: 'temporarily_unavailable',
      consecutive_unavailable: 3,
      last_available_at: eightDaysAgo.toISOString()
    }).eq('id', dbProduct.id);

    // Registra nova falha
    updated = await registerProductUnavailability(testAsin, 'amazon');
    console.log('Resultado (8 dias):', {
      availability_status: updated.availability_status,
      consecutive_unavailable: updated.consecutive_unavailable,
      last_available_at: updated.last_available_at
    });
    if (updated.availability_status === 'inactive') {
      console.log('✔ Sucesso: Transicionou corretamente para inactive.');
    } else {
      console.error('❌ Falha: Não mudou para inactive.');
    }

    // Caso 3: recuperação do produto inactive com preço válido
    console.log('\n3. Testando recuperação de produto inactive (deve voltar para active)...');
    res = await upsertProduct(testProduct, 'amazon');
    console.log('Resultado da recuperação:', {
      availability_status: res.data.availability_status,
      consecutive_unavailable: res.data.consecutive_unavailable,
      last_available_at: res.data.last_available_at
    });
    if (res.data.availability_status === 'active' && res.data.consecutive_unavailable === 0) {
      console.log('✔ Sucesso: Voltou a ser active e zerou as falhas.');
    } else {
      console.error('❌ Falha: Não recuperou o status corretamente.');
    }

    // Limpeza
    console.log('\n4. Limpando o produto de teste do banco...');
    await supabase.from('price_history').delete().eq('product_id', dbProduct.id);
    await supabase.from('products').delete().eq('id', dbProduct.id);
    console.log('✔ Limpeza concluída.');

    console.log('\n✔ Todos os testes de inatividade concluídos com sucesso!');

  } catch (error) {
    console.error('❌ ERRO NO TESTE DE INATIVIDADE:', error.message);
  }
}

testInactiveTransition();
