import { chromium } from 'playwright';

/**
 * Normaliza o preço brasileiro (ex: "R$ 3.584,36") para um número decimal (Float).
 * @param {string} rawPrice
 * @returns {number|null}
 */
export function parseBrazilianPrice(rawPrice) {
  if (!rawPrice) return null;
  // Remove "R$", espaços, pontos de milhar e substitui a vírgula decimal por ponto
  const clean = rawPrice
    .replace(/R\$/gi, '')
    .replace(/[\s\u00a0]+/g, '')
    .replace(/\./g, '')
    .replace(/,/g, '.');
  
  const parsed = parseFloat(clean);
  return isNaN(parsed) ? null : parsed;
}

/**
 * Normaliza as URLs da Amazon para o formato simplificado /dp/ASIN.
 * @param {string} rawUrl
 * @param {string} asin
 * @returns {string}
 */
export function normalizeAmazonUrl(rawUrl, asin) {
  if (!rawUrl) return '';
  
  // Se for um link patrocinado (/sspa/click), tenta decodificar a URL destino real se ela contiver o ASIN
  if (rawUrl.includes('/sspa/click') && rawUrl.includes('url=%2F')) {
    try {
      const urlParam = new URL(rawUrl).searchParams.get('url');
      if (urlParam) {
        const decoded = decodeURIComponent(urlParam);
        if (decoded.includes(`/dp/${asin}`) || decoded.includes(`/gp/product/${asin}`)) {
          return `https://www.amazon.com.br/dp/${asin}`;
        }
      }
    } catch (e) {
      // Ignora erro e mantém o fluxo
    }
  }

  // Links normais da Amazon geralmente têm o formato /dp/ASIN ou /gp/product/ASIN
  if (asin && (rawUrl.includes(`/dp/${asin}`) || rawUrl.includes(`/gp/product/${asin}`))) {
    return `https://www.amazon.com.br/dp/${asin}`;
  }

  // Fallback caso não seja possível simplificar mantendo-a segura
  try {
    const urlObj = new URL(rawUrl);
    // Remove parâmetros comuns de tracking
    urlObj.search = '';
    return urlObj.toString();
  } catch (e) {
    return rawUrl;
  }
}

/**
 * Coleta produtos de uma busca na Amazon Brasil.
 * @param {string} searchTerm Termo a ser pesquisado.
 * @returns {Promise<{ products: Array, rawCount: number, discarded: Array }>}
 */
export async function collectAmazonProducts(searchTerm, pageNumber = 1, existingPage = null) {
  let page = existingPage;
  let browser = null;
  let context = null;

  if (!page) {
    browser = await chromium.launch({ headless: true, timeout: 15000 });
    context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      locale: 'pt-BR',
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    page = await context.newPage();
  }

  const urlObj = new URL('https://www.amazon.com.br/s');
  urlObj.searchParams.set('k', searchTerm);
  if (pageNumber > 1) {
    urlObj.searchParams.set('page', pageNumber.toString());
  }
  const url = urlObj.toString();

  try {
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 20000
    });

    const title = await page.title();
    const htmlContent = await page.content();

    // Verificação de CAPTCHA/Bloqueio
    const isBlocked = htmlContent.includes('captcha') || 
                      htmlContent.includes('api-services-support@amazon.com') ||
                      htmlContent.includes('bm-verify') ||
                      htmlContent.includes('triggerInterstitialChallenge') ||
                      title.includes('Robot') ||
                      (response && response.status() === 503);

    if (isBlocked) {
      throw new Error('A requisição foi bloqueada pelo WAF da Amazon (CAPTCHA / Desafio JS).');
    }

    // Extrai os elementos do DOM de forma síncrona no contexto do navegador
    const evaluatePromise = page.evaluate(() => {
      const elements = Array.from(document.querySelectorAll('div[data-asin]'));
      return elements.map(el => {
        const asin = el.getAttribute('data-asin')?.trim();
        
        let nameEl = el.querySelector('h2 a span') || el.querySelector('.a-size-base-plus.a-color-base.a-text-normal');
        const name = nameEl ? nameEl.textContent.trim() : '';

        let urlEl = el.querySelector('h2 a') || el.querySelector('a.a-link-normal');
        let relativeUrl = urlEl ? urlEl.getAttribute('href') : '';
        let productUrl = '';
        if (relativeUrl) {
          if (relativeUrl.startsWith('/')) {
            productUrl = 'https://www.amazon.com.br' + relativeUrl;
          } else {
            productUrl = relativeUrl;
          }
        }

        let price = '';
        let priceEl = el.querySelector('.a-price .a-offscreen');
        if (priceEl) {
          price = priceEl.textContent.trim();
        } else {
          let wholeEl = el.querySelector('.a-price-whole');
          let fractionEl = el.querySelector('.a-price-fraction');
          if (wholeEl) {
            price = 'R$ ' + wholeEl.textContent.trim() + (fractionEl ? ',' + fractionEl.textContent.trim() : '');
          }
        }

        return { asin, name, price, url: productUrl };
      });
    });

    // Timeout de segurança de 15 segundos para o evaluate
    const rawItems = await Promise.race([
      evaluatePromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout de 15 segundos na extração dos dados da página.')), 15000))
    ]);

    const rawCount = rawItems.length;
    const productsMap = new Map(); // Para deduzir duplicidades por ASIN
    const discarded = [];

    for (const item of rawItems) {
      // 1. Descartar se não houver ASIN
      if (!item.asin) {
        discarded.push({ item, reason: 'ASIN ausente ou vazio' });
        continue;
      }

      // 2. Descartar se não houver nome
      if (!item.name) {
        discarded.push({ item, reason: 'Nome do produto ausente' });
        continue;
      }

      // 3. Descartar se não houver URL
      if (!item.url) {
        discarded.push({ item, reason: 'URL do produto ausente' });
        continue;
      }

      // 4. Descartar se não houver preço
      if (!item.price || item.price.trim() === '') {
        discarded.push({ item, reason: 'Preço ausente' });
        continue;
      }

      const parsedPrice = parseBrazilianPrice(item.price);
      if (parsedPrice === null) {
        discarded.push({ item, reason: `Preço inválido para conversão numérica: "${item.price}"` });
        continue;
      }

      const cleanUrl = normalizeAmazonUrl(item.url, item.asin);

      const normalizedProduct = {
        asin: item.asin,
        name: item.name,
        price: parsedPrice,
        url: cleanUrl
      };

      // 5. Verificar duplicidades por ASIN
      if (productsMap.has(item.asin)) {
        discarded.push({ item: normalizedProduct, reason: `ASIN duplicado (já mapeado com ASIN ${item.asin})` });
        continue;
      }

      productsMap.set(item.asin, normalizedProduct);
    }

    return {
      products: Array.from(productsMap.values()),
      rawCount,
      discarded
    };

  } finally {
    if (!existingPage) {
      if (page) await page.close();
      if (context) await context.close();
      if (browser) await browser.close();
    }
  }
}

/**
 * Coleta detalhes de um único produto da Amazon (Nome e Preço).
 * @param {import('playwright').Page} page
 * @param {string} url
 * @returns {Promise<{ name: string, price: number|null, rawPrice: string, isBlocked: boolean, isUnavailable: boolean }>}
 */
export async function collectAmazonProductDetails(page, url) {
  const response = await page.goto(url, {
    waitUntil: 'domcontentloaded',
    timeout: 30000
  });

  const title = await page.title();
  const htmlContent = await page.content();

  // Verificação de CAPTCHA/Bloqueio
  const isBlocked = htmlContent.includes('captcha') || 
                    htmlContent.includes('api-services-support@amazon.com') ||
                    htmlContent.includes('bm-verify') ||
                    htmlContent.includes('triggerInterstitialChallenge') ||
                    title.includes('Robot') ||
                    (response && response.status() === 503);

  if (isBlocked) {
    return { name: '', price: null, rawPrice: '', isBlocked: true, isUnavailable: false };
  }

  // Verificação de indisponibilidade
  const isUnavailable = htmlContent.includes('Não disponível no momento') || 
                        htmlContent.includes('Sem estoque') || 
                        htmlContent.includes('out of stock') ||
                        htmlContent.includes('Não temos previsão de quando ou se este produto estará disponível');

  // Extrai nome e preço da página
  const extracted = await page.evaluate(() => {
    const titleEl = document.querySelector('#productTitle');
    const name = titleEl ? titleEl.textContent.trim() : '';

    // Seletores de preço em ordem de prioridade
    let priceText = '';
    const selectors = [
      '#corePriceDisplay_desktop_feature_div .a-price .a-offscreen',
      '#corePrice_feature_div .a-price .a-offscreen',
      '.priceToPay .a-offscreen',
      '#price_inside_buybox',
      '.apexPriceToPay .a-offscreen',
      '#priceblock_ourprice',
      '#priceblock_dealprice',
      'span[data-a-color="price"] .a-offscreen'
    ];

    for (const selector of selectors) {
      const priceEl = document.querySelector(selector);
      if (priceEl && priceEl.textContent.trim()) {
        priceText = priceEl.textContent.trim();
        break;
      }
    }

    if (!priceText) {
      // Fallback para whole e fraction
      const wholeEl = document.querySelector('.priceToPay .a-price-whole') || 
                      document.querySelector('#corePriceDisplay_desktop_feature_div .a-price-whole');
      const fractionEl = document.querySelector('.priceToPay .a-price-fraction') || 
                         document.querySelector('#corePriceDisplay_desktop_feature_div .a-price-fraction');
      if (wholeEl) {
        priceText = 'R$ ' + wholeEl.textContent.trim() + (fractionEl ? ',' + fractionEl.textContent.trim() : '');
      }
    }

    let originalPriceText = '';
    const originalSelectors = [
      '#corePriceDisplay_desktop_feature_div span.a-price.a-text-price span.a-offscreen',
      '#corePrice_desktop span.a-price.a-text-price span.a-offscreen',
      '.basisPrice .a-offscreen',
      '#corePriceDisplay_desktop_feature_div .a-size-small.a-color-secondary.a-text-strike',
      '#corePrice_feature_div .a-size-small.a-color-secondary.a-text-strike',
      'span.a-text-strike'
    ];
    for (const selector of originalSelectors) {
      const el = document.querySelector(selector);
      if (el && el.textContent.trim()) {
        originalPriceText = el.textContent.trim();
        break;
      }
    }

    return { name, priceText, originalPriceText };
  });

  const parsedPrice = parseBrazilianPrice(extracted.priceText);
  const parsedOriginalPrice = parseBrazilianPrice(extracted.originalPriceText);

  return {
    name: extracted.name,
    price: parsedPrice,
    originalPrice: parsedOriginalPrice,
    rawPrice: extracted.priceText,
    isBlocked: false,
    isUnavailable: isUnavailable && parsedPrice === null
  };
}

