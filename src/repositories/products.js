import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { detectOpportunity } from '../services/opportunity-detector.js';

// Carrega as variáveis do arquivo .env
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.warn('[AVISO] SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não configurados no ambiente.');
}

export const supabase = createClient(supabaseUrl || '', supabaseServiceKey || '');

/**
 * Salva ou atualiza o estado de um produto no Supabase com base nas regras de preço e registra no histórico.
 * @param {Object} product
 * @param {string} product.asin
 * @param {string} product.name
 * @param {number} product.price
 * @param {string} product.url
 * @param {string} [store='amazon']
 * @returns {Promise<Object>} O registro salvo ou atualizado.
 */
export async function upsertProduct(product, store = 'amazon') {
  const { asin, name, price, url } = product;

  if (!asin || !name || price === undefined || price === null || !url) {
    throw new Error('Produto inválido para upsert. Todos os campos são obrigatórios.');
  }

  // 1. Verificar se o produto já existe
  const { data: existing, error: selectError } = await supabase
    .from('products')
    .select('*')
    .eq('store', store)
    .eq('external_id', asin)
    .maybeSingle();

  if (selectError) {
    throw new Error(`Erro ao buscar produto existente: ${selectError.message}`);
  }

  const nowStr = new Date().toISOString();

  if (!existing) {
    // 2. Produto novo: Inserir em 'products'
    const currentLevel = detectOpportunity(price, price, product.originalPrice);
    const { data: inserted, error: insertError } = await supabase
      .from('products')
      .insert({
        store,
        external_id: asin,
        name,
        url,
        current_price: price,
        previous_price: null,
        reference_price: price,
        first_seen_at: nowStr,
        last_checked_at: nowStr,
        availability_status: 'active',
        consecutive_unavailable: 0,
        last_available_at: nowStr,
        last_opportunity_level: currentLevel
      })
      .select()
      .single();

    if (insertError) {
      throw new Error(`Erro ao inserir produto novo: ${insertError.message}`);
    }

    // Inserir preço inicial no histórico
    const { error: historyError } = await supabase
      .from('price_history')
      .insert({
        product_id: inserted.id,
        price,
        recorded_at: nowStr
      });

    if (historyError) {
      throw new Error(`Erro ao inserir preço inicial no histórico: ${historyError.message}`);
    }

    return { status: 'inserted', data: inserted, shouldAlert: currentLevel === 'bug' };
  } else {
    // 3. Produto já existe
    const hasPriceChanged = Number(existing.current_price) !== Number(price);

    const updateFields = {
      name,
      url,
      last_checked_at: nowStr,
      availability_status: 'active',
      consecutive_unavailable: 0,
      last_available_at: nowStr
    };

    if (hasPriceChanged) {
      updateFields.previous_price = existing.current_price;
      updateFields.current_price = price;
      updateFields.price_changed_at = nowStr;
    }

    // Controle de Alertas Repetidos
    const levelRanks = { none: 0, great_opportunity: 1, bug: 2 };
    const oldLevel = existing.last_opportunity_level || 'none';
    const currentLevel = detectOpportunity(price, Number(existing.reference_price), product.originalPrice);
    const shouldAlert = levelRanks[currentLevel] > levelRanks[oldLevel];

    if (shouldAlert) {
      updateFields.last_opportunity_level = currentLevel;
    }

    const { data: updated, error: updateError } = await supabase
      .from('products')
      .update(updateFields)
      .eq('id', existing.id)
      .select()
      .single();

    if (updateError) {
      throw new Error(`Erro ao atualizar produto: ${updateError.message}`);
    }

    // Regra do Histórico: se o preço mudou, verificar se gera nova linha no histórico
    if (hasPriceChanged) {
      // Buscar o último preço gravado no histórico para este produto
      const { data: lastHistory, error: lastHistoryError } = await supabase
        .from('price_history')
        .select('*')
        .eq('product_id', existing.id)
        .order('recorded_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (lastHistoryError) {
        throw new Error(`Erro ao buscar último histórico: ${lastHistoryError.message}`);
      }

      if (lastHistory) {
        const lastRecordedPrice = Number(lastHistory.price);
        // Só registra se for queda de 10% ou mais (newPrice <= lastRecordedPrice * 0.9)
        const isSignificantDrop = price <= lastRecordedPrice * 0.9;

        if (isSignificantDrop) {
          const { error: historyError } = await supabase
            .from('price_history')
            .insert({
              product_id: existing.id,
              price,
              recorded_at: nowStr
            });

          if (historyError) {
            throw new Error(`Erro ao registrar preço no histórico: ${historyError.message}`);
          }
        }
      }
    }

    return {
      status: hasPriceChanged ? 'price_changed' : 'updated',
      data: { ...updated, originalPrice: product.originalPrice },
      shouldAlert
    };
  }
}

/**
 * Registra a indisponibilidade de um produto (quando o preço não é encontrado ou produto está sem estoque).
 * Incrementa consecutive_unavailable e, se atingir 3 consecutivos, atualiza o status para 'temporarily_unavailable'.
 * @param {string} asin ASIN do produto
 * @param {string} [store='amazon'] Loja
 * @returns {Promise<Object|null>} Registro atualizado ou null se não encontrado
 */
export async function registerProductUnavailability(asin, store = 'amazon') {
  const { data: existing, error: selectError } = await supabase
    .from('products')
    .select('*')
    .eq('store', store)
    .eq('external_id', asin)
    .maybeSingle();

  if (selectError) {
    throw new Error(`Erro ao buscar produto para indisponibilidade: ${selectError.message}`);
  }

  if (!existing) return null;

  const nowStr = new Date().toISOString();
  const nextFailures = (existing.consecutive_unavailable || 0) + 1;
  
  let status = existing.availability_status || 'active';
  if (nextFailures >= 3) {
    status = 'temporarily_unavailable';
    
    // Calcular dias desde o último sucesso de preço (ou first_seen_at)
    const referenceTimeStr = existing.last_available_at || existing.first_seen_at || nowStr;
    const referenceTime = new Date(referenceTimeStr);
    const msSinceAvailable = Date.now() - referenceTime.getTime();
    const daysSinceAvailable = msSinceAvailable / (1000 * 60 * 60 * 24);

    if (daysSinceAvailable >= 7) {
      status = 'inactive';
    }
  }

  const { data: updated, error: updateError } = await supabase
    .from('products')
    .update({
      consecutive_unavailable: nextFailures,
      last_unavailable_at: nowStr,
      availability_status: status,
      last_checked_at: nowStr
    })
    .eq('id', existing.id)
    .select()
    .single();

  if (updateError) {
    throw new Error(`Erro ao atualizar indisponibilidade do produto: ${updateError.message}`);
  }

  return updated;
}
