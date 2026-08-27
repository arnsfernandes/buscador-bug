import { collectAmazonProducts } from './collectors/amazon.js';

async function runTest() {
  const searchTerm = 'notebook';
  console.log(`Iniciando teste de coleta estruturada para o termo: "${searchTerm}"...\n`);

  try {
    const { products, rawCount, discarded } = await collectAmazonProducts(searchTerm);

    console.log('=== METRICAS DO COLETOR ===');
    console.log(`Quantidade bruta encontrada no DOM: ${rawCount}`);
    console.log(`Quantidade descartada: ${discarded.length}`);
    console.log(`Quantidade final de produtos válidos: ${products.length}\n`);

    // Validações
    console.log('=== EXECUÇÃO DAS VALIDAÇÕES ===');
    const validations = {
      noDuplicateAsins: true,
      allHaveName: true,
      allHavePrice: true,
      allHaveUrl: true,
      allPricesNumeric: true
    };

    const asinsSet = new Set();
    products.forEach(p => {
      if (asinsSet.has(p.asin)) {
        validations.noDuplicateAsins = false;
      }
      asinsSet.add(p.asin);

      if (!p.name || p.name.trim() === '') {
        validations.allHaveName = false;
      }

      if (p.price === undefined || p.price === null || typeof p.price !== 'number' || isNaN(p.price)) {
        validations.allPricesNumeric = false;
        validations.allHavePrice = false;
      }

      if (!p.url || p.url.trim() === '') {
        validations.allHaveUrl = false;
      }
    });

    console.log(`✔ Nenhum ASIN duplicado: ${validations.noDuplicateAsins ? 'PASSOU' : 'FALHOU'}`);
    console.log(`✔ Nenhum produto sem nome: ${validations.allHaveName ? 'PASSOU' : 'FALHOU'}`);
    console.log(`✔ Nenhum produto sem preço: ${validations.allHavePrice ? 'PASSOU' : 'FALHOU'}`);
    console.log(`✔ Nenhum produto sem URL: ${validations.allHaveUrl ? 'PASSOU' : 'FALHOU'}`);
    console.log(`✔ Todos os preços são valores numéricos válidos: ${validations.allPricesNumeric ? 'PASSOU' : 'FALHOU'}\n`);

    console.log('=== PRIMEIROS 10 PRODUTOS NORMALIZADOS ===');
    const limit = Math.min(products.length, 10);
    for (let i = 0; i < limit; i++) {
      console.log(`\n[Produto ${i + 1}]`);
      console.log(`ASIN: ${products[i].asin}`);
      console.log(`Nome: ${products[i].name.substring(0, 80)}...`);
      console.log(`Preço: ${products[i].price} (Tipo: ${typeof products[i].price})`);
      console.log(`URL: ${products[i].url}`);
    }

    if (discarded.length > 0) {
      console.log('\n=== AMOSTRA DE ITENS DESCARTADOS E MOTIVOS ===');
      const discLimit = Math.min(discarded.length, 5);
      for (let i = 0; i < discLimit; i++) {
        const item = discarded[i].item;
        const reason = discarded[i].reason;
        console.log(`- Item ASIN: "${item.asin || 'N/A'}" | Motivo: "${reason}" | Prévia Nome: "${item.name ? item.name.substring(0, 40) + '...' : 'N/A'}"`);
      }
    }

  } catch (error) {
    console.error('Falha geral no teste do coletor:', error.message);
  }
}

runTest();
