import { sendTelegramMessage } from './telegram.js';

/**
 * Formata um valor numérico como moeda brasileira (BRL).
 * @param {number} value 
 * @returns {string}
 */
function formatBRL(value) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(value);
}

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
  let referencePrice = Number(data.reference_price);
  const level = data.last_opportunity_level;

  // Determinar qual referência foi usada para detectar o bug
  if (level === 'bug' && data.originalPrice && data.originalPrice > 0 && data.originalPrice > currentPrice) {
    const pageDrop = (data.originalPrice - currentPrice) / data.originalPrice;
    const historicalDrop = (referencePrice - currentPrice) / referencePrice;
    
    // Se a queda da página for a que atingiu o limite de bug, usamos a referência da página
    if (pageDrop >= 0.60 && (historicalDrop < 0.60 || pageDrop > historicalDrop)) {
      referencePrice = Number(data.originalPrice);
    }
  }

  const dropPct = (((referencePrice - currentPrice) / referencePrice) * 100).toFixed(0);

  let header = '';
  if (level === 'great_opportunity') {
    header = '🔥 <b>ÓTIMA OPORTUNIDADE</b>';
  } else if (level === 'bug') {
    header = '🚨 <b>BUG</b>';
  } else {
    return null;
  }

  const storeName = data.store ? data.store.charAt(0).toUpperCase() + data.store.slice(1) : 'Amazon';
  
  const brTime = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date());

  const message = `${header}\n\n` +
                  `<b>${data.name}</b>\n\n` +
                  `💰 Referência: ${formatBRL(referencePrice)}\n` +
                  `🔥 Agora: <b>${formatBRL(currentPrice)}</b>\n` +
                  `📉 Queda: <b>${dropPct}%</b>\n\n` +
                  `🏪 ${storeName}\n` +
                  `🕐 ${brTime}`;

  const replyMarkup = {
    inline_keyboard: [
      [
        { text: 'ABRIR PRODUTO', url: data.url }
      ]
    ]
  };

  return await sendTelegramMessage(message, replyMarkup);
}
