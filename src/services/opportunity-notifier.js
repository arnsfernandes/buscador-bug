import { sendTelegramMessage, sendTelegramPhoto } from './telegram.js';
import { updateTelegramFileId, updateNotifiedLevel } from '../repositories/products.js';

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
 * Detecta de forma robusta se o nome de um produto refere-se a uma placa de vídeo/GPU.
 * Evita falsos positivos como processadores com vídeo integrado ou outros acessórios.
 * @param {string} name Nome do produto
 * @returns {boolean} True se for placa de vídeo
 */
export function isVideoCard(name) {
  if (!name) return false;
  const lowerName = name.toLowerCase();

  // Excluir processadores/CPUs com vídeo integrado
  if (lowerName.includes('ryzen') || lowerName.includes('processador') || lowerName.includes('processor') || lowerName.includes('cpu')) {
    return false;
  }

  // Termos diretos de placas de vídeo
  if (lowerName.includes('placa de vídeo') || lowerName.includes('placa de video') || lowerName.includes('geforce') || lowerName.includes('rtx')) {
    return true;
  }

  // Termos de GPU adicionais
  const hasGpu = /\bgpu\b/i.test(lowerName);
  const hasRadeon = lowerName.includes('radeon');
  const hasRx = /\brx\s*\d+/i.test(lowerName) || /\brx\b/i.test(lowerName);

  if (hasGpu || hasRadeon || hasRx) {
    if (
      lowerName.includes('placa') || 
      lowerName.includes('video') || 
      lowerName.includes('vídeo') || 
      lowerName.includes('graphics') || 
      lowerName.includes('vga') || 
      lowerName.includes('gddr') || 
      /\b\d+\s*gb\b/i.test(lowerName)
    ) {
      return true;
    }
  }

  return false;
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

  // Bloqueio de placas de vídeo para KaBuM!
  if (data.store === 'kabum' && isVideoCard(data.name)) {
    console.log(`[TELEGRAM-BLOCK] Bloqueando notificação de Placa de Vídeo para KaBuM!: ${data.name}`);
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
    header = '⚠️ <b>OPORTUNIDADE DETECTADA</b>';
  }

  let storeName = 'Amazon';
  if (data.store === 'kabum') {
    storeName = 'KaBuM!';
  } else if (data.store) {
    storeName = data.store.charAt(0).toUpperCase() + data.store.slice(1);
  }
  
  const brTime = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date());

  let productName = data.name || '';
  if (productName.length > 120) {
    productName = productName.substring(0, 117) + '...';
  }

  const message = `${header}\n\n` +
                  `<b>${productName}</b>\n\n` +
                  `💰 De ${formatBRL(referencePrice)} por <b>${formatBRL(currentPrice)}</b>\n` +
                  `📉 Queda: <b>${dropPct}%</b>\n\n` +
                  `🏪 ${storeName} • 🕐 ${brTime}`;

  let productUrl = data.url;
  if (data.store === 'amazon' && data.external_id) {
    productUrl = `https://www.amazon.com.br/dp/${data.external_id}`;
  } else if (data.store === 'kabum' && data.external_id) {
    productUrl = `https://www.kabum.com.br/produto/${data.external_id}`;
  }

  const replyMarkup = {
    inline_keyboard: [
      [
        { text: 'ABRIR PRODUTO', url: productUrl }
      ]
    ]
  };

  let result = null;

  // 1. Tentar enviar via telegram_file_id se ele existir no banco
  if (data.telegram_file_id) {
    try {
      console.log(`[TELEGRAM-CACHE] Enviando foto usando cached file_id para produto ${data.id}...`);
      result = await sendTelegramPhoto(data.telegram_file_id, message, replyMarkup);
    } catch (cacheErr) {
      console.warn(`[TELEGRAM-CACHE] Falha ao enviar usando file_id cached (${data.telegram_file_id}): ${cacheErr.message}. Tentando via image_url...`);
      // Se falhar o envio por file_id, tentaremos via image_url
    }
  }

  // 2. Se não tinha file_id ou o envio com ele falhou, tentar por image_url
  if (!result && data.image_url) {
    try {
      console.log(`[TELEGRAM-UPLOAD] Baixando e enviando imagem binária de ${data.image_url}...`);
      result = await sendTelegramPhoto(data.image_url, message, replyMarkup);
      
      // Salvar o file_id retornado no banco de dados
      const photoArray = result?.result?.photo;
      if (photoArray && photoArray.length > 0) {
        const largestPhoto = photoArray[photoArray.length - 1];
        if (largestPhoto?.file_id) {
          console.log(`[TELEGRAM-CACHE] Salvando novo file_id para produto ${data.id}: ${largestPhoto.file_id}`);
          try {
            await updateTelegramFileId(data.id, largestPhoto.file_id);
          } catch (dbErr) {
            console.error('[TELEGRAM-CACHE] Erro ao salvar file_id no banco:', dbErr.message);
          }
        }
      }
    } catch (err) {
      console.warn(`[TELEGRAM-FALLBACK] Erro ao enviar foto (${data.image_url}): ${err.message}. Fazendo fallback para texto.`);
    }
  }

  // 3. Fallback final para texto simples
  if (!result) {
    result = await sendTelegramMessage(message, replyMarkup);
  }

  // Se o envio deu certo (retornou sucesso), atualizar last_notified_opportunity_level no banco
  if (result) {
    try {
      await updateNotifiedLevel(data.id, level);
      console.log(`[TELEGRAM-NOTIFY] Registrado last_notified_opportunity_level = '${level}' para produto ${data.id}.`);
    } catch (dbErr) {
      console.error('[TELEGRAM-NOTIFY] Erro ao atualizar nivel notificado no banco:', dbErr.message);
    }
  }

  return result;
}
