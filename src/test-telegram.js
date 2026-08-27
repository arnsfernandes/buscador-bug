import { sendTelegramMessage } from './services/telegram.js';

async function runTelegramTest() {
  console.log('=== TESTANDO INTEGRAÇÃO DO TELEGRAM ===');
  const message = '<b>Buscador BUG:</b> teste de integração concluído.';

  try {
    console.log('Enviando mensagem...');
    const result = await sendTelegramMessage(message);
    
    console.log('\n✔ MENSAGEM ENVIADA COM SUCESSO!');
    console.log(`- Message ID: ${result.result.message_id}`);
    console.log(`- Destino (Chat ID): ${result.result.chat.id}`);
    console.log(`- Nome do Destinatário: ${result.result.chat.title || result.result.chat.username || result.result.chat.first_name}`);
  } catch (error) {
    console.error('\n❌ Falha ao enviar mensagem pelo Telegram:', error.message);
  }
}

runTelegramTest();
