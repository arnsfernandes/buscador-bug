import dotenv from 'dotenv';
import { runKaBuMMonitor } from './run-kabum-monitor.js';
import { registerSuccess, registerFailure } from './repositories/service-health.js';

dotenv.config();

const intervalMinutes = parseFloat(process.env.MONITOR_INTERVAL_MINUTES || '1');
const intervalMs = intervalMinutes * 60 * 1000;

console.log('=== RUNNER CONTÍNUO DO NOVO MONITOR DIRETO KABUM! ===');
console.log(`- Intervalo entre ciclos: ${intervalMinutes} minuto(s) (${intervalMs} ms)`);
console.log(`- Pressione Ctrl+C para encerrar com segurança.\n`);

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
        const nextIntervalMin = stats ? calculateAdaptiveInterval(stats, durationSec) : 1;
        const nextIntervalMs = nextIntervalMin * 60 * 1000;

        const nextRunTime = new Date(Date.now() + nextIntervalMs);
        console.log(`Próxima execução agendada para: ${nextRunTime.toLocaleString()} (Intervalo adaptativo: ${nextIntervalMin} min)`);
        loopTimeout = setTimeout(executeCycle, nextIntervalMs);
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

  console.log(`[ADAPTATIVE-FREQ] Calculando próximo intervalo adaptativo (Fórmula Otimizada):`);
  console.log(`  - Catálogo total KaBuM!: ${catalogCount} produtos`);
  console.log(`  - Processados no ciclo: ${totalProcessed} produtos`);
  console.log(`  - Duração do ciclo: ${durationSec.toFixed(1)}s`);
  console.log(`  - Taxa de falhas/erros: ${(failureRate * 100).toFixed(1)}%`);
  console.log(`  - Taxa de fallbacks Playwright: ${(fallbackRate * 100).toFixed(1)}%`);
  console.log(`  - Prioridades: P3 (High/BUG): ${stats.priority3Count || 0} | P2 (Medium): ${stats.priority2Count || 0} | P1 (Low): ${stats.priority1Count || 0}`);

  // 1. Base inicial curta para catálogo pequeno e saudável (1 minuto)
  let subtotal = 1;

  // 2. Penalidade por tamanho de catálogo (+1 minuto por 1.000 itens)
  const catalogPenalty = Math.floor(catalogCount / 1000);
  if (catalogPenalty > 0) {
    subtotal += catalogPenalty;
    console.log(`  -> Penalidade por tamanho de catálogo (+1 min por 1.000 prods): +${catalogPenalty} min.`);
  }

  // 3. Penalidade por duração longa do ciclo (+1 minuto por 3 minutos/180s de execução)
  const durationPenalty = Math.floor(durationSec / 180);
  if (durationPenalty > 0) {
    subtotal += durationPenalty;
    console.log(`  -> Penalidade por duração longa do ciclo (+1 min por 3 min de execução): +${durationPenalty} min.`);
  }

  // 4. Prioridade Extra (Desconto de tempo se houver itens com queda de preço ativa)
  if ((stats.priority3Count || 0) > 0) {
    subtotal = Math.max(1, subtotal - 2);
    console.log(`  -> Prioridade Extra (P3 > 0): Desconto de -2 minutos aplicado.`);
  } else if ((stats.priority2Count || 0) > 0) {
    subtotal = Math.max(1, subtotal - 1);
    console.log(`  -> Prioridade Extra (P2 > 0): Desconto de -1 minuto aplicado.`);
  }

  // 5. Cooldown forte e progressivo por WAF/Erros ou Fallbacks
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

  let finalIntervalMin = Math.round(subtotal * multiplier);

  // 6. Aplicar limites rígidos (mínimo de 1 minuto, máximo de 30 minutos)
  finalIntervalMin = Math.max(1, Math.min(30, finalIntervalMin));
  console.log(`  -> [RESULTADO] Intervalo adaptativo final definido em: ${finalIntervalMin} minuto(s).`);

  return finalIntervalMin;
}
