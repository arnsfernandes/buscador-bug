import playwright from 'playwright';

/**
 * Coleta produtos de uma busca na KaBuM!
 * @param {string} searchTerm Termo a ser pesquisado.
 * @param {number} pageNumber Número da página.
 * @param {import('playwright').Page|null} existingPage Página existente opcional.
 * @returns {Promise<{ products: Array, rawCount: number, discarded: Array }>}
 */
export async function collectKaBuMProducts(searchTerm, pageNumber = 1, existingPage = null) {
  let page = existingPage;
  let browser = null;
  let context = null;

  if (!page) {
    browser = await playwright.chromium.launch({ headless: true, timeout: 15000 });
    context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      locale: 'pt-BR',
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    page = await context.newPage();
  }

  const url = `https://www.kabum.com.br/busca/${encodeURIComponent(searchTerm)}?page_number=${pageNumber}`;

  try {
    let response = null;
    if (url !== 'about:blank') {
      response = await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });
    }

    const nextDataStr = await page.evaluate(() => {
      const script = document.getElementById('__NEXT_DATA__');
      return script ? script.textContent : null;
    });

    const htmlContent = await page.content();
    const isBlocked = htmlContent.includes('bm-verify') ||
                      htmlContent.includes('challenge-platform') ||
                      (response && (response.status() === 503 || response.status() === 403));

    if (isBlocked && !nextDataStr) {
      throw new Error('A requisição foi bloqueada pelo WAF da KaBuM!.');
    }

    if (!nextDataStr) {
      throw new Error('Payload __NEXT_DATA__ não encontrado na página.');
    }

    const nextData = JSON.parse(nextDataStr);
    if (!nextData.props?.pageProps?.data) {
      return { products: [], rawCount: 0, discarded: [] };
    }

    const rawData = nextData.props.pageProps.data;
    const dataObj = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
    const rawProducts = dataObj.catalogServer?.data || [];

    const products = [];
    const discarded = [];

    rawProducts.forEach(p => {
      const isKaBuMSeller = p.sellerName === 'KaBuM!';
      const normalized = {
        external_id: p.code ? String(p.code) : null,
        name: p.name || '',
        price: p.priceWithDiscount ? Number(p.priceWithDiscount) : null,
        originalPrice: p.oldPrice ? Number(p.oldPrice) : null,
        seller: p.sellerName || 'KaBuM!',
        available: p.available === true || p.available === 'true',
        imageUrl: p.image || null,
        url: p.code ? `https://www.kabum.com.br/produto/${p.code}` : ''
      };

      if (isKaBuMSeller && normalized.external_id && normalized.price !== null) {
        products.push(normalized);
      } else {
        discarded.push(p);
      }
    });

    return {
      products,
      rawCount: rawProducts.length,
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
 * Coleta detalhes de um único produto da KaBuM! pelo ID/Código ou URL.
 * @param {import('playwright').Page} page
 * @param {string|number} codeOrUrl Código do produto (ID) ou URL completa.
 * @returns {Promise<{ name: string, price: number|null, originalPrice: number|null, imageUrl: string|null, isBlocked: boolean, isUnavailable: boolean }>}
 */
export async function collectKaBuMProductDetails(page, codeOrUrl) {
  const code = String(codeOrUrl).match(/^\d+$/) ? String(codeOrUrl) : String(codeOrUrl).match(/\/produto\/(\d+)/)?.[1];
  if (!code) {
    throw new Error(`Código do produto inválido ou não parseado: ${codeOrUrl}`);
  }

  const url = `https://www.kabum.com.br/produto/${code}`;

  let response = null;
  if (url !== 'about:blank') {
    response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
  }

  const nextDataStr = await page.evaluate(() => {
    const script = document.getElementById('__NEXT_DATA__');
    return script ? script.textContent : null;
  });

  const htmlContent = await page.content();
  const isBlocked = htmlContent.includes('bm-verify') ||
                    htmlContent.includes('challenge-platform') ||
                    (response && (response.status() === 503 || response.status() === 403));

  if (isBlocked && !nextDataStr) {
    return { name: '', price: null, originalPrice: null, imageUrl: null, isBlocked: true, isUnavailable: false };
  }

  if (!nextDataStr) {
    throw new Error('Payload __NEXT_DATA__ do produto não encontrado.');
  }

  const nextData = JSON.parse(nextDataStr);
  const p = nextData.props?.pageProps?.product;

  if (!p) {
    return { name: '', price: null, originalPrice: null, imageUrl: null, isBlocked: false, isUnavailable: true };
  }

  const isAvailable = p.available === true || p.available === 'true';
  const price = p.prices?.priceWithDiscount ? Number(p.prices.priceWithDiscount) : null;
  const originalPrice = p.prices?.oldPrice ? Number(p.prices.oldPrice) : null;

  // Obter maior resolução da imagem disponível nas mídias
  let imageUrl = p.thumbnail || null;
  if (p.medias && p.medias.length > 0) {
    const firstMedia = p.medias[0];
    if (firstMedia.type === 'image' && firstMedia.images) {
      imageUrl = firstMedia.images.gg || firstMedia.images.g || firstMedia.images.m || firstMedia.images.p || imageUrl;
    }
  }

  return {
    name: p.title || '',
    price: isAvailable ? price : null,
    originalPrice,
    imageUrl,
    isBlocked: false,
    isUnavailable: !isAvailable || price === null
  };
}
