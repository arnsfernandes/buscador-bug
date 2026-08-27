import { chromium } from 'playwright';

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runSingleCycle(browser, cycleNum) {
  const searchTerm = 'notebook';
  const url = `https://www.amazon.com.br/s?k=${encodeURIComponent(searchTerm)}`;
  const startTime = Date.now();
  
  console.log(`[Ciclo ${cycleNum}] Iniciando coleta às ${new Date().toLocaleTimeString()}...`);
  
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: 'pt-BR',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  
  const page = await context.newPage();
  let result = {
    cycleNum,
    startTime: new Date().toLocaleTimeString(),
    duration: 0,
    finalUrl: '',
    totalFound: 0,
    validAsin: 0,
    validName: 0,
    validPrice: 0,
    validUrl: 0,
    isBlocked: false,
    products: []
  };

  try {
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    result.duration = ((Date.now() - startTime) / 1000).toFixed(2);
    result.finalUrl = page.url();
    const title = await page.title();
    const htmlContent = await page.content();
    
    // Identificar bloqueio/CAPTCHA
    result.isBlocked = htmlContent.includes('captcha') || 
                       htmlContent.includes('api-services-support@amazon.com') ||
                       htmlContent.includes('bm-verify') ||
                       htmlContent.includes('triggerInterstitialChallenge') ||
                       title.includes('Robot') ||
                       (response && response.status() === 503);

    if (result.isBlocked) {
      console.warn(`[Ciclo ${cycleNum}] Bloqueio detectado.`);
      return result;
    }

    // Extração no contexto do browser
    const extracted = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('div[data-asin]'));
      const list = [];
      
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
        let price = '';
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

        list.push({ asin, name, price, url: productUrl });
      }

      return list;
    });

    result.totalFound = extracted.length;
    
    // Mapear e validar propriedades
    extracted.forEach(item => {
      let isItemValid = true;
      
      if (item.asin && item.asin.trim().length > 0) result.validAsin++;
      if (item.name && item.name.trim().length > 0) result.validName++;
      if (item.price && item.price !== 'Não disponível' && item.price.trim().length > 0) result.validPrice++;
      if (item.url && item.url.trim().length > 0) result.validUrl++;

      result.products.push(item);
    });

    console.log(`[Ciclo ${cycleNum}] Finalizado: ${result.totalFound} itens mapeados em ${result.duration}s.`);

  } catch (error) {
    console.error(`[Ciclo ${cycleNum}] Erro durante a execução:`, error.message);
  } finally {
    await page.close();
    await context.close();
  }

  return result;
}

async function startConsistencyExperiment() {
  console.log('=== EXPERIMENTO DE CONSISTÊNCIA E REPETIBILIDADE ===');
  console.log('Serão executados 5 ciclos com intervalo de 30 segundos entre eles.\n');

  const browser = await chromium.launch({ headless: true });
  const cyclesResults = [];

  for (let i = 1; i <= 5; i++) {
    const result = await runSingleCycle(browser, i);
    cyclesResults.push(result);
    
    if (i < 5) {
      console.log(`Aguardando 30 segundos antes do ciclo ${i + 1}...\n`);
      await delay(30000);
    }
  }

  await browser.close();

  console.log('\n=== ANALISANDO DADOS DE CONSISTÊNCIA ===');

  // Mapear ASINs por ciclo e consolidar informações
  const allAsinsInfo = {}; // { asin: { cycles: Set, prices: Set, names: Set } }
  
  cyclesResults.forEach(c => {
    c.products.forEach(p => {
      if (!allAsinsInfo[p.asin]) {
        allAsinsInfo[p.asin] = {
          cycles: new Set(),
          prices: new Set(),
          names: new Set(),
          details: p
        };
      }
      allAsinsInfo[p.asin].cycles.add(c.cycleNum);
      if (p.price) allAsinsInfo[p.asin].prices.add(p.price);
      if (p.name) allAsinsInfo[p.asin].names.add(p.name);
    });
  });

  const totalUniqueAsins = Object.keys(allAsinsInfo).length;
  let presentInAllFive = 0;
  let volatileAsins = 0;
  let priceChanges = [];
  let nameInconsistencies = [];

  Object.entries(allAsinsInfo).forEach(([asin, info]) => {
    if (info.cycles.size === 5) {
      presentInAllFive++;
    } else {
      volatileAsins++;
    }

    if (info.prices.size > 1) {
      priceChanges.push({
        asin,
        name: info.details.name,
        prices: Array.from(info.prices)
      });
    }

    if (info.names.size > 1) {
      nameInconsistencies.push({
        asin,
        names: Array.from(info.names)
      });
    }
  });

  // Tabela/Resumo Geral
  console.log('\n========================= RESUMO DOS CICLOS =========================');
  console.log('Ciclo\tHora\tDurac.\tItens\tASIN\tNome\tPreço\tURL\tBloqueado?');
  cyclesResults.forEach(c => {
    console.log(`${c.cycleNum}\t${c.startTime}\t${c.duration}s\t${c.totalFound}\t${c.validAsin}\t${c.validName}\t${c.validPrice}\t${c.validUrl}\t${c.isBlocked ? 'SIM' : 'NÃO'}`);
  });
  console.log('=====================================================================');

  console.log('\n=== RESULTADO COMPILADO DA COMPARAÇÃO ===');
  console.log(`- Total de ASINs distintos mapeados no experimento: ${totalUniqueAsins}`);
  console.log(`- ASINs presentes em TODOS os 5 ciclos: ${presentInAllFive}`);
  console.log(`- ASINs voláteis (apareceram em alguns ciclos mas não em todos): ${volatileAsins}`);
  
  if (priceChanges.length > 0) {
    console.log(`- Alterações de preço detectadas: ${priceChanges.length}`);
    priceChanges.forEach(p => {
      console.log(`  * ASIN: ${p.asin} - Variações encontradas: [${p.prices.join(' | ')}]`);
    });
  } else {
    console.log('- Nenhuma flutuação de preço detectada durante o teste.');
  }

  if (nameInconsistencies.length > 0) {
    console.log(`- Inconsistências de dados no nome encontradas: ${nameInconsistencies.length}`);
  } else {
    console.log('- Nenhuma inconsistência de estrutura/nomes para o mesmo ASIN encontrada.');
  }

  console.log('\n=== CONCLUSÃO DE REPETIBILIDADE ===');
  if (cyclesResults.every(c => !c.isBlocked) && presentInAllFive > 0) {
    const consistencyPercentage = ((presentInAllFive / totalUniqueAsins) * 100).toFixed(1);
    console.log(`EVIDÊNCIA: A coleta foi altamente consistente. ${consistencyPercentage}% dos ASINs (${presentInAllFive} de ${totalUniqueAsins}) permaneceram estáveis em todas as execuções.`);
    console.log('A coleta se mostra REPETÍVEL e CONSISTENTE sob as mesmas condições.');
  } else if (cyclesResults.some(c => c.isBlocked)) {
    console.log('EVIDÊNCIA: A coleta apresenta instabilidade devido a bloqueios intermitentes do WAF da Amazon.');
  } else {
    console.log('EVIDÊNCIA: Baixa sobreposição de ASINs entre ciclos, indicando comportamento de listagem dinâmica ou rotatividade de anúncios patrocinados.');
  }
}

startConsistencyExperiment();
