import dotenv from 'dotenv';
import { 
  isConnectorActive, 
  setConnectorStatus, 
  listDiscoveryTerms, 
  createDiscoveryTerm, 
  updateDiscoveryTerm, 
  deleteDiscoveryTerm 
} from './repositories/config.js';

dotenv.config();

const token = process.env.TELEGRAM_BOT_TOKEN;
const authorizedChatId = process.env.TELEGRAM_CHAT_ID;

if (!token || !authorizedChatId) {
  console.error('ERRO: TELEGRAM_BOT_TOKEN ou TELEGRAM_CHAT_ID ausentes no .env.');
  process.exit(1);
}

const BASE_URL = `https://api.telegram.org/bot${token}`;
let lastUpdateId = 0;
const userStates = {}; // Guarda estado interativo (ex: digitando nome de termo)

/**
 * Função utilitária para chamadas HTTP à API do Telegram.
 */
async function callTelegram(method, body = {}) {
  try {
    const res = await fetch(`${BASE_URL}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!data.ok) {
      console.error(`Erro na API do Telegram (${method}):`, data);
    }
    return data;
  } catch (err) {
    console.error(`Falha ao conectar na API do Telegram (${method}):`, err.message);
    return { ok: false };
  }
}

/**
 * Verifica se o remetente é autorizado.
 */
function isAuthorized(chatId, fromId) {
  const authId = String(authorizedChatId).trim();
  return String(chatId).trim() === authId || String(fromId).trim() === authId;
}

/**
 * Envia ou edita mensagem do menu principal.
 */
async function sendMainMenu(chatId, messageId = null) {
  const text = '⚙️ *Painel de Controle - Buscador BUG*\n\nSelecione uma das opções abaixo para gerenciar o monitoramento:';
  const replyMarkup = {
    inline_keyboard: [
      [
        { text: '🔎 Itens monitorados', callback_data: 'terms:list:0' },
        { text: '🌐 Sites monitorados', callback_data: 'sites:list' }
      ]
    ]
  };

  if (messageId) {
    await callTelegram('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: 'Markdown',
      reply_markup: replyMarkup
    });
  } else {
    await callTelegram('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
      reply_markup: replyMarkup
    });
  }
}

/**
 * Envia ou edita a lista paginada de termos da descoberta.
 */
async function sendTermsList(chatId, page = 0, messageId = null) {
  const terms = await listDiscoveryTerms('amazon');
  const pageSize = 5;
  const totalPages = Math.ceil(terms.length / pageSize);
  const startIdx = page * pageSize;
  const pageTerms = terms.slice(startIdx, startIdx + pageSize);

  let text = `🔎 *Itens Monitorados (Descoberta Amazon)*\nPage: *${page + 1} de ${totalPages || 1}*\n\n`;
  if (pageTerms.length === 0) {
    text += 'Nenhum termo cadastrado.';
  } else {
    pageTerms.forEach((t, i) => {
      const statusIcon = t.active ? '✅' : '❌';
      text += `${startIdx + i + 1}. *${t.search_term}* [${statusIcon}]\n`;
    });
  }

  const keyboard = [];

  // Botões inline para cada termo na página (para ativar/desativar, editar e excluir)
  pageTerms.forEach((t) => {
    const statusLabel = t.active ? 'Desativar ❌' : 'Ativar ✅';
    keyboard.push([
      { text: `✏️ ${t.search_term.substring(0, 10)}`, callback_data: `terms:edit_ask:${t.id}:${page}` },
      { text: statusLabel, callback_data: `terms:toggle:${t.id}:${page}` },
      { text: '🗑️ Excluir', callback_data: `terms:del_ask:${t.id}:${page}` }
    ]);
  });

  // Botão de navegação e Adição
  const navRow = [];
  if (page > 0) {
    navRow.push({ text: '⬅️ Ant', callback_data: `terms:list:${page - 1}` });
  }
  navRow.push({ text: '➕ Adicionar Novo', callback_data: 'terms:add' });
  if (startIdx + pageSize < terms.length) {
    navRow.push({ text: 'Prox ➡️', callback_data: `terms:list:${page + 1}` });
  }
  keyboard.push(navRow);

  // Voltar para o menu principal
  keyboard.push([{ text: '⬅️ Voltar ao Menu Principal', callback_data: 'menu:main' }]);

  if (messageId) {
    await callTelegram('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: keyboard }
    });
  } else {
    await callTelegram('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: keyboard }
    });
  }
}

/**
 * Tela de confirmação de remoção de termo.
 */
async function sendDeleteConfirmation(chatId, termId, page, messageId) {
  const terms = await listDiscoveryTerms('amazon');
  const term = terms.find(t => t.id === termId);
  if (!term) {
    await sendTermsList(chatId, page, messageId);
    return;
  }

  const text = `⚠️ *Confirmação de Exclusão*\n\nTem certeza que deseja excluir o termo *"${term.search_term}"* do monitoramento?`;
  const replyMarkup = {
    inline_keyboard: [
      [
        { text: '🗑️ Sim, Excluir', callback_data: `terms:del_confirm:${termId}:${page}` },
        { text: '❌ Cancelar', callback_data: `terms:list:${page}` }
      ]
    ]
  };

  await callTelegram('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: 'Markdown',
    reply_markup: replyMarkup
  });
}

/**
 * Envia ou edita a lista de sites/conectores monitorados.
 */
async function sendSitesList(chatId, messageId = null) {
  const isAmazonActive = await isConnectorActive('amazon');
  const text = '🌐 *Sites/Conectores Monitorados*\n\nStatus dos conectores de coleta configurados:';
  
  const statusIcon = isAmazonActive ? '✅ Ativo' : '❌ Inativo';
  const actionLabel = isAmazonActive ? 'Desativar Amazon ❌' : 'Ativar Amazon ✅';

  const replyMarkup = {
    inline_keyboard: [
      [
        { text: `Amazon: ${statusIcon}`, callback_data: 'noop' }
      ],
      [
        { text: actionLabel, callback_data: 'sites:toggle:amazon' }
      ],
      [
        { text: '⬅️ Voltar ao Menu Principal', callback_data: 'menu:main' }
      ]
    ]
  };

  if (messageId) {
    await callTelegram('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: 'Markdown',
      reply_markup: replyMarkup
    });
  } else {
    await callTelegram('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
      reply_markup: replyMarkup
    });
  }
}

/**
 * Processador de Callbacks (Inline Buttons).
 */
async function handleCallbackQuery(callbackQuery) {
  const { id: queryId, message, data, from } = callbackQuery;
  const chatId = message.chat.id;
  const messageId = message.message_id;

  if (!isAuthorized(chatId, from.id)) {
    await callTelegram('answerCallbackQuery', {
      callback_query_id: queryId,
      text: 'Acesso negado. Você não é o administrador.',
      show_alert: true
    });
    return;
  }

  // Agradecer clique
  await callTelegram('answerCallbackQuery', { callback_query_id: queryId });

  const parts = data.split(':');
  const action = parts[0];

  if (action === 'menu') {
    if (parts[1] === 'main') {
      await sendMainMenu(chatId, messageId);
    }
  } 
  else if (action === 'terms') {
    const subAction = parts[1];
    if (subAction === 'list') {
      const page = parseInt(parts[2] || '0', 10);
      await sendTermsList(chatId, page, messageId);
    } 
    else if (subAction === 'toggle') {
      const termId = parts[2];
      const page = parseInt(parts[3] || '0', 10);
      
      const terms = await listDiscoveryTerms('amazon');
      const term = terms.find(t => t.id === termId);
      if (term) {
        await updateDiscoveryTerm(termId, { active: !term.active });
      }
      await sendTermsList(chatId, page, messageId);
    } 
    else if (subAction === 'del_ask') {
      const termId = parts[2];
      const page = parseInt(parts[3] || '0', 10);
      await sendDeleteConfirmation(chatId, termId, page, messageId);
    } 
    else if (subAction === 'del_confirm') {
      const termId = parts[2];
      const page = parseInt(parts[3] || '0', 10);
      await deleteDiscoveryTerm(termId);
      await sendTermsList(chatId, page, messageId);
    } 
    else if (subAction === 'add') {
      userStates[chatId] = { action: 'awaiting_add_term' };
      await callTelegram('sendMessage', {
        chat_id: chatId,
        text: '✍️ Digite o nome do *novo termo* que deseja adicionar para a descoberta:',
        parse_mode: 'Markdown'
      });
    } 
    else if (subAction === 'edit_ask') {
      const termId = parts[2];
      const page = parseInt(parts[3] || '0', 10);
      userStates[chatId] = { action: 'awaiting_edit_term', termId, page };
      await callTelegram('sendMessage', {
        chat_id: chatId,
        text: '✍️ Digite o *novo nome* para esse termo de busca:',
        parse_mode: 'Markdown'
      });
    }
  } 
  else if (action === 'sites') {
    const subAction = parts[1];
    if (subAction === 'list') {
      await sendSitesList(chatId, messageId);
    } 
    else if (subAction === 'toggle') {
      const store = parts[2];
      const currentActive = await isConnectorActive(store);
      await setConnectorStatus(store, !currentActive);
      await sendSitesList(chatId, messageId);
    }
  }
}

/**
 * Processador de Mensagens de Texto comuns.
 */
async function handleMessage(message) {
  const chatId = message.chat.id;
  const fromId = message.from?.id;
  const text = message.text ? message.text.trim() : '';

  if (!isAuthorized(chatId, fromId)) {
    console.warn(`Acesso não autorizado bloqueado: ChatId ${chatId}, FromId ${fromId}`);
    return;
  }

  // Processa comandos normais
  if (text.startsWith('/menu') || text.startsWith('/start')) {
    delete userStates[chatId];
    await sendMainMenu(chatId);
    return;
  }

  // Verifica se o usuário estava no fluxo de digitação interativa
  const state = userStates[chatId];
  if (state) {
    if (state.action === 'awaiting_add_term') {
      delete userStates[chatId];
      if (!text) {
        await callTelegram('sendMessage', { chat_id: chatId, text: '❌ Nome inválido.' });
        return;
      }
      try {
        await createDiscoveryTerm('amazon', text);
        await callTelegram('sendMessage', { 
          chat_id: chatId, 
          text: `✔ Termo *"${text}"* adicionado com sucesso!`,
          parse_mode: 'Markdown' 
        });
        await sendTermsList(chatId, 0);
      } catch (err) {
        await callTelegram('sendMessage', { chat_id: chatId, text: `❌ Erro: ${err.message}` });
      }
    } 
    else if (state.action === 'awaiting_edit_term') {
      const { termId, page } = state;
      delete userStates[chatId];
      if (!text) {
        await callTelegram('sendMessage', { chat_id: chatId, text: '❌ Nome inválido.' });
        return;
      }
      try {
        await updateDiscoveryTerm(termId, { search_term: text });
        await callTelegram('sendMessage', { 
          chat_id: chatId, 
          text: `✔ Termo atualizado para *"${text}"* com sucesso!`,
          parse_mode: 'Markdown' 
        });
        await sendTermsList(chatId, page);
      } catch (err) {
        await callTelegram('sendMessage', { chat_id: chatId, text: `❌ Erro: ${err.message}` });
      }
    }
  } else {
    // Resposta padrão
    await callTelegram('sendMessage', {
      chat_id: chatId,
      text: 'Utilize o comando /menu para abrir o painel de configurações.'
    });
  }
}

/**
 * Loop principal de Long Polling.
 */
async function startLongPolling() {
  console.log('Iniciando Long Polling para o Bot administrativo...');
  
  // Primeiro, descarte atualizações antigas para evitar comportamento indesejado no restart
  const discardRes = await callTelegram('getUpdates', { offset: -1, limit: 1, timeout: 0 });
  if (discardRes.ok && discardRes.result.length > 0) {
    lastUpdateId = discardRes.result[0].update_id + 1;
    console.log(`Descartadas mensagens antigas. Próximo Update ID: ${lastUpdateId}`);
  }

  while (true) {
    try {
      const res = await callTelegram('getUpdates', {
        offset: lastUpdateId,
        limit: 10,
        timeout: 30
      });

      if (res.ok && res.result && res.result.length > 0) {
        for (const update of res.result) {
          lastUpdateId = update.update_id + 1;

          if (update.message) {
            await handleMessage(update.message);
          } else if (update.callback_query) {
            await handleCallbackQuery(update.callback_query);
          }
        }
      }
    } catch (err) {
      console.error('Erro no ciclo de polling do Telegram:', err.message);
      await new Promise(resolve => setTimeout(resolve, 5000)); // Esperar antes de tentar novamente
    }
  }
}

// Exporta funções para fins de testes automatizados
export {
  handleMessage,
  handleCallbackQuery,
  userStates,
  callTelegram,
  isAuthorized,
  sendMainMenu,
  sendTermsList,
  sendSitesList,
  startLongPolling
};

const isMain = process.argv[1] && process.argv[1].endsWith('telegram-bot.js');
if (isMain) {
  startLongPolling();
}
