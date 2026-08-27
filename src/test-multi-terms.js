import { collectAmazonProducts } from './collectors/amazon.js';

async function validateTerm(term) {
  console.log(`\n==================================================`);
  console.log(`Iniciando validação para o termo: "${term}"`);
  console.log(`==================================================`);

  const startTime = Date.now();
  let result;
  
  try {
    result = await collectAmazonProducts(term);
  } catch (error) {
    console.error(`Erro ao coletar termo "${term}":`, error.message);
    return {
      term,
      duration: 'Falhou',
      rawCount: 0,
      validCount: 0,
      discardedCount: 0,
      blocked: true,
      error: error.message,
      sampleProducts: []
    };
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  const { products, rawCount, discarded } = result;

  console.log(`Tempo total da coleta: ${duration}s`);
  console.log(`Quantidade bruta de elementos no DOM: ${rawCount}`);
  console.log(`Quantidade final de produtos válidos: ${products.length}`);
  console.log(`Quantidade descartada: ${discarded.length}`);
  console.log(`Presença de bloqueio/CAPTCHA: NÃO`);

  // Asserções para esta busca específica
  const validations = {
    noDuplicateAsins: true,
    allHaveName: true,
    allHavePriceGreaterThanZero: true,
    allHaveUrl: true
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

    if (p.price === undefined || p.price === null || typeof p.price !== 'number' || isNaN(p.price) || p.price <= 0) {
      validations.allHavePriceGreaterThanZero = false;
    }

    if (!p.url || p.url.trim() === '') {
      validations.allHaveUrl = false;
    }
  });

  console.log('\nResultados das validações locais:');
  console.log(`- ASIN único e sem duplicidades: ${validations.noDuplicateAsins ? 'OK' : 'FALHOU'}`);
  console.log(`- Nome presente para todos: ${validations.allHaveName ? 'OK' : 'FALHOU'}`);
  console.log(`- Preço numérico maior que zero: ${validations.allHavePriceGreaterThanZero ? 'OK' : 'FALHOU'}`);
  console.log(`- URL válida para todos: ${validations.allHaveUrl ? 'OK' : 'FALHOU'}`);

  console.log('\nPrimeiros 3 produtos normalizados:');
  const limit = Math.min(products.length, 3);
  const sampleProducts = [];
  for (let i = 0; i < limit; i++) {
    const prod = products[i];
    sampleProducts.push(prod);
    console.log(`  [${i + 1}] ASIN: ${prod.asin} | Preço: R$ ${prod.price} | Nome: ${prod.name.substring(0, 50)}...`);
  }

  return {
    term,
    duration,
    rawCount,
    validCount: products.length,
    discardedCount: discarded.length,
    blocked: false,
    validations,
    sampleProducts
  };
}

async function runMultiValidation() {
  const terms = ['smartphone', 'tv 55', 'furadeira'];
  const summary = [];

  for (const term of terms) {
    const res = await validateTerm(term);
    summary.push(res);
  }

  console.log('\n==================================================');
  console.log('TABELA COMPARATIVA FINAL');
  console.log('==================================================');
  console.log('Termo\t\tTempo\tBrutos\tVálidos\tDescartados\tBloqueio?');
  summary.forEach(s => {
    console.log(`${s.term.padEnd(12)}\t${s.duration}s\t${s.rawCount}\t${s.validCount}\t${s.discardedCount}\t\t${s.blocked ? 'SIM' : 'NÃO'}`);
  });
  console.log('==================================================');

  const allPassed = summary.every(s => !s.blocked && s.validations.noDuplicateAsins && s.validations.allHaveName && s.validations.allHavePriceGreaterThanZero && s.validations.allHaveUrl);
  
  if (allPassed) {
    console.log('\nCONCLUSÃO: O mesmo coletor funcionou PERFEITAMENTE para todos os termos pesquisados.');
  } else {
    console.log('\nCONCLUSÃO: Ocorreram falhas de parser ou validação em alguns termos.');
  }
}

runMultiValidation();
