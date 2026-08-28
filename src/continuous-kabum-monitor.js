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

  try {
    const limit = process.env.MONITOR_LIMIT ? parseInt(process.env.MONITOR_LIMIT, 10) : null;
    const stats = await runKaBuMMonitor({ limit });

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
        const nextRunTime = new Date(Date.now() + intervalMs);
        console.log(`Próxima execução agendada para: ${nextRunTime.toLocaleString()}`);
        loopTimeout = setTimeout(executeCycle, intervalMs);
      }
    }
  }
}

executeCycle();

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
