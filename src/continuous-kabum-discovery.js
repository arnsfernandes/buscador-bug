import dotenv from 'dotenv';
import { runKaBuMDiscovery } from './run-kabum-discovery.js';
import { registerSuccess, registerFailure } from './repositories/service-health.js';

dotenv.config();

// KaBuM Discovery interval defaults to 15 minutes
const intervalMinutes = parseFloat(process.env.KABUM_DISCOVERY_INTERVAL_MINUTES || '15');
const intervalMs = intervalMinutes * 60 * 1000;

console.log('=== RUNNER CONTÍNUO DE DESCOBERTA KABUM! INICIALIZADO ===');
console.log(`- Intervalo configurado: ${intervalMinutes} minutos (${intervalMs} ms)`);
console.log(`- Pressione Ctrl+C para encerrar com segurança.\n`);

let isRunning = false;
let loopTimeout = null;
let shutdownSignaled = false;

async function executeLoop() {
  if (shutdownSignaled) return;
  
  if (isRunning) {
    console.log('[CONCORRÊNCIA] Ciclo de descoberta KaBuM! anterior ainda em andamento. Pulando.');
    return;
  }

  isRunning = true;
  const cycleStartTime = Date.now();
  console.log(`\n------------------------------------------------------------`);
  console.log(`[LOOP-DESCOBERTA-KABUM] Iniciando ciclo de descoberta KaBuM!: ${new Date().toLocaleString()}`);
  console.log(`------------------------------------------------------------`);

  try {
    await runKaBuMDiscovery();
    const duration = ((Date.now() - cycleStartTime) / 1000).toFixed(2);
    console.log(`------------------------------------------------------------`);
    console.log(`[LOOP-DESCOBERTA-KABUM] Ciclo finalizado com sucesso. Duração: ${duration}s.`);
    console.log(`------------------------------------------------------------`);

    try {
      await registerSuccess('kabum-discovery');
    } catch (dbErr) {
      console.error('[LOOP-DESCOBERTA-KABUM] Falha ao registrar sucesso na tabela de saúde:', dbErr.message);
    }

  } catch (error) {
    console.error(`------------------------------------------------------------`);
    console.error(`[LOOP-DESCOBERTA-KABUM] ERRO NO CICLO:`, error.stack || error.message);
    console.error(`------------------------------------------------------------`);

    try {
      await registerFailure('kabum-discovery', error.message || String(error));
    } catch (dbErr) {
      console.error('[LOOP-DESCOBERTA-KABUM] Falha ao registrar falha na tabela de saúde:', dbErr.message);
    }
  } finally {
    isRunning = false;
    if (!shutdownSignaled) {
      const maxCycles = process.env.MAX_DISCOVERY_CYCLES ? parseInt(process.env.MAX_DISCOVERY_CYCLES) : Infinity;
      globalThis.discoveryCycleCount = (globalThis.discoveryCycleCount || 0) + 1;
      
      if (globalThis.discoveryCycleCount >= maxCycles) {
        console.log(`\n[LOOP-DESCOBERTA-KABUM] Limite de ciclos atingido (${maxCycles} ciclos). Encerrando...`);
        process.exit(0);
      } else {
        console.log(`Aguardando ${intervalMinutes} minutos para o próximo ciclo de descoberta KaBuM!...`);
        loopTimeout = setTimeout(executeLoop, intervalMs);
      }
    }
  }
}

executeLoop();

function gracefulShutdown(signal) {
  if (shutdownSignaled) return;
  shutdownSignaled = true;
  
  console.log(`\n\n[SHUTDOWN-DESCOBERTA-KABUM] Recebido sinal ${signal}. Encerrando...`);
  
  if (loopTimeout) {
    clearTimeout(loopTimeout);
  }

  if (isRunning) {
    console.log('[SHUTDOWN-DESCOBERTA-KABUM] Ciclo em execução. Aguardando término...');
    setTimeout(() => {
      process.exit(0);
    }, 15000);
  } else {
    console.log('[SHUTDOWN-DESCOBERTA-KABUM] Runner de descoberta encerrado de forma limpa.');
    process.exit(0);
  }
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
