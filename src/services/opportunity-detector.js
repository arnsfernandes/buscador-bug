/**
 * Detecta e classifica oportunidades com base no preço atual e no preço de referência.
 * @param {number} currentPrice Preço atual do produto.
 * @param {number} referencePrice Preço de referência original do produto.
 * @returns {string} Classificação ('none', 'great_opportunity' ou 'bug').
 */
export function detectOpportunity(currentPrice, referencePrice, originalPrice = null) {
  if (!currentPrice || currentPrice <= 0) {
    return 'none';
  }

  // Queda histórica em relação ao reference_price do banco
  let historicalDrop = 0;
  if (referencePrice && referencePrice > 0) {
    historicalDrop = (referencePrice - currentPrice) / referencePrice;
  }

  // Queda da página em relação ao originalPrice (de tabela/tachado)
  let pageDrop = 0;
  if (originalPrice && originalPrice > 0 && originalPrice > currentPrice) {
    pageDrop = (originalPrice - currentPrice) / originalPrice;
  }

  // Classifica como BUG se qualquer um dos caminhos indicar queda >= 60%
  if (historicalDrop >= 0.60 || pageDrop >= 0.60) {
    return 'bug';
  } 
  
  // Oportunidade (great_opportunity) continua dependendo estritamente do histórico
  if (historicalDrop >= 0.40) {
    return 'great_opportunity';
  }

  return 'none';
}
