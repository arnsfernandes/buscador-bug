import { upsertProduct, supabase } from './repositories/products.js';

async function testAlertLogic() {
  console.log('=== TESTE DE ALERTA DE MONITOR COM RESTAURAÇÃO GARANTIDA ===');

  // 1. Buscar um produto existente no Supabase para usar como cobaia
  const { data: product, error } = await supabase
    .from('products')
    .select('*')
    .eq('store', 'amazon')
    .limit(1)
    .maybeSingle();

  if (error || !product) {
    console.error('Erro ao carregar produto para teste:', error?.message || 'Nenhum produto encontrado.');
    return;
  }

  console.log(`[INFO] Usando o produto ASIN: ${product.external_id} ("${product.name.substring(0, 45)}...")`);
  console.log(`  - Preço de Referência atual: R$ ${product.reference_price}`);
  console.log(`  - Preço Atual: R$ ${product.current_price}`);
  console.log(`  - Nível de oportunidade anterior: "${product.last_opportunity_level || 'none'}"`);

  // Guardar valores originais para restauração
  const backup = {
    current_price: product.current_price,
    previous_price: product.previous_price,
    reference_price: product.reference_price,
    last_opportunity_level: product.last_opportunity_level,
    price_changed_at: product.price_changed_at
  };

  try {
    // 2. Simular uma queda brusca de preço (70% de desconto) para forçar classificação como 'bug'
    const originalRefPrice = Number(product.reference_price);
    const mockPrice = originalRefPrice * 0.3;

    console.log(`\n[TESTE] Simulando preço sob BUG: R$ ${mockPrice.toFixed(2)} (queda de 70%)`);

    const result = await upsertProduct({
      asin: product.external_id,
      name: product.name,
      price: mockPrice,
      url: product.url
    }, 'amazon');

    console.log(`  - Status do upsert: "${result.status}"`);
    console.log(`  - shouldAlert retornado: ${result.shouldAlert}`);
    console.log(`  - Nível classificado no banco: "${result.data?.last_opportunity_level}"`);

    // Validação
    if (result.shouldAlert && result.data?.last_opportunity_level === 'bug') {
      console.log('✔ Validação do Alerta: PASSOU (O sistema detectou o BUG e acionou o shouldAlert!)');
    } else {
      console.log('❌ Validação do Alerta: FALHOU (Não detectou o BUG)');
    }

  } catch (err) {
    console.error('Erro durante o teste da lógica de alerta:', err.message);
  } finally {
    // 3. Garantir a restauração dos dados originais no banco
    console.log('\n[RESTAURAÇÃO] Restaurando valores originais no Supabase...');
    const { error: restoreError } = await supabase
      .from('products')
      .update(backup)
      .eq('id', product.id);

    if (restoreError) {
      console.error('❌ Falha crítica ao restaurar dados do produto:', restoreError.message);
    } else {
      console.log('✔ Restauração concluída com sucesso!');
    }
  }
}

testAlertLogic();
