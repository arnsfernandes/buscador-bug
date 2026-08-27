import { upsertProduct, supabase } from './repositories/products.js';

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTests() {
  const testAsin = 'TEST-' + Math.random().toString(36).substring(2, 9).toUpperCase();
  console.log(`=== INICIANDO TESTES DE PERSISTÊNCIA NO SUPABASE ===`);
  console.log(`ASIN de Teste Gerado: ${testAsin}\n`);

  try {
    // ----------------------------------------------------
    // Teste 1: Inserção inicial
    // ----------------------------------------------------
    console.log('Teste 1: Inserindo produto novo...');
    const prod1 = {
      asin: testAsin,
      name: 'Notebook de Teste Supabase',
      price: 3000.00,
      url: 'https://www.amazon.com.br/dp/' + testAsin
    };

    const res1 = await upsertProduct(prod1);
    console.log(`- Status retornado: "${res1.status}"`);
    console.log(`- ID Gerado: ${res1.data.id}`);
    console.log(`- Preço Atual: ${res1.data.current_price}`);
    console.log(`- Preço Anterior: ${res1.data.previous_price} (Esperado: null)`);
    console.log(`- price_changed_at: ${res1.data.price_changed_at} (Esperado: null)`);
    
    if (res1.status !== 'inserted' || res1.data.previous_price !== null) {
      throw new Error('Falha no Teste 1: Inserção inicial incorreta.');
    }
    console.log('✔ Teste 1: PASSOU\n');

    // Aguarda um pequeno delay para os timestamps se diferenciarem se necessário
    await delay(1000);

    // ----------------------------------------------------
    // Teste 2: Gravação com o mesmo preço
    // ----------------------------------------------------
    console.log('Teste 2: Gravando o mesmo produto com o mesmo preço...');
    const prod2 = {
      asin: testAsin,
      name: 'Notebook de Teste Supabase (Nome Atualizado)',
      price: 3000.00,
      url: 'https://www.amazon.com.br/dp/' + testAsin + '-new'
    };

    const res2 = await upsertProduct(prod2);
    console.log(`- Status retornado: "${res2.status}" (Esperado: "updated")`);
    console.log(`- Nome no Banco: "${res2.data.name}"`);
    console.log(`- URL no Banco: "${res2.data.url}"`);
    console.log(`- Preço Atual: ${res2.data.current_price}`);
    console.log(`- Preço Anterior: ${res2.data.previous_price} (Esperado: null)`);
    console.log(`- price_changed_at: ${res2.data.price_changed_at} (Esperado: null)`);

    if (res2.status !== 'updated' || res2.data.name !== prod2.name || res2.data.previous_price !== null) {
      throw new Error('Falha no Teste 2: Gravação com mesmo preço incorreta.');
    }
    console.log('✔ Teste 2: PASSOU\n');

    await delay(1000);

    // ----------------------------------------------------
    // Teste 3: Gravação com mudança de preço
    // ----------------------------------------------------
    console.log('Teste 3: Gravando com mudança de preço (3000.00 -> 2500.00)...');
    const prod3 = {
      asin: testAsin,
      name: 'Notebook de Teste Supabase (Nome Atualizado)',
      price: 2500.00,
      url: 'https://www.amazon.com.br/dp/' + testAsin + '-new'
    };

    const res3 = await upsertProduct(prod3);
    console.log(`- Status retornado: "${res3.status}" (Esperado: "price_changed")`);
    console.log(`- Preço Atual: ${res3.data.current_price} (Esperado: 2500)`);
    console.log(`- Preço Anterior (previous_price): ${res3.data.previous_price} (Esperado: 3000)`);
    console.log(`- price_changed_at: ${res3.data.price_changed_at} (Esperado: timestamp atual)`);

    if (res3.status !== 'price_changed' || Number(res3.data.current_price) !== 2500 || Number(res3.data.previous_price) !== 3000 || !res3.data.price_changed_at) {
      throw new Error('Falha no Teste 3: Mudança de preço incorreta.');
    }
    console.log('✔ Teste 3: PASSOU\n');

    // ----------------------------------------------------
    // Teste 4: Ausência de duplicidade no banco
    // ----------------------------------------------------
    console.log('Teste 4: Validando ausência de duplicidade de ASIN no banco de dados...');
    const { data: duplicateCheck, error: checkError } = await supabase
      .from('products')
      .select('*')
      .eq('store', 'amazon')
      .eq('external_id', testAsin);

    if (checkError) {
      throw new Error(`Erro na consulta de duplicidade: ${checkError.message}`);
    }

    console.log(`- Registros encontrados para o ASIN ${testAsin}: ${duplicateCheck.length} (Esperado: 1)`);
    if (duplicateCheck.length !== 1) {
      throw new Error('Falha no Teste 4: Mais de um registro encontrado para o mesmo ASIN.');
    }
    console.log('✔ Teste 4: PASSOU\n');

    // ----------------------------------------------------
    // Limpeza (Clean up do registro de teste)
    // ----------------------------------------------------
    console.log('Limpando registro de teste do banco remoto...');
    const { error: deleteError } = await supabase
      .from('products')
      .delete()
      .eq('id', res3.data.id);

    if (deleteError) {
      console.warn('Aviso: Não foi possível deletar o registro de teste:', deleteError.message);
    } else {
      console.log('Registro de teste removido com sucesso.');
    }

    console.log('\n=== TODOS OS TESTES PASSARAM COM SUCESSO! ===');

  } catch (error) {
    console.error('\n❌ Falha no teste de persistência:', error.message);
  }
}

runTests();
