import { supabase } from './products.js';
import { sendTelegramMessage } from '../services/telegram.js';

/**
 * Registra o sucesso de um ciclo de execução do serviço.
 * Reseta as falhas consecutivas e limpa o alerta/erro.
 * Se houver alerta de falha pendente, envia uma mensagem de recuperação.
 * @param {string} serviceName Nome do serviço (ex: 'amazon-monitor', 'amazon-discovery')
 * @returns {Promise<Object>} Dados atualizados da saúde do serviço
 */
export async function registerSuccess(serviceName) {
  const now = new Date().toISOString();
  
  // 1. Obter estado atual para saber se havia alerta pendente
  const { data: current, error: getError } = await supabase
    .from('service_health')
    .select('*')
    .eq('service_name', serviceName)
    .maybeSingle();

  if (getError) {
    console.error(`Erro ao consultar estado de saúde atual de ${serviceName}:`, getError.message);
  }

  const wasAlertSent = current?.alert_sent || false;

  if (wasAlertSent) {
    const recoveryMsg = `✅ <b>[RECUPERAÇÃO] Serviço Restabelecido</b>\n\n` +
      `O serviço <code>${serviceName}</code> voltou a operar normalmente com sucesso.\n` +
      `<b>Hora:</b> ${new Date().toLocaleString()}`;

    if (process.env.MOCK_TELEGRAM === 'true') {
      console.log(`[MOCK TELEGRAM] Enviando mensagem de recuperação:\n${recoveryMsg}`);
    } else {
      try {
        await sendTelegramMessage(recoveryMsg);
      } catch (tgErr) {
        console.error(`Erro ao enviar alerta de recuperação para o Telegram:`, tgErr.message);
      }
    }
  }

  const { data, error } = await supabase
    .from('service_health')
    .upsert({
      service_name: serviceName,
      consecutive_failures: 0,
      last_success_at: now,
      alert_sent: false,
      last_error: null,
      updated_at: now
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Erro ao registrar sucesso do serviço ${serviceName}: ${error.message}`);
  }

  return data;
}

/**
 * Registra a falha de um ciclo de execução do serviço.
 * Incrementa as falhas consecutivas e envia alerta de Telegram se atingir exatamente 3 falhas consecutivas.
 * @param {string} serviceName Nome do serviço
 * @param {string} errorMessage Mensagem de erro
 * @returns {Promise<Object>} Dados atualizados da saúde do serviço
 */
export async function registerFailure(serviceName, errorMessage) {
  const now = new Date().toISOString();

  // 1. Obter estado atual para saber consecutive_failures e alert_sent
  const { data: current, error: getError } = await supabase
    .from('service_health')
    .select('*')
    .eq('service_name', serviceName)
    .maybeSingle();

  if (getError) {
    console.error(`Erro ao consultar estado de saúde atual de ${serviceName}:`, getError.message);
  }

  const consecutiveFailures = (current?.consecutive_failures || 0) + 1;
  let alertSent = current?.alert_sent || false;

  if (consecutiveFailures === 3 && !alertSent) {
    const alertMsg = `🚨 <b>[ALERTA] Instabilidade no Serviço</b>\n\n` +
      `O serviço <code>${serviceName}</code> falhou 3 vezes consecutivas!\n` +
      `<b>Último erro registrado:</b> <i>${errorMessage}</i>\n` +
      `<b>Hora do alerta:</b> ${new Date().toLocaleString()}`;

    if (process.env.MOCK_TELEGRAM === 'true') {
      console.log(`[MOCK TELEGRAM] Enviando alerta de falha crítica:\n${alertMsg}`);
    } else {
      try {
        await sendTelegramMessage(alertMsg);
      } catch (tgErr) {
        console.error(`Erro ao enviar alerta de instabilidade para o Telegram:`, tgErr.message);
      }
    }
    alertSent = true;
  }

  const { data, error } = await supabase
    .from('service_health')
    .upsert({
      service_name: serviceName,
      consecutive_failures: consecutiveFailures,
      last_failure_at: now,
      last_error: errorMessage,
      alert_sent: alertSent,
      updated_at: now
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Erro ao registrar falha do serviço ${serviceName}: ${error.message}`);
  }

  return data;
}
