import { detectOpportunity } from './services/opportunity-detector.js';
import { upsertProduct, supabase } from './repositories/products.js';

async function runTwoPathBugTests() {
  console.log('=== INICIANDO BATERIA DE TESTES DE DETECÇÃO DE BUG POR DUAS FONTES ===\n');

  let failed = 0;

  // Teste 1: Produto novo com preço atual 200 e originalPrice 1000 => deve classificar como bug
  console.log('Teste 1: Produto novo com preço atual 200 e originalPrice 1000...');
  const res1 = detectOpportunity(200.00, 200.00, 1000.00);
  console.log('Resultado:', res1);
  if (res1 === 'bug') {
    console.log('✔ Sucesso: Classificado como BUG.');
  } else {
    console.error('❌ Falha: Não detectou BUG.');
    failed++;
  }
  console.log('--------------------------------------------------');

  // Teste 2: Produto novo sem originalPrice => não vira bug apenas por ser novo
  console.log('Teste 2: Produto novo sem originalPrice...');
  const res2 = detectOpportunity(200.00, 200.00, null);
  console.log('Resultado:', res2);
  if (res2 === 'none') {
    console.log('✔ Sucesso: Classificado como NONE (sem falso positivo).');
  } else {
    console.error('❌ Falha: Classificação incorreta.');
    failed++;
  }
  console.log('--------------------------------------------------');

  // Teste 3: Produto existente reference_price 1000 e atual 200 sem originalPrice => deve ser bug (via histórica)
  console.log('Teste 3: Produto existente com reference_price 1000 e atual 200 sem originalPrice...');
  const res3 = detectOpportunity(200.00, 1000.00, null);
  console.log('Resultado:', res3);
  if (res3 === 'bug') {
    console.log('✔ Sucesso: Classificado como BUG via queda histórica.');
  } else {
    console.error('❌ Falha: Queda histórica não detectada.');
    failed++;
  }
  console.log('--------------------------------------------------');

  // Teste 4: originalPrice inválido ou menor que preço atual => deve ser ignorado
  console.log('Teste 4: originalPrice menor que o preço atual (original 150, atual 200)...');
  const res4 = detectOpportunity(200.00, 200.00, 150.00);
  console.log('Resultado:', res4);
  if (res4 === 'none') {
    console.log('✔ Sucesso: Preço original inválido ignorado com sucesso.');
  } else {
    console.error('❌ Falha: Aceitou preço original incoerente.');
    failed++;
  }
  console.log('--------------------------------------------------');

  // Teste 5: queda histórica de 40% continua great_opportunity
  console.log('Teste 5: Queda histórica de 40% (referência 1000, atual 600)...');
  const res5 = detectOpportunity(600.00, 1000.00, null);
  console.log('Resultado:', res5);
  if (res5 === 'great_opportunity') {
    console.log('✔ Sucesso: Classificado corretamente como great_opportunity.');
  } else {
    console.error('❌ Falha: Oportunidade não detectada.');
    failed++;
  }
  console.log('--------------------------------------------------');

  // Teste de Banco Integrado
  console.log('Teste 6: Inserindo produto novo com originalPrice 1000 e atual 200 via repositório...');
  const testAsin = 'TEST-ASIN-BUG-TWOPATH';
  const testProduct = {
    asin: testAsin,
    name: 'Teclado Gamer Bug de Teste',
    price: 200.00,
    originalPrice: 1000.00,
    url: 'https://www.amazon.com.br/dp/TEST-ASIN-BUG-TWOPATH'
  };

  try {
    const dbRes = await upsertProduct(testProduct, 'amazon');
    console.log('Resultado do banco:', {
      status: dbRes.status,
      shouldAlert: dbRes.shouldAlert,
      last_opportunity_level: dbRes.data.last_opportunity_level
    });

    if (dbRes.shouldAlert && dbRes.data.last_opportunity_level === 'bug') {
      console.log('✔ Sucesso: Banco integrou e disparou o alerta de BUG imediatamente para o produto novo!');
    } else {
      console.error('❌ Falha: Alerta imediato ou nível de oportunidade incorreto no banco.');
      failed++;
    }

    // Limpeza
    console.log('Limpando produto de teste...');
    await supabase.from('price_history').delete().eq('product_id', dbRes.data.id);
    await supabase.from('products').delete().eq('id', dbRes.data.id);
    console.log('✔ Limpeza concluída.');

  } catch (err) {
    console.error('❌ Erro no teste de banco integrado:', err.message);
    failed++;
  }

  console.log('\n==================================================');
  if (failed === 0) {
    console.log('✔ Todos os testes de BUG de duas fontes passaram com sucesso!');
  } else {
    console.error(`❌ Fim dos testes: ${failed} falhas encontradas.`);
  }
  console.log('==================================================');
}

runTwoPathBugTests();
