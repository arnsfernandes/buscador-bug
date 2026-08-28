import { getProductPriorityAndEligibility } from './run-amazon-monitor.js';

function runPriorityTest() {
  console.log('=== TESTE DE PRIORIDADE E FREQUÊNCIA DE MONITORAMENTO ===\n');

  const now = new Date('2026-08-28T00:00:00.000Z');
  console.log(`Hora simulada da checagem: ${now.toISOString()}`);

  const testProducts = [
    // 1. Caso de Fronteira: Queda exata de 25%
    {
      id: 'prod-1',
      external_id: 'ASIN1',
      name: 'Produto Queda 25% (HIGH) - Vencido',
      reference_price: 1000.00,
      current_price: 750.00, // queda = 25%
      last_checked_at: new Date(now.getTime() - 2.5 * 60 * 1000).toISOString() // 2.5 min atrás (vencido, limite é 2 min)
    },
    // 2. Caso de Fronteira: Queda exata de 25% - Não vencido
    {
      id: 'prod-2',
      external_id: 'ASIN2',
      name: 'Produto Queda 25% (HIGH) - Não Vencido',
      reference_price: 1000.00,
      current_price: 750.00, // queda = 25%
      last_checked_at: new Date(now.getTime() - 1.5 * 60 * 1000).toISOString() // 1.5 min atrás (não vencido)
    },
    // 3. Caso de Fronteira: Queda exata de 5%
    {
      id: 'prod-3',
      external_id: 'ASIN3',
      name: 'Produto Queda 5% (NORMAL) - Vencido',
      reference_price: 1000.00,
      current_price: 950.00, // queda = 5%
      last_checked_at: new Date(now.getTime() - 15 * 60 * 1000).toISOString() // 15 min atrás (vencido, limite é 10 min)
    },
    // 4. Caso de Fronteira: Queda exata de 5% - Não vencido
    {
      id: 'prod-4',
      external_id: 'ASIN4',
      name: 'Produto Queda 5% (NORMAL) - Não Vencido',
      reference_price: 1000.00,
      current_price: 950.00, // queda = 5%
      last_checked_at: new Date(now.getTime() - 8 * 60 * 1000).toISOString() // 8 min atrás (não vencido)
    },
    // 5. Preço atual acima do reference_price => LOW
    {
      id: 'prod-5',
      external_id: 'ASIN5',
      name: 'Produto Preço Alto (LOW) - Vencido',
      reference_price: 1000.00,
      current_price: 1100.00, // queda = -10% (LOW)
      last_checked_at: new Date(now.getTime() - 35 * 60 * 1000).toISOString() // 35 min atrás (vencido, limite é 30 min)
    },
    // 6. Preço atual acima do reference_price => LOW - Não vencido
    {
      id: 'prod-6',
      external_id: 'ASIN6',
      name: 'Produto Preço Alto (LOW) - Não Vencido',
      reference_price: 1000.00,
      current_price: 1050.00, // queda = -5% (LOW)
      last_checked_at: new Date(now.getTime() - 25 * 60 * 1000).toISOString() // 25 min atrás (não vencido)
    },
    // 7. last_checked_at null => elegível imediatamente
    {
      id: 'prod-7',
      external_id: 'ASIN7',
      name: 'Produto sem checagem (LOW) - Elegível Imediato',
      reference_price: 1000.00,
      current_price: 990.00, // queda = 1% (LOW)
      last_checked_at: null
    },
    // 8. Preço de referência ausente/inválido => NORMAL (vencido)
    {
      id: 'prod-8',
      external_id: 'ASIN8',
      name: 'Produto ref_price inválido (NORMAL) - Vencido',
      reference_price: 0,
      current_price: 500.00,
      last_checked_at: new Date(now.getTime() - 11 * 60 * 1000).toISOString() // 11 min atrás (vencido, limite é 10 min)
    },
    // 9. HIGH vencido mais antigo para verificar ordenação interna
    {
      id: 'prod-9',
      external_id: 'ASIN9',
      name: 'Produto Queda 30% (HIGH) - Vencido Há Mais Tempo',
      reference_price: 1000.00,
      current_price: 700.00, // queda = 30% (HIGH)
      last_checked_at: new Date(now.getTime() - 10 * 60 * 1000).toISOString() // 10 min atrás (mais antigo que prod-1)
    }
  ];

  console.log('--- AVALIAÇÃO DOS PRODUTOS ---');
  const evaluated = testProducts.map(p => {
    const evalResult = getProductPriorityAndEligibility(p, now);
    console.log(`- "${p.name}":`);
    console.log(`  Prioridade: ${evalResult.priority} | Elegível: ${evalResult.isEligible ? 'SIM' : 'NÃO'}`);
    console.log(`  Motivo: ${evalResult.reason}`);
    return { product: p, evaluation: evalResult };
  });

  console.log('\n--- SELEÇÃO E ORDENAÇÃO DOS ELEGÍVEIS ---');
  const eligible = evaluated.filter(e => e.evaluation.isEligible);
  const ignored = evaluated.filter(e => !e.evaluation.isEligible);

  // Ordenação: 1. rank de prioridade decrescente, 2. last_checked_at mais antigo (se nulo, prioriza/trata como 0)
  eligible.sort((a, b) => {
    if (b.evaluation.priorityRank !== a.evaluation.priorityRank) {
      return b.evaluation.priorityRank - a.evaluation.priorityRank;
    }
    const dateA = a.product.last_checked_at ? new Date(a.product.last_checked_at).getTime() : 0;
    const dateB = b.product.last_checked_at ? new Date(b.product.last_checked_at).getTime() : 0;
    return dateA - dateB;
  });

  console.log('Ordem Final para Execução:');
  eligible.forEach((e, idx) => {
    const p = e.product;
    const ev = e.evaluation;
    console.log(`${idx + 1}. [${ev.priority}] - ${p.name} (última checagem: ${p.last_checked_at || 'NULO'})`);
  });

  console.log('\nProdutos Ignorados (Ainda não vencidos):');
  ignored.forEach((e, idx) => {
    const p = e.product;
    const ev = e.evaluation;
    console.log(`${idx + 1}. [${ev.priority}] - ${p.name} (limite: ${ev.delayMinutes} min, última checagem: ${p.last_checked_at})`);
  });

  // Estatísticas
  const stats = { HIGH: 0, NORMAL: 0, LOW: 0 };
  eligible.forEach(e => { stats[e.evaluation.priority]++; });

  console.log('\n--- METRICAS DE ELEGIBILIDADE ---');
  console.log(`- Total avaliados: ${testProducts.length}`);
  console.log(`- Total elegíveis: ${eligible.length}`);
  console.log(`  - HIGH elegíveis: ${stats.HIGH}`);
  console.log(`  - NORMAL elegíveis: ${stats.NORMAL}`);
  console.log(`  - LOW elegíveis: ${stats.LOW}`);
  console.log(`- Total ignorados: ${ignored.length}`);
}

runPriorityTest();
