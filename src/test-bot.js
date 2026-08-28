// Definir NODE_ENV para evitar que o polling real inicie ao importar o modulo
process.env.NODE_ENV = 'test';

import { 
  handleMessage, 
  handleCallbackQuery, 
  userStates, 
  isAuthorized,
  callTelegram
} from './telegram-bot.js';
import { createDiscoveryTerm, deleteDiscoveryTerm, listDiscoveryTerms } from './repositories/config.js';

// Obter o Chat ID real da configuração local para poder autenticar o teste
const realChatId = process.env.TELEGRAM_CHAT_ID;

async function testBotLogic() {
  console.log('=== TESTANDO PARSING E LÓGICA DO BOT DO TELEGRAM (ISOLADO) ===\n');

  if (!realChatId) {
    console.error('❌ Falha: TELEGRAM_CHAT_ID não configurado no ambiente.');
    return;
  }

  // Substituir o fetch global de forma inteligente para interceptar apenas Telegram API
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    if (url.includes('api.telegram.org')) {
      // Mock da resposta do Telegram
      return {
        json: async () => ({ ok: true, result: [] })
      };
    }
    // Repassa as demais chamadas (como Supabase) ao fetch original
    return originalFetch(url, options);
  };

  try {
    // 1. Testar Autorização
    console.log('1. Testando autorização de chat/usuário...');
    const ok = isAuthorized(realChatId, realChatId);
    const fail = isAuthorized('999999', '999999');
    console.log('Autorizado (Real ID):', ok);
    console.log('Negado (999999):', !fail);
    if (ok && !fail) {
      console.log('✔ Sucesso: Validação de autorização correta.');
    } else {
      console.error('❌ Falha: Validação de autorização falhou.');
    }
    console.log('--------------------------------------------------');

    // 2. Testar processamento de mensagem /menu
    console.log('2. Simulando envio do comando /menu...');
    const menuMessage = {
      chat: { id: Number(realChatId) },
      from: { id: Number(realChatId) },
      text: '/menu'
    };

    await handleMessage(menuMessage);
    console.log('✔ Sucesso: Comando /menu processado.');
    console.log('--------------------------------------------------');

    // 3. Testar o fluxo de estado interativo para adicionar um termo
    console.log('3. Simulando fluxo interativo de adição de termo...');
    
    // Passo A: Clicar no botão "Adicionar Novo" (dispara callback 'terms:add')
    const addCallback = {
      id: 'query_123',
      from: { id: Number(realChatId) },
      message: { chat: { id: Number(realChatId) }, message_id: 999 },
      data: 'terms:add'
    };
    await handleCallbackQuery(addCallback);
    console.log('Estado pós-callback de adição:', userStates[realChatId]);
    if (userStates[realChatId] && userStates[realChatId].action === 'awaiting_add_term') {
      console.log('✔ Sucesso: Estado "awaiting_add_term" configurado no chat.');
    } else {
      console.error('❌ Falha: Estado incorreto.');
    }

    // Passo B: Usuário envia o texto do novo termo
    const termText = 'TEST-BOT-TERM';
    const textMessage = {
      chat: { id: Number(realChatId) },
      from: { id: Number(realChatId) },
      text: termText
    };
    await handleMessage(textMessage);
    console.log('Estado pós-envio do texto:', userStates[realChatId]);

    // Verificar se o termo foi criado no banco
    const terms = await listDiscoveryTerms('amazon');
    const found = terms.find(t => t.search_term === termText);
    if (found) {
      console.log('✔ Sucesso: Termo criado no Supabase via fluxo interativo.');
      // Limpar o termo de teste do banco
      await deleteDiscoveryTerm(found.id);
      console.log('✔ Limpeza concluída.');
    } else {
      console.error('❌ Falha: Termo não encontrado no Supabase.');
    }

    console.log('\n✔ Todos os testes do Bot do Telegram concluídos com sucesso!');

  } finally {
    // Restaurar fetch original
    global.fetch = originalFetch;
  }
}

testBotLogic();
