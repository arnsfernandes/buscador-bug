import { supabase } from './products.js';

/**
 * Consulta se o conector/loja está ativo globalmente.
 * @param {string} store Nome da loja (ex: 'amazon')
 * @returns {Promise<boolean>}
 */
export async function isConnectorActive(store = 'amazon') {
  const { data, error } = await supabase
    .from('connector_config')
    .select('active')
    .eq('store', store)
    .maybeSingle();

  if (error) {
    console.error(`Erro ao verificar status do conector ${store}:`, error.message);
    return true; // Fallback seguro para ativo
  }

  return data ? data.active : true;
}

/**
 * Ativa ou desativa o status global de um conector.
 * @param {string} store Nome da loja
 * @param {boolean} active Status ativo/inativo
 * @returns {Promise<Object>} Registro atualizado
 */
export async function setConnectorStatus(store, active) {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('connector_config')
    .upsert({
      store,
      active,
      updated_at: now
    }, { onConflict: 'store' })
    .select()
    .single();

  if (error) {
    throw new Error(`Erro ao atualizar status do conector ${store}: ${error.message}`);
  }

  return data;
}

/**
 * Lista todos os termos da descoberta cadastrados para uma loja.
 * @param {string} store Nome da loja
 * @returns {Promise<Array>} Lista de termos
 */
export async function listDiscoveryTerms(store = 'amazon') {
  const { data, error } = await supabase
    .from('discovery_state')
    .select('*')
    .eq('source', store)
    .order('search_term');

  if (error) {
    throw new Error(`Erro ao listar termos da descoberta: ${error.message}`);
  }

  return data;
}

/**
 * Cria um novo termo para descoberta no banco de dados.
 * @param {string} store Nome da loja
 * @param {string} term Termo da busca
 * @returns {Promise<Object>} Registro criado
 */
export async function createDiscoveryTerm(store, term) {
  const { data, error } = await supabase
    .from('discovery_state')
    .insert({
      source: store,
      search_term: term,
      active: true,
      last_page: 0
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Erro ao criar termo de descoberta "${term}": ${error.message}`);
  }

  return data;
}

/**
 * Atualiza o status ativo/inativo ou progresso de um termo.
 * @param {string} id ID do registro
 * @param {Object} fields Campos para atualizar (ex: { active: false })
 * @returns {Promise<Object>} Registro atualizado
 */
export async function updateDiscoveryTerm(id, fields) {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('discovery_state')
    .update({
      ...fields,
      updated_at: now
    })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    throw new Error(`Erro ao atualizar termo de ID ${id}: ${error.message}`);
  }

  return data;
}

/**
 * Remove um termo da descoberta do banco.
 * @param {string} id ID do registro
 * @returns {Promise<boolean>} True se removido
 */
export async function deleteDiscoveryTerm(id) {
  const { error } = await supabase
    .from('discovery_state')
    .delete()
    .eq('id', id);

  if (error) {
    throw new Error(`Erro ao remover termo de ID ${id}: ${error.message}`);
  }

  return true;
}
