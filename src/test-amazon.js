import * as cheerio from 'cheerio';

async function testAmazonSearch() {
  const searchTerm = 'notebook';
  const url = `https://www.amazon.com.br/s?k=${encodeURIComponent(searchTerm)}`;

  console.log(`Iniciando busca por: "${searchTerm}"...`);
  console.log(`URL de destino: ${url}\n`);

  // Cabeçalhos para simular uma requisição de navegador real e evitar CAPTCHAs simples
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Cache-Control': 'max-age=0'
  };

  try {
    const response = await fetch(url, { headers });
    
    console.log(`=== STATUS DA RESPOSTA ===`);
    console.log(`HTTP Status: ${response.status} ${response.statusText}`);
    
    const html = await response.text();
    const sizeKB = (html.length / 1024).toFixed(2);
    console.log(`Tamanho aproximado do HTML recebido: ${sizeKB} KB\n`);
    console.log("Prévia do HTML recebido (primeiros 1000 caracteres):");
    console.log(html.substring(0, 1000));
    console.log("\n--------------------------------------------------\n");

    // Carregar HTML no Cheerio
    const $ = cheerio.load(html);

    // Verificar se há indícios óbvios de CAPTCHA, desafio JS ou bloqueio
    const pageTitle = $('title').text().trim();
    console.log(`Título da página recebida: "${pageTitle}"`);

    const isBlocked = html.includes('api-services-support@amazon.com') ||
                      html.includes('captcha') ||
                      html.includes('bm-verify') ||
                      html.includes('triggerInterstitialChallenge') ||
                      pageTitle.includes('Robot') ||
                      response.status === 503;

    if (isBlocked) {
      console.warn('\n[BLOQUEIO DETECTADO] A requisição foi bloqueada pelo sistema de segurança/WAF da Amazon.');
      console.warn('Tipo de bloqueio identificado: Desafio Javascript / Akamai Bot Manager (presença de bm-verify/interstitial challenge).');
      console.warn('O conteúdo completo dos resultados da busca não pôde ser acessado.');
      return;
    }

    const products = [];

    // Seletores comuns da Amazon para itens de resultado
    // Normalmente divs com atributo data-asin preenchido
    $('div[data-asin]').each((index, element) => {
      const $el = $(element);
      const asin = $el.attr('data-asin')?.trim();

      // Pular itens que não possuem ASIN (anúncios vazios, espaçadores ou estruturas de layout)
      if (!asin) return;

      // Buscar nome do produto
      // Geralmente dentro de um h2 ou tag com classe de título normal
      let name = $el.find('h2 a span').text().trim();
      if (!name) {
        name = $el.find('.a-size-base-plus.a-color-base.a-text-normal').text().trim();
      }

      // Buscar link do produto
      let relativeUrl = $el.find('h2 a').attr('href') || $el.find('a.a-link-normal').attr('href');
      let productUrl = '';
      if (relativeUrl) {
        // Remover query parameters extras se desejar url limpa, ou manter completo
        if (relativeUrl.startsWith('/')) {
          productUrl = `https://www.amazon.com.br${relativeUrl}`;
        } else {
          productUrl = relativeUrl;
        }
      }

      // Buscar preço
      // Geralmente há uma tag offscreen (para leitores de tela) que contém o preço formatado ex: "R$ 2.500,00"
      let price = $el.find('.a-price .a-offscreen').first().text().trim();
      if (!price) {
        // Fallback construindo o preço pelo whole + fraction
        const whole = $el.find('.a-price-whole').first().text().trim();
        const fraction = $el.find('.a-price-fraction').first().text().trim();
        if (whole) {
          price = `R$ ${whole}${fraction ? ',' + fraction : ''}`;
        }
      }

      // Evitar registrar itens sem nome ou link (que podem ser layouts internos)
      if (name && productUrl) {
        products.push({
          asin,
          name,
          price: price || 'Não disponível',
          url: productUrl
        });
      }
    });

    console.log(`\n=== RESULTADO DA ANÁLISE ===`);
    console.log(`Quantidade total de itens com ASIN identificados: ${$('div[data-asin]').length}`);
    console.log(`Quantidade total de produtos mapeados com sucesso: ${products.length}`);

    if (products.length === 0) {
      console.log('Nenhum produto mapeado. Pode ter ocorrido uma mudança na estrutura do HTML ou bloqueio silencioso.');
      return;
    }

    console.log(`\n=== PRIMEIROS 10 PRODUTOS ENCONTRADOS ===`);
    const limit = Math.min(products.length, 10);
    for (let i = 0; i < limit; i++) {
      console.log(`\n[Produto ${i + 1}]`);
      console.log(`ASIN: ${products[i].asin}`);
      console.log(`Nome: ${products[i].name}`);
      console.log(`Preço: ${products[i].price}`);
      console.log(`URL: ${products[i].url}`);
    }

  } catch (error) {
    console.error('\nErro ao realizar requisição ou parsing:', error.message);
  }
}

testAmazonSearch();
