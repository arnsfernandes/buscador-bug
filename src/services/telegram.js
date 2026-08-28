import dotenv from 'dotenv';

// Carrega variáveis do arquivo .env
dotenv.config();

const botToken = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;

/**
 * Envia uma mensagem para o canal/chat configurado do Telegram.
 * @param {string} text Texto da mensagem.
 * @returns {Promise<Object>} O resultado retornado pela API do Telegram.
 */
export async function sendTelegramMessage(text, replyMarkup = null) {
  if (!botToken || !chatId) {
    throw new Error('Configuração do Telegram ausente (TELEGRAM_BOT_TOKEN ou TELEGRAM_CHAT_ID não definidos).');
  }

  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

  const payload = {
    chat_id: chatId,
    text: text,
    parse_mode: 'HTML',
    disable_web_page_preview: false
  };

  if (replyMarkup) {
    payload.reply_markup = replyMarkup;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json();

  if (!response.ok || !data.ok) {
    throw new Error(`Erro na API do Telegram: ${data.description || response.statusText}`);
  }

  return data;
}

/**
 * Envia uma foto com legenda para o canal/chat configurado do Telegram.
 * @param {string} photoUrl URL da imagem
 * @param {string} captionText Texto da legenda
 * @param {Object|null} replyMarkup Teclado inline opcional
 * @returns {Promise<Object>} Resultado retornado pela API do Telegram
 */
export async function sendTelegramPhoto(photoUrl, captionText, replyMarkup = null) {
  if (!botToken || !chatId) {
    throw new Error('Configuração do Telegram ausente (TELEGRAM_BOT_TOKEN ou TELEGRAM_CHAT_ID não definidos).');
  }

  const url = `https://api.telegram.org/bot${botToken}/sendPhoto`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4000); // Timeout de 4 segundos para download da imagem

  try {
    const imgRes = await fetch(photoUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    clearTimeout(timeoutId);

    if (!imgRes.ok) {
      throw new Error(`Erro de download: HTTP ${imgRes.status}`);
    }

    const contentType = imgRes.headers.get('content-type');
    if (!contentType || !contentType.startsWith('image/')) {
      throw new Error(`Mime-type inválido para imagem: ${contentType}`);
    }

    const arrayBuffer = await imgRes.arrayBuffer();
    const blob = new Blob([arrayBuffer], { type: contentType });

    const formData = new FormData();
    formData.append('chat_id', chatId);
    
    // Nome do arquivo baseado no tipo do conteúdo
    const ext = contentType.split('/')[1] || 'jpg';
    formData.append('photo', blob, `photo.${ext}`);
    formData.append('caption', captionText);
    formData.append('parse_mode', 'HTML');

    if (replyMarkup) {
      formData.append('reply_markup', JSON.stringify(replyMarkup));
    }

    const response = await fetch(url, {
      method: 'POST',
      body: formData
    });

    const data = await response.json();

    if (!response.ok || !data.ok) {
      throw new Error(`Erro na API do Telegram (sendPhoto): ${data.description || response.statusText}`);
    }

    return data;
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}
