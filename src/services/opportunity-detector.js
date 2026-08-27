/**
 * Detecta e classifica oportunidades com base no preço atual e no preço de referência.
 * @param {number} currentPrice Preço atual do produto.
 * @param {number} referencePrice Preço de referência original do produto.
 * @returns {string} Classificação ('none', 'great_opportunity' ou 'bug').
 */
export function detectOpportunity(currentPrice, referencePrice) {
  if (!referencePrice || referencePrice <= 0 || !currentPrice || currentPrice <= 0) {
    return 'none';
  }

  const dropPercentage = (referencePrice - currentPrice) / referencePrice;

  if (dropPercentage >= 0.60) {
    return 'bug';
  } else if (dropPercentage >= 0.40) {
    return 'great_opportunity';
  }

  return 'none';
}
