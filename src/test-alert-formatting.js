import { checkAndNotifyOpportunity } from './services/opportunity-notifier.js';

async function testAlertFormatting() {
  console.log('=== TESTANDO FORMATAÇÃO DE ALERTAS DO TELEGRAM ===\n');

  // Interceptador global do fetch para capturar payloads enviados ao Telegram
  const capturedPayloads = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    if (url.includes('api.telegram.org')) {
      const body = JSON.parse(options.body);
      capturedPayloads.push({ url, body });
      return {
        ok: true,
        json: async () => ({ ok: true, result: {} })
      };
    }
    return originalFetch(url, options);
  };

  try {
    // Caso 1: BUG disparado por originalPrice da página (Novo Produto)
    console.log('Caso 1: BUG por originalPrice da página...');
    const result1 = {
      shouldAlert: true,
      data: {
        current_price: 200.00,
        reference_price: 200.00,
        originalPrice: 1000.00,
        last_opportunity_level: 'bug',
        name: 'Placa de Vídeo RTX 4060 Ti',
        store: 'amazon',
        url: 'https://www.amazon.com.br/dp/RTX4060TI'
      }
    };
    await checkAndNotifyOpportunity(result1);
    
    // Caso 2: BUG disparado por reference_price histórico
    console.log('Caso 2: BUG por reference_price histórico...');
    const result2 = {
      shouldAlert: true,
      data: {
        current_price: 200.00,
        reference_price: 1000.00,
        originalPrice: null,
        last_opportunity_level: 'bug',
        name: 'Placa de Vídeo RTX 4060 Ti',
        store: 'amazon',
        url: 'https://www.amazon.com.br/dp/RTX4060TI'
      }
    };
    await checkAndNotifyOpportunity(result2);

    // Caso 3: Ótima Oportunidade (great_opportunity) por histórico
    console.log('Caso 3: Ótima Oportunidade por histórico...');
    const result3 = {
      shouldAlert: true,
      data: {
        current_price: 600.00,
        reference_price: 1000.00,
        originalPrice: null,
        last_opportunity_level: 'great_opportunity',
        name: 'Monitor Gamer Ultrawide 34',
        store: 'amazon',
        url: 'https://www.amazon.com.br/dp/MONITOR34'
      }
    };
    await checkAndNotifyOpportunity(result3);

    // Validações
    console.log('\n=== VALIDAÇÕES DOS PAYLOADS CAPTURADOS ===\n');
    capturedPayloads.forEach((payload, index) => {
      console.log(`--- Payload ${index + 1} ---`);
      console.log('Texto do Alerta:\n' + payload.body.text);
      console.log('\nReply Markup (Keyboard):', JSON.stringify(payload.body.reply_markup, null, 2));
      
      const containsCruUrl = payload.body.text.includes('http');
      const hasInlineButtonUrl = payload.body.reply_markup?.inline_keyboard?.[0]?.[0]?.url;
      const isHtml = payload.body.parse_mode === 'HTML';

      console.log(`- Contém URL crua no corpo? ${containsCruUrl ? '❌ SIM' : '✔ NÃO'}`);
      console.log(`- Botão inline configurado com URL correta? ${hasInlineButtonUrl ? '✔ SIM (' + hasInlineButtonUrl + ')' : '❌ NÃO'}`);
      console.log(`- Modo de formatação HTML? ${isHtml ? '✔ SIM' : '❌ NÃO'}`);
      console.log('------------------------------------------');
    });

  } finally {
    global.fetch = originalFetch;
  }
}

testAlertFormatting();
