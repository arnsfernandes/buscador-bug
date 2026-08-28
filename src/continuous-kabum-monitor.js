import dotenv from 'dotenv';
import { runKaBuMMonitor } from './run-kabum-monitor.js';
import { registerSuccess, registerFailure } from './repositories/service-health.js';
import { saveCrawlerCycleLog, getCrawlerTuningState } from './repositories/crawler-tuning.js';

dotenv.config();

const intervalMinutes = parseFloat(process.env.MONITOR_INTERVAL_MINUTES || '1');
const intervalMs = intervalMinutes * 60 * 1000;

console.log('=== RUNNER CONTÍNUO DO NOVO MONITOR DIRETO KABUM! ===');
console.log(`- Intervalo entre ciclos: ${intervalMinutes} minuto(s) (${intervalMs} ms)`);
console.log(`- Pressione Ctrl+C para encerrar com segurança.\n`);

// Carregar estado de tuning no startup
try {
  console.log('[STARTUP] Recuperando estado atual de auto-tuning do crawler...');
  const tuningState = await getCrawlerTuningState('kabum');
  console.log('[STARTUP] Estado recuperado:', tuningState);
} catch (tuningErr) {
  console.error('[STARTUP] Falha ao carregar estado de tuning:', tuningErr.message);
}

let isRunning = false;
let loopTimeout = null;
let shutdownSignaled = false;

async function executeCycle() {
  if (shutdownSignaled) return;

  if (isRunning) {
    console.log('[CONCORRÊNCIA] Ciclo anterior de monitoramento KaBuM! ainda em andamento. Pulando.');
    return;
  }

  isRunning = true;
  const cycleStartTime = Date.now();
  console.log(`\n------------------------------------------------------------`);
  console.log(`[LOOP-MONITOR-KABUM] Iniciando ciclo de monitoramento KaBuM!: ${new Date().toLocaleString()}`);
  console.log(`------------------------------------------------------------`);

  let stats = null;
  try {
    const limit = process.env.MONITOR_LIMIT ? parseInt(process.env.MONITOR_LIMIT, 10) : null;
    stats = await runKaBuMMonitor({ limit });

    const duration = ((Date.now() - cycleStartTime) / 1000).toFixed(2);
    console.log(`------------------------------------------------------------`);
    console.log(`[LOOP-MONITOR-KABUM] Ciclo finalizado. Duração total: ${duration}s.`);
    console.log(`Métricas:`);
    console.log(`  - Processados: ${stats.total}`);
    console.log(`  - Sucessos: ${stats.success}`);
    console.log(`  - Falhas (Bloqueios/Navegação/Inesperados): ${stats.blocked + stats.navigationError + stats.unexpectedError}`);
    console.log(`------------------------------------------------------------`);

    try {
      await registerSuccess('kabum-monitor');
    } catch (dbErr) {
      console.error('[LOOP-MONITOR-KABUM] Falha ao registrar sucesso na tabela de saúde:', dbErr.message);
    }

  } catch (error) {
    console.error(`------------------------------------------------------------`);
    console.error(`[LOOP-MONITOR-KABUM] ERRO NO CICLO:`, error.stack || error.message);
    console.error(`------------------------------------------------------------`);

    try {
      await registerFailure('kabum-monitor', error.message || String(error));
    } catch (dbErr) {
      console.error('[LOOP-MONITOR-KABUM] Falha ao registrar falha na tabela de saúde:', dbErr.message);
    }
  } finally {
    isRunning = false;
    if (!shutdownSignaled) {
      const maxCycles = process.env.MAX_MONITOR_CYCLES ? parseInt(process.env.MAX_MONITOR_CYCLES) : Infinity;
      globalThis.monitorCycleCount = (globalThis.monitorCycleCount || 0) + 1;

      if (globalThis.monitorCycleCount >= maxCycles) {
        console.log(`\n[LOOP-MONITOR-KABUM] Limite de ciclos atingido (${maxCycles} ciclos). Encerrando...`);
        process.exit(0);
      } else {
        const durationSec = stats ? (Date.now() - cycleStartTime) / 1000 : 0;
        const targetRevisitMin = stats ? calculateAdaptiveInterval(stats, durationSec) : 1;
        const durationMin = durationSec / 60;
        const sleepMin = Math.max(0, targetRevisitMin - durationMin);
        const sleepMs = sleepMin * 60 * 1000;
        const effectiveIntervalMin = durationMin + sleepMin;

        console.log(`[ADAPTATIVE-FREQ] Agendamento do próximo ciclo:`);
        console.log(`  - Duração do ciclo: ${durationSec.toFixed(1)}s (${durationMin.toFixed(2)} min)`);
        console.log(`  - Target de revisita: ${targetRevisitMin} min`);
        console.log(`  - Sleep calculado: ${(sleepMs / 1000).toFixed(1)}s (${sleepMin.toFixed(2)} min)`);
        console.log(`  - Intervalo efetivo estimado: ${effectiveIntervalMin.toFixed(2)} min`);

        // Salvar log do ciclo de forma assíncrona
        if (stats) {
          saveCrawlerCycleLog({
            store: 'kabum',
            startedAt: new Date(cycleStartTime),
            finishedAt: new Date(),
            durationSec: durationSec,
            totalProcessed: stats.total || 0,
            successCount: stats.success || 0,
            errorCount: (stats.unexpectedError || 0) + (stats.navigationError || 0),
            wafCount: stats.blocked || 0,
            httpDirectCount: stats.usedHttp || 0,
            fallbackPlaywrightCount: stats.usedFallback || 0,
            targetRevisitMinutes: targetRevisitMin
          }).then(() => {
            console.log(`[LOOP-MONITOR-KABUM] Métricas do ciclo salvas no banco de dados.`);
          }).catch(logErr => {
            console.error('[LOOP-MONITOR-KABUM] Falha ao salvar log de ciclo no banco:', logErr.message);
          });
        }

        const nextRunTime = new Date(Date.now() + sleepMs);
        console.log(`Próxima execução agendada para: ${nextRunTime.toLocaleString()}`);
        loopTimeout = setTimeout(executeCycle, sleepMs);
      }
    }
  }
}

import { fileURLToPath } from 'url';
const entryPath = fileURLToPath(import.meta.url);
if (process.argv[1] === entryPath) {
  executeCycle();
}

function gracefulShutdown(signal) {
  if (shutdownSignaled) return;
  shutdownSignaled = true;

  console.log(`\n\n[SHUTDOWN-MONITOR-KABUM] Recebido sinal ${signal}. Encerrando...`);

  if (loopTimeout) {
    clearTimeout(loopTimeout);
  }

  if (isRunning) {
    console.log('[SHUTDOWN-MONITOR-KABUM] Ciclo em andamento. Aguardando término...');
    setTimeout(() => {
      process.exit(0);
    }, 15000);
  } else {
    console.log('[SHUTDOWN-MONITOR-KABUM] Runner encerrado de forma limpa.');
    process.exit(0);
  }
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

/**
 * Calcula o próximo intervalo de espera em minutos para a frequência adaptativa.
 * @param {Object} stats Estatísticas retornadas pela varredura runKaBuMMonitor
 * @param {number} durationSec Duração da varredura em segundos
 * @returns {number} Próximo intervalo em minutos
 */
export function calculateAdaptiveInterval(stats, durationSec) {
  const catalogCount = stats.catalogCount || 0;
  const totalProcessed = stats.total || 0;
  const failures = (stats.blocked || 0) + (stats.navigationError || 0) + (stats.unexpectedError || 0);
  const failureRate = totalProcessed > 0 ? failures / totalProcessed : 0;
  const fallbackRate = totalProcessed > 0 ? (stats.usedFallback || 0) / totalProcessed : 0;

  console.log(`[ADAPTATIVE-FREQ] Calculando alvo de revisita (Fórmula Real Decoplada):`);
  console.log(`  - Catálogo total KaBuM!: ${catalogCount} produtos`);
  console.log(`  - Processados no ciclo: ${totalProcessed} produtos`);
  console.log(`  - Duração do ciclo: ${durationSec.toFixed(1)}s`);
  console.log(`  - Taxa de falhas/erros: ${(failureRate * 100).toFixed(1)}%`);
  console.log(`  - Taxa de fallbacks Playwright: ${(fallbackRate * 100).toFixed(1)}%`);
  console.log(`  - Prioridades: P3 (High/BUG): ${stats.priority3Count || 0} | P2 (Medium): ${stats.priority2Count || 0} | P1 (Low): ${stats.priority1Count || 0}`);

  // 1. Target base saudável (1 minuto)
  let target = 1;

  // 2. Proteção secundária por tamanho de catálogo (+1 minuto a cada 5.000 produtos)
  const catalogPenalty = Math.floor(catalogCount / 5000);
  if (catalogPenalty > 0) {
    target += catalogPenalty;
    console.log(`  -> Proteção de Catálogo (+1 min por 5.000 prods): +${catalogPenalty} min.`);
  }

  // 3. Prioridade Extra (Desconto de tempo se houver itens com queda de preço ativa)
  if ((stats.priority3Count || 0) > 0) {
    target = Math.max(1, target - 2);
    console.log(`  -> Prioridade Extra (P3 > 0): Desconto de -2 minutos aplicado.`);
  } else if ((stats.priority2Count || 0) > 0) {
    target = Math.max(1, target - 1);
    console.log(`  -> Prioridade Extra (P2 > 0): Desconto de -1 minuto aplicado.`);
  }

  // 4. Cooldown forte e progressivo por WAF/Erros ou Fallbacks
  const instabilityFactor = Math.max(failureRate, fallbackRate);
  let multiplier = 1;

  if (instabilityFactor > 0.8) {
    multiplier = 5;
    console.log(`  -> Cooldown Extremo (instabilidade > 80%): Multiplicador x5.`);
  } else if (instabilityFactor > 0.5) {
    multiplier = 3;
    console.log(`  -> Cooldown Forte (instabilidade > 50%): Multiplicador x3.`);
  } else if (instabilityFactor > 0.2) {
    multiplier = 2;
    console.log(`  -> Cooldown Moderado (instabilidade > 20%): Multiplicador x2.`);
  } else if (instabilityFactor > 0.05) {
    multiplier = 1.5;
    console.log(`  -> Cooldown Leve (instabilidade > 5%): Multiplicador x1.5.`);
  }

  let finalTargetRevisit = Math.round(target * multiplier);

  // 5. Aplicar limites rígidos (mínimo de 1 minuto, máximo de 30 minutos)
  finalTargetRevisit = Math.max(1, Math.min(30, finalTargetRevisit));
  console.log(`  -> [RESULTADO] Alvo de revisita (Target) definido em: ${finalTargetRevisit} minuto(s).`);

  return finalTargetRevisit;
}
