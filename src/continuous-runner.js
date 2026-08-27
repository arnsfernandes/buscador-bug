import dotenv from 'dotenv';
import { runLiveCycle } from './run-live-cycle.js';

// Carrega variáveis do arquivo .env
dotenv.config();

// Configura o intervalo (default: 5 minutos)
const intervalMinutes = parseFloat(process.env.COLLECTION_INTERVAL_MINUTES || '5');
const intervalMs = intervalMinutes * 60 * 1000;

console.log('=== RUNNER CONTÍNUO DO BUSCADOR BUG INICIALIZADO ===');
console.log(`- Intervalo configurado: ${intervalMinutes} minutos (${intervalMs} ms)`);
console.log(`- Pressione Ctrl+C para encerrar com segurança.\n`);

let isRunning = false;
let loopTimeout = null;
let shutdownSignaled = false;

async function executeLoop() {
  if (shutdownSignaled) return;
  
  if (isRunning) {
    console.log('[CONCORRÊNCIA] Ciclo anterior ainda em andamento. Pulando este ciclo para evitar sobreposição.');
    return;
  }

  isRunning = true;
  const cycleStartTime = Date.now();
  console.log(`\n------------------------------------------------------------`);
  console.log(`[LOOP] Iniciando novo ciclo contínuo: ${new Date().toLocaleString()}`);
  console.log(`------------------------------------------------------------`);

  try {
    await runLiveCycle();
    const duration = ((Date.now() - cycleStartTime) / 1000).toFixed(2);
    console.log(`------------------------------------------------------------`);
    console.log(`[LOOP] Ciclo finalizado com sucesso. Duração: ${duration}s.`);
    console.log(`------------------------------------------------------------`);
  } catch (error) {
    console.error(`------------------------------------------------------------`);
    console.error(`[LOOP] ERRO NO CICLO:`, error.stack || error.message);
    console.error(`------------------------------------------------------------`);
  } finally {
    isRunning = false;
    if (!shutdownSignaled) {
      const maxCycles = process.env.MAX_CYCLES ? parseInt(process.env.MAX_CYCLES) : Infinity;
      globalThis.cycleCount = (globalThis.cycleCount || 0) + 1;
      
      if (globalThis.cycleCount >= maxCycles) {
        console.log(`\n[LOOP] Limite de ciclos atingido (${maxCycles} ciclos). Encerrando o runner de forma limpa...`);
        process.exit(0);
      } else {
        console.log(`Aguardando ${intervalMinutes} minutos para o próximo ciclo...`);
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
  
  console.log(`\n\n[SHUTDOWN] Recebido sinal ${signal}. Encerrando o runner de forma segura...`);
  
  if (loopTimeout) {
    clearTimeout(loopTimeout);
    console.log('[SHUTDOWN] Próximo ciclo agendado cancelado.');
  }

  if (isRunning) {
    console.log('[SHUTDOWN] Um ciclo está atualmente em execução. Aguardando término antes de sair...');
    // Aguardando até 15 segundos para sair caso um scraping esteja rodando
    setTimeout(() => {
      console.log('[SHUTDOWN] Saindo forçadamente após timeout de segurança.');
      process.exit(0);
    }, 15000);
  } else {
    console.log('[SHUTDOWN] Runner encerrado de forma limpa.');
    process.exit(0);
  }
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
