import { sendTelegramMessage } from './telegram.js';

/**
 * Verifica o resultado do upsert de um produto e envia um alerta ao Telegram caso seja uma oportunidade qualificada.
 * @param {Object} upsertResult Retorno da função upsertProduct.
 * @returns {Promise<Object|null>} Retorno do Telegram se enviado, ou null.
 */
export async function checkAndNotifyOpportunity(upsertResult) {
  const { shouldAlert, data } = upsertResult;
  
  if (!shouldAlert || !data) {
    return null;
  }

  const currentPrice = Number(data.current_price);
  const referencePrice = Number(data.reference_price);
  const dropPct = (((referencePrice - currentPrice) / referencePrice) * 100).toFixed(0);
  const level = data.last_opportunity_level;

  let header = '';
  if (level === 'great_opportunity') {
    header = '🔥 <b>ÓTIMA OPORTUNIDADE</b>';
  } else if (level === 'bug') {
    header = '🚨 <b>BUG DE PREÇO</b>';
  } else {
    return null;
  }

  const message = `${header}\n\n` +
                  `📦 <b>Produto:</b> ${data.name}\n` +
                  `💰 <b>Preço Referência:</b> R$ ${referencePrice.toFixed(2)}\n` +
                  `💵 <b>Preço Atual:</b> R$ ${currentPrice.toFixed(2)} (${dropPct}% de queda)\n\n` +
                  `🔗 <a href="${data.url}">Ver na Amazon</a>`;

  return await sendTelegramMessage(message);
}
