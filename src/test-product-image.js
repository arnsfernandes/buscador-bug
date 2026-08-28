import { upsertProduct, supabase } from './repositories/products.js';

async function testProductImage() {
  console.log('=== TESTANDO COLETA E PERSISTÊNCIA DA IMAGEM PRINCIPAL ===\n');

  const testAsin = 'TEST-ASIN-IMAGE-URL';
  const imageUrl1 = 'https://images-na.ssl-images-amazon.com/images/I/71xyz.jpg';

  try {
    // Teste 1: Imagem encontrada e salva
    console.log('1. Cadastrando produto com imagem pela primeira vez...');
    const prod1 = {
      asin: testAsin,
      name: 'Fone de Ouvido Bluetooth de Teste',
      price: 250.00,
      imageUrl: imageUrl1,
      url: 'https://www.amazon.com.br/dp/TEST-ASIN-IMAGE-URL'
    };
    let res = await upsertProduct(prod1, 'amazon');
    console.log('Resultado 1:', {
      status: res.status,
      image_url: res.data.image_url
    });
    if (res.data.image_url === imageUrl1) {
      console.log('✔ Sucesso: Imagem salva corretamente no banco.');
    } else {
      console.error('❌ Falha: Imagem não foi salva ou veio incorreta.');
    }
    console.log('--------------------------------------------------');

    // Teste 3: Nova coleta não retorna imagem -> imagem existente deve ser preservada
    console.log('2. Atualizando produto com imageUrl ausente/nula (deve preservar imagem existente)...');
    const prod2 = {
      asin: testAsin,
      name: 'Fone de Ouvido Bluetooth de Teste (Atualizado)',
      price: 250.00, // sem alteração de preço, mas imagem ausente
      imageUrl: null,
      url: 'https://www.amazon.com.br/dp/TEST-ASIN-IMAGE-URL'
    };
    res = await upsertProduct(prod2, 'amazon');
    console.log('Resultado 2:', {
      status: res.status,
      image_url: res.data.image_url
    });
    if (res.data.image_url === imageUrl1) {
      console.log('✔ Sucesso: Imagem anterior preservada no banco.');
    } else {
      console.error('❌ Falha: Imagem anterior foi apagada ou sobrescrita.');
    }
    console.log('--------------------------------------------------');

    // Teste 2: Produto sem imagem
    console.log('3. Criando novo produto que não tem imagem...');
    const testAsinNoImage = 'TEST-ASIN-NO-IMAGE';
    const prod3 = {
      asin: testAsinNoImage,
      name: 'Produto de Teste Sem Imagem',
      price: 100.00,
      imageUrl: null,
      url: 'https://www.amazon.com.br/dp/TEST-ASIN-NO-IMAGE'
    };
    let res3 = await upsertProduct(prod3, 'amazon');
    console.log('Resultado 3:', {
      status: res3.status,
      image_url: res3.data.image_url
    });
    if (res3.data.image_url === null) {
      console.log('✔ Sucesso: Produto cadastrado sem imagem com sucesso.');
    } else {
      console.error('❌ Falha: image_url não é nula.');
    }
    console.log('--------------------------------------------------');

    // Limpeza
    console.log('Limpando produtos de teste do banco...');
    await supabase.from('price_history').delete().eq('product_id', res.data.id);
    await supabase.from('products').delete().eq('id', res.data.id);
    await supabase.from('price_history').delete().eq('product_id', res3.data.id);
    await supabase.from('products').delete().eq('id', res3.data.id);
    console.log('✔ Limpeza concluída.');

    console.log('\n✔ Todos os testes de persistência de imagem finalizados com sucesso!');

  } catch (error) {
    console.error('❌ ERRO NO TESTE DE IMAGEM:', error.message);
  }
}

testProductImage();
