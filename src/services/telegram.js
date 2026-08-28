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
