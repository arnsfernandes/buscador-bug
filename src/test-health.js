import { registerSuccess, registerFailure } from './repositories/service-health.js';

async function testHealthCheck() {
  console.log('=== TESTANDO ESTRUTURA DE HEALTH CHECK ===\n');

  try {
    // 1. Registrar sucesso inicial
    console.log('1. Registrando sucesso inicial para "amazon-monitor"...');
    let data = await registerSuccess('amazon-monitor');
    console.log('Resultado do sucesso:', {
      service_name: data.service_name,
      consecutive_failures: data.consecutive_failures,
      last_success_at: data.last_success_at,
      last_error: data.last_error,
      alert_sent: data.alert_sent
    });
    console.log('--------------------------------------------------');

    // 2. Registrar primeira falha
    console.log('2. Registrando primeira falha para "amazon-monitor"...');
    data = await registerFailure('amazon-monitor', 'Simulação de falha de conexão HTTP');
    console.log('Resultado da falha:', {
      service_name: data.service_name,
      consecutive_failures: data.consecutive_failures,
      last_failure_at: data.last_failure_at,
      last_error: data.last_error
    });
    console.log('--------------------------------------------------');

    // 3. Registrar segunda falha
    console.log('3. Registrando segunda falha para "amazon-monitor"...');
    data = await registerFailure('amazon-monitor', 'Timeout ao carregar Playwright');
    console.log('Resultado da segunda falha:', {
      service_name: data.service_name,
      consecutive_failures: data.consecutive_failures,
      last_failure_at: data.last_failure_at,
      last_error: data.last_error
    });
    console.log('--------------------------------------------------');

    // 4. Registrar sucesso para resetar
    console.log('4. Registrando novo sucesso (recuperação) para "amazon-monitor"...');
    data = await registerSuccess('amazon-monitor');
    console.log('Resultado do sucesso pós-recuperação:', {
      service_name: data.service_name,
      consecutive_failures: data.consecutive_failures,
      last_success_at: data.last_success_at,
      last_error: data.last_error
    });
    console.log('--------------------------------------------------');

    console.log('✔ Teste de health check concluído com sucesso!');

  } catch (error) {
    console.error('❌ ERRO NO TESTE DE HEALTH CHECK:', error.message);
  }
}

testHealthCheck();
