import { chromium } from 'playwright';

async function testAmazonBrowser() {
  const searchTerm = 'notebook';
  const url = `https://www.amazon.com.br/s?k=${encodeURIComponent(searchTerm)}`;

  console.log(`Iniciando busca automatizada por: "${searchTerm}" usando Playwright...`);
  console.log(`URL de destino: ${url}\n`);

  const startTime = Date.now();
  let browser;

  try {
    // Inicializa o navegador Chromium em modo headless (sem interface gráfica)
    browser = await chromium.launch({
      headless: true
    });

    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      locale: 'pt-BR',
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });

    const page = await context.newPage();

    // Navega para a URL da Amazon
    console.log('Navegando até a página de busca...');
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    const loadTime = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`Página carregada em: ${loadTime}s`);

    const finalUrl = page.url();
    const title = await page.title();
    const htmlContent = await page.content();

    console.log(`\n=== STATUS DO NAVEGADOR ===`);
    console.log(`URL Final: ${finalUrl}`);
    console.log(`Título da Página: "${title}"`);
    console.log(`Status HTTP: ${response ? response.status() : 'Não disponível'}`);

    // Detectar bloqueios conhecidos ou CAPTCHA
    const isCaptcha = htmlContent.includes('captcha') || 
                      htmlContent.includes('api-services-support@amazon.com') ||
                      htmlContent.includes('bm-verify') ||
                      htmlContent.includes('triggerInterstitialChallenge') ||
                      title.includes('Robot') ||
                      (response && response.status() === 503);

    if (isCaptcha) {
      console.warn('\n[BLOQUEIO DETECTADO] A requisição foi bloqueada pelo sistema de segurança/WAF da Amazon no navegador.');
      console.warn('O conteúdo real dos resultados da busca não pôde ser carregado.');
      await browser.close();
      return;
    }

    // Extrair dados diretamente de forma síncrona dentro da página (evitando timeouts de roundtrips)
    const extractionResult = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('div[data-asin]'));
      const totalAsinElements = items.length;
      
      const mapped = [];
      for (const el of items) {
        const asin = el.getAttribute('data-asin')?.trim();
        if (!asin) continue;

        // Título/Nome do produto
        let nameEl = el.querySelector('h2 a span') || el.querySelector('.a-size-base-plus.a-color-base.a-text-normal');
        const name = nameEl ? nameEl.textContent.trim() : '';

        // URL do produto
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

        // Preço
        let price = 'Não disponível';
        let priceEl = el.querySelector('.a-price .a-offscreen');
        if (priceEl) {
          price = priceEl.textContent.trim();
        } else {
          let wholeEl = el.querySelector('.a-price-whole');
          let fractionEl = el.querySelector('.a-price-fraction');
          if (wholeEl) {
            const whole = wholeEl.textContent.trim();
            const fraction = fractionEl ? fractionEl.textContent.trim() : '';
            price = 'R$ ' + whole + (fraction ? ',' + fraction : '');
          }
        }

        if (name && productUrl) {
          mapped.push({ asin, name, price, url: productUrl });
        }
      }

      return {
        totalAsinElements,
        mapped
      };
    });

    console.log(`\n=== RESULTADO DA ANÁLISE ===`);
    console.log(`Quantidade de elementos data-asin encontrados no DOM: ${extractionResult.totalAsinElements}`);
    console.log(`Quantidade total de produtos mapeados com sucesso: ${extractionResult.mapped.length}`);

    if (extractionResult.mapped.length === 0) {
      console.log('Nenhum produto mapeado. Possível alteração de layout ou carregamento incorreto.');
    } else {
      console.log(`\n=== PRIMEIROS 10 PRODUTOS ENCONTRADOS ===`);
      const limit = Math.min(extractionResult.mapped.length, 10);
      for (let i = 0; i < limit; i++) {
        const prod = extractionResult.mapped[i];
        console.log(`\n[Produto ${i + 1}]`);
        console.log(`ASIN: ${prod.asin}`);
        console.log(`Nome: ${prod.name}`);
        console.log(`Preço: ${prod.price}`);
        console.log(`URL: ${prod.url}`);
      }
    }

  } catch (error) {
    console.error('\nOcorreu um erro durante a automação:', error);
  } finally {
    if (browser) {
      await browser.close();
      console.log('\nNavegador fechado corretamente.');
    }
  }
}

testAmazonBrowser();
