import { supabase, upsertProduct, registerProductUnavailability } from './repositories/products.js';

async function testAvailability() {
  console.log('=== TESTANDO FLUXO DE INDISPONIBILIDADE DE PRODUTOS ===\n');

  const testAsin = 'TEST-ASIN-AVAILABILITY';
  const testProduct = {
    asin: testAsin,
    name: 'Teclado Mecânico Gamer de Teste',
    price: 350.00,
    url: 'https://www.amazon.com.br/dp/TEST-ASIN-AVAILABILITY'
  };

  try {
    // 0. Criação inicial com sucesso
    console.log('0. Efetuando upsert inicial (sucesso com preço)...');
    let res = await upsertProduct(testProduct, 'amazon');
    console.log('Status inicial no banco:', {
      availability_status: res.data.availability_status,
      consecutive_unavailable: res.data.consecutive_unavailable,
      last_available_at: res.data.last_available_at,
      last_unavailable_at: res.data.last_unavailable_at
    });
    console.log('--------------------------------------------------');

    // 1. Falha 1
    console.log('1. Registrando primeira falha por indisponibilidade...');
    res.data = await registerProductUnavailability(testAsin, 'amazon');
    console.log('Após Falha 1:', {
      availability_status: res.data.availability_status,
      consecutive_unavailable: res.data.consecutive_unavailable,
      last_unavailable_at: res.data.last_unavailable_at
    });
    console.log('--------------------------------------------------');

    // 2. Falha 2
    console.log('2. Registrando segunda falha por indisponibilidade...');
    res.data = await registerProductUnavailability(testAsin, 'amazon');
    console.log('Após Falha 2:', {
      availability_status: res.data.availability_status,
      consecutive_unavailable: res.data.consecutive_unavailable,
      last_unavailable_at: res.data.last_unavailable_at
    });
    console.log('--------------------------------------------------');

    // 3. Falha 3 (Deve mudar para temporarily_unavailable)
    console.log('3. Registrando terceira falha por indisponibilidade (Deve marcar como temporarily_unavailable)...');
    res.data = await registerProductUnavailability(testAsin, 'amazon');
    console.log('Após Falha 3:', {
      availability_status: res.data.availability_status,
      consecutive_unavailable: res.data.consecutive_unavailable,
      last_unavailable_at: res.data.last_unavailable_at
    });
    console.log('--------------------------------------------------');

    // 4. Recuperação (Deve voltar para active e resetar falhas)
    console.log('4. Registrando recuperação (sucesso de coleta com preço)...');
    res = await upsertProduct(testProduct, 'amazon');
    console.log('Após Recuperação:', {
      availability_status: res.data.availability_status,
      consecutive_unavailable: res.data.consecutive_unavailable,
      last_available_at: res.data.last_available_at,
      last_unavailable_at: res.data.last_unavailable_at
    });
    console.log('--------------------------------------------------');

    // Limpar o produto de teste do banco
    console.log('5. Limpando o produto de teste do banco...');
    await supabase.from('price_history').delete().eq('product_id', res.data.id);
    await supabase.from('products').delete().eq('id', res.data.id);
    console.log('✔ Limpeza concluída.');

    console.log('\n✔ Teste de fluxo de indisponibilidade finalizado com sucesso!');

  } catch (error) {
    console.error('❌ ERRO NO TESTE DE INDISPONIBILIDADE:', error.message);
  }
}

testAvailability();
