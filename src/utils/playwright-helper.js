/**
 * Fecha um recurso do Playwright (page ou context) com timeout de segurança.
 * @param {Object} target O recurso a ser fechado (page ou context)
 * @param {number} timeoutMs O tempo limite em milissegundos
 * @returns {Promise<void>}
 */
export async function closeWithTimeout(target, timeoutMs = 5000) {
  if (!target) return;
  try {
    await Promise.race([
      target.close(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout de fechamento do Playwright')), timeoutMs))
    ]);
  } catch (err) {
    console.warn(`[PLAYWRIGHT-CLEANUP] Falha/Timeout ao fechar objeto:`, err.message);
  }
}

/**
 * Fecha o navegador do Playwright com timeout de segurança.
 * Evita travamentos indefinidos se a conexão CDP com o Chromium cair.
 * @param {Object} browser Instância do browser do Playwright
 * @param {number} timeoutMs O tempo limite em milissegundos
 * @returns {Promise<void>}
 */
export async function closeBrowserWithTimeout(browser, timeoutMs = 5000) {
  if (!browser) return;
  try {
    await Promise.race([
      browser.close(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout ao fechar navegador')), timeoutMs))
    ]);
  } catch (err) {
    console.warn(`[PLAYWRIGHT-CLEANUP] Falha/Timeout no browser.close(): ${err.message}. Prosseguindo sem bloquear.`);
  }
}
