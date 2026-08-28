import dotenv from 'dotenv';
import { registerSuccess, registerFailure } from './repositories/service-health.js';

dotenv.config();

// Forçamos o MOCK_TELEGRAM para true de forma limpa no escopo do teste
process.env.MOCK_TELEGRAM = 'true';

async function testTelegramAlerts() {
  console.log('=== TESTANDO ALERTAS TELEGRAM DE HEALTH CHECK ===\n');

  try {
    const service = 'test-telegram-service';

    // 0. Reset inicial
    console.log('0. Efetuando reset inicial...');
    await registerSuccess(service);
    console.log('--------------------------------------------------');

    // 1. Falha 1
    console.log('1. Registrando falha 1...');
    let res = await registerFailure(service, 'Conexão rejeitada pela Amazon (503)');
    console.log(`Falhas consecutivas: ${res.consecutive_failures} | Alerta enviado: ${res.alert_sent}`);
    console.log('--------------------------------------------------');

    // 2. Falha 2
    console.log('2. Registrando falha 2...');
    res = await registerFailure(service, 'Instabilidade de DNS (Falha de resolução)');
    console.log(`Falhas consecutivas: ${res.consecutive_failures} | Alerta enviado: ${res.alert_sent}`);
    console.log('--------------------------------------------------');

    // 3. Falha 3 (Momento de envio do alerta)
    console.log('3. Registrando falha 3 (Deve disparar o Alerta de saúde)...');
    res = await registerFailure(service, 'Timeout no carregamento da página (Evaluate 15s)');
    console.log(`Falhas consecutivas: ${res.consecutive_failures} | Alerta enviado: ${res.alert_sent}`);
    console.log('--------------------------------------------------');

    // 4. Falha 4 (Não deve repetir o alerta)
    console.log('4. Registrando falha 4 (Não deve disparar alerta repetido)...');
    res = await registerFailure(service, 'Bloqueio contínuo (CAPTCHA WAF)');
    console.log(`Falhas consecutivas: ${res.consecutive_failures} | Alerta enviado: ${res.alert_sent}`);
    console.log('--------------------------------------------------');

    // 5. Sucesso seguinte (Deve disparar a recuperação)
    console.log('5. Registrando sucesso seguinte (Deve disparar a Recuperação)...');
    res = await registerSuccess(service);
    console.log(`Falhas consecutivas: ${res.consecutive_failures} | Alerta enviado: ${res.alert_sent}`);
    console.log('--------------------------------------------------');

    console.log('✔ Testes de fluxo e alertas de saúde concluídos com sucesso!');

  } catch (error) {
    console.error('❌ ERRO DURANTE OS TESTES DE ALERTAS DE SAÚDE:', error.message);
  }
}

testTelegramAlerts();
