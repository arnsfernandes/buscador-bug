import { supabase } from './repositories/products.js';
import { runAmazonDiscovery } from './run-amazon-discovery.js';
import { runAmazonMonitor } from './run-amazon-monitor.js';
import { registerSuccess, registerFailure } from './repositories/service-health.js';

async function runIntegratedTest() {
  console.log('=== INICIANDO TESTE INTEGRADO DE HEALTH CHECK ===\n');

  // Testando Sucessos
  try {
    console.log('--- TESTANDO REGISTRO DE SUCESSO ---');
    
    console.log('1. Executando ciclo de sucesso da Descoberta (apenas 1 termo, SSD)...');
    // Para ser rápido, rodamos apenas 1 termo e 1 página
    const discResult = await runAmazonDiscovery({ terms: ['SSD'], pagesPerRun: 1 });
    // Registra sucesso manualmente simulando o loop
    await registerSuccess('amazon-discovery');
    console.log('✔ Sucesso da Descoberta registrado.');

    console.log('\n2. Executando ciclo de sucesso do Monitor (limite 1)...');
    const monResult = await runAmazonMonitor({ limit: 1, mockTelegram: true });
    // Registra sucesso manualmente simulando o loop
    await registerSuccess('amazon-monitor');
    console.log('✔ Sucesso do Monitor registrado.');

  } catch (error) {
    console.error('❌ Erro inesperado na fase de sucesso:', error.message);
  }

  // Testando Falhas
  try {
    console.log('\n--- TESTANDO REGISTRO DE FALHA ---');

    console.log('3. Simulando erro crítico no ciclo de Descoberta...');
    try {
      throw new Error('Falha de conexão DNS com a Amazon.com.br');
    } catch (err) {
      await registerFailure('amazon-discovery', err.message);
      console.log('✔ Falha simulada da Descoberta registrada.');
    }

    console.log('\n4. Simulando erro crítico no ciclo de Monitoramento...');
    try {
      throw new Error('Erro de inicialização do Playwright (Navegador travado)');
    } catch (err) {
      await registerFailure('amazon-monitor', err.message);
      console.log('✔ Falha simulada do Monitor registrada.');
    }

  } catch (error) {
    console.error('❌ Erro inesperado na fase de falha:', error.message);
  }

  // Visualizando registros finais
  try {
    console.log('\n--- VERIFICANDO DADOS SALVOS NO SUPABASE ---');
    const { data, error } = await supabase
      .from('service_health')
      .select('*');

    if (error) throw error;

    console.table(data.map(row => ({
      'Serviço': row.service_name,
      'Falhas Cons.': row.consecutive_failures,
      'Última Falha At': row.last_failure_at ? new Date(row.last_failure_at).toLocaleString() : 'N/A',
      'Último Sucesso At': row.last_success_at ? new Date(row.last_success_at).toLocaleString() : 'N/A',
      'Último Erro': row.last_error || 'N/A'
    })));

  } catch (error) {
    console.error('❌ Erro ao consultar registros finais:', error.message);
  }
}

runIntegratedTest();
