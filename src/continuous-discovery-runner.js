import dotenv from 'dotenv';
import { runAmazonDiscovery } from './run-amazon-discovery.js';

import { registerSuccess, registerFailure } from './repositories/service-health.js';

// Carrega variáveis do arquivo .env
dotenv.config();

// Configura o intervalo (default: 30 minutos)
const intervalMinutes = parseFloat(process.env.DISCOVERY_INTERVAL_MINUTES || '30');
const intervalMs = intervalMinutes * 60 * 1000;

console.log('=== RUNNER CONTÍNUO DE DESCOBERTA AMAZON INICIALIZADO ===');
console.log(`- Intervalo configurado: ${intervalMinutes} minutos (${intervalMs} ms)`);
console.log(`- Pressione Ctrl+C para encerrar com segurança.\n`);

let isRunning = false;
let loopTimeout = null;
let shutdownSignaled = false;

async function executeLoop() {
  if (shutdownSignaled) return;
  
  if (isRunning) {
    console.log('[CONCORRÊNCIA] Ciclo de descoberta anterior ainda em andamento. Pulando para evitar sobreposição.');
    return;
  }

  isRunning = true;
  const cycleStartTime = Date.now();
  console.log(`\n------------------------------------------------------------`);
  console.log(`[LOOP-DESCOBERTA] Iniciando ciclo de descoberta: ${new Date().toLocaleString()}`);
  console.log(`------------------------------------------------------------`);

  try {
    await runAmazonDiscovery();
    const duration = ((Date.now() - cycleStartTime) / 1000).toFixed(2);
    console.log(`------------------------------------------------------------`);
    console.log(`[LOOP-DESCOBERTA] Ciclo finalizado com sucesso. Duração: ${duration}s.`);
    console.log(`------------------------------------------------------------`);

    // Registra sucesso do ciclo
    try {
      await registerSuccess('amazon-discovery');
    } catch (dbErr) {
      console.error('[LOOP-DESCOBERTA] Falha ao registrar sucesso na tabela de saúde:', dbErr.message);
    }

  } catch (error) {
    console.error(`------------------------------------------------------------`);
    console.error(`[LOOP-DESCOBERTA] ERRO NO CICLO:`, error.stack || error.message);
    console.error(`------------------------------------------------------------`);

    // Registra falha do ciclo
    try {
      await registerFailure('amazon-discovery', error.message || String(error));
    } catch (dbErr) {
      console.error('[LOOP-DESCOBERTA] Falha ao registrar falha na tabela de saúde:', dbErr.message);
    }
  } finally {
    isRunning = false;
    if (!shutdownSignaled) {
      const maxCycles = process.env.MAX_DISCOVERY_CYCLES ? parseInt(process.env.MAX_DISCOVERY_CYCLES) : Infinity;
      globalThis.discoveryCycleCount = (globalThis.discoveryCycleCount || 0) + 1;
      
      if (globalThis.discoveryCycleCount >= maxCycles) {
        console.log(`\n[LOOP-DESCOBERTA] Limite de ciclos atingido (${maxCycles} ciclos). Encerrando o runner de descoberta...`);
        process.exit(0);
      } else {
        console.log(`Aguardando ${intervalMinutes} minutos para o próximo ciclo de descoberta...`);
        loopTimeout = setTimeout(executeLoop, intervalMs);
      }
    }
  }
}

// Inicializa o primeiro ciclo
executeLoop();

// Tratamento de encerramento gracioso
function gracefulShutdown(signal) {
  if (shutdownSignaled) return;
  shutdownSignaled = true;
  
  console.log(`\n\n[SHUTDOWN-DESCOBERTA] Recebido sinal ${signal}. Encerrando o runner...`);
  
  if (loopTimeout) {
    clearTimeout(loopTimeout);
    console.log('[SHUTDOWN-DESCOBERTA] Próximo ciclo agendado cancelado.');
  }

  if (isRunning) {
    console.log('[SHUTDOWN-DESCOBERTA] Um ciclo está atualmente em execução. Aguardando término antes de sair...');
    setTimeout(() => {
      console.log('[SHUTDOWN-DESCOBERTA] Saindo forçadamente após timeout de segurança.');
      process.exit(0);
    }, 15000);
  } else {
    console.log('[SHUTDOWN-DESCOBERTA] Runner encerrado de forma limpa.');
    process.exit(0);
  }
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
