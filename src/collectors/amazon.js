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
export async function collectAmazonProducts(searchTerm, pageNumber = 1) {
  const urlObj = new URL('https://www.amazon.com.br/s');
  urlObj.searchParams.set('k', searchTerm);
  if (pageNumber > 1) {
    urlObj.searchParams.set('page', pageNumber.toString());
  }
  const url = urlObj.toString();

  
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: 'pt-BR',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });

  const page = await context.newPage();

  try {
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
      throw new Error('A requisição foi bloqueada pelo WAF da Amazon (CAPTCHA / Desafio JS).');
    }

    // Extrai os elementos do DOM de forma síncrona no contexto do navegador
    const rawItems = await page.evaluate(() => {
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
    await page.close();
    await context.close();
    await browser.close();
  }
}
