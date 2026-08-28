import dotenv from 'dotenv';
import { runAmazonMonitor } from './run-amazon-monitor.js';

import { registerSuccess, registerFailure } from './repositories/service-health.js';

dotenv.config();

const intervalMinutes = parseFloat(process.env.MONITOR_INTERVAL_MINUTES || '1');
const intervalMs = intervalMinutes * 60 * 1000;
const mockTelegram = process.env.MOCK_TELEGRAM === 'true';

console.log('=== RUNNER CONTÍNUO DO NOVO MONITOR DIRETO AMAZON ===');
console.log(`- Intervalo entre ciclos: ${intervalMinutes} minuto(s) (${intervalMs} ms)`);
console.log(`- Pressione Ctrl+C para encerrar com segurança.\n`);

let isRunning = false;
let loopTimeout = null;
let shutdownSignaled = false;

async function executeCycle() {
  if (shutdownSignaled) return;

  if (isRunning) {
    console.log('[CONCORRÊNCIA] Ciclo anterior de monitoramento ainda em andamento. Pulando este ciclo.');
    return;
  }

  isRunning = true;
  const cycleStartTime = Date.now();
  console.log(`\n------------------------------------------------------------`);
  console.log(`[LOOP-MONITOR] Iniciando ciclo de monitoramento: ${new Date().toLocaleString()}`);
  console.log(`------------------------------------------------------------`);

  try {
    const limit = process.env.MONITOR_LIMIT ? parseInt(process.env.MONITOR_LIMIT, 10) : null;
    const stats = await runAmazonMonitor({ limit, mockTelegram });

    const duration = ((Date.now() - cycleStartTime) / 1000).toFixed(2);
    console.log(`------------------------------------------------------------`);
    console.log(`[LOOP-MONITOR] Ciclo finalizado. Duração total: ${duration}s.`);
    console.log(`Métricas consolidando:`);
    console.log(`  - Avaliados: ${stats.evaluatedCount}`);
    console.log(`  - Elegíveis: ${stats.eligibleCount} (HIGH: ${stats.eligibleHigh} | NORMAL: ${stats.eligibleNormal} | LOW: ${stats.eligibleLow})`);
    console.log(`  - Processados nesta rodada: ${stats.total}`);
    console.log(`  - Sucessos: ${stats.success}`);
    console.log(`  - Falhas (Bloqueios/Navegação/Inesperados): ${stats.blocked + stats.navigationError + stats.unexpectedError}`);
    console.log(`------------------------------------------------------------`);

    // Registra sucesso do ciclo
    try {
      await registerSuccess('amazon-monitor');
    } catch (dbErr) {
      console.error('[LOOP-MONITOR] Falha ao registrar sucesso na tabela de saúde:', dbErr.message);
    }

  } catch (error) {
    console.error(`------------------------------------------------------------`);
    console.error(`[LOOP-MONITOR] ERRO NO CICLO:`, error.stack || error.message);
    console.error(`------------------------------------------------------------`);

    // Registra falha do ciclo
    try {
      await registerFailure('amazon-monitor', error.message || String(error));
    } catch (dbErr) {
      console.error('[LOOP-MONITOR] Falha ao registrar falha na tabela de saúde:', dbErr.message);
    }
  } finally {
    isRunning = false;
    if (!shutdownSignaled) {
      const maxCycles = process.env.MAX_MONITOR_CYCLES ? parseInt(process.env.MAX_MONITOR_CYCLES) : Infinity;
      globalThis.monitorCycleCount = (globalThis.monitorCycleCount || 0) + 1;

      if (globalThis.monitorCycleCount >= maxCycles) {
        console.log(`\n[LOOP-MONITOR] Limite de ciclos atingido (${maxCycles} ciclos). Encerrando o runner...`);
        process.exit(0);
      } else {
        const nextRunTime = new Date(Date.now() + intervalMs);
        console.log(`Próxima execução agendada para: ${nextRunTime.toLocaleString()}`);
        loopTimeout = setTimeout(executeCycle, intervalMs);
      }
    }
  }
}

// Inicializa o primeiro ciclo
executeCycle();

// Tratamento de encerramento gracioso
function gracefulShutdown(signal) {
  if (shutdownSignaled) return;
  shutdownSignaled = true;

  console.log(`\n\n[SHUTDOWN-MONITOR] Recebido sinal ${signal}. Encerrando de forma segura...`);

  if (loopTimeout) {
    clearTimeout(loopTimeout);
    console.log('[SHUTDOWN-MONITOR] Próximo ciclo cancelado.');
  }

  if (isRunning) {
    console.log('[SHUTDOWN-MONITOR] Um ciclo de monitoramento está em andamento. Aguardando término...');
    setTimeout(() => {
      console.log('[SHUTDOWN-MONITOR] Saindo forçadamente após timeout de segurança.');
      process.exit(0);
    }, 15000);
  } else {
    console.log('[SHUTDOWN-MONITOR] Runner encerrado de forma limpa.');
    process.exit(0);
  }
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
