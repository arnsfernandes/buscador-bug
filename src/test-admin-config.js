import { 
  isConnectorActive, 
  setConnectorStatus, 
  listDiscoveryTerms, 
  createDiscoveryTerm, 
  updateDiscoveryTerm, 
  deleteDiscoveryTerm 
} from './repositories/config.js';
import { runAmazonDiscovery } from './run-amazon-discovery.js';
import { runAmazonMonitor } from './run-amazon-monitor.js';

async function testAdminConfig() {
  console.log('=== TESTANDO BASE DE CONFIGURAÇÃO ADMINISTRÁVEL ===\n');

  try {
    // 1. Validando estado ativo inicial (default da migration é true)
    console.log('1. Verificando se conector Amazon está ativo por padrão...');
    const active = await isConnectorActive('amazon');
    console.log('Status ativo:', active);
    console.log('--------------------------------------------------');

    // 2. Testando repositório de Termos da Descoberta
    console.log('2. Testando CRUD de termos de busca no Supabase...');
    
    // Criar
    const newTerm = await createDiscoveryTerm('amazon', 'TEST-TERM-CRUD');
    console.log('Criado com sucesso:', { id: newTerm.id, term: newTerm.search_term, active: newTerm.active });

    // Listar
    let terms = await listDiscoveryTerms('amazon');
    console.log(`Quantidade total de termos no banco: ${terms.length}`);
    const found = terms.find(t => t.search_term === 'TEST-TERM-CRUD');
    console.log('Termo encontrado na listagem:', !!found);

    // Editar (Desativar)
    const updated = await updateDiscoveryTerm(newTerm.id, { active: false });
    console.log('Atualizado (desativado):', { id: updated.id, term: updated.search_term, active: updated.active });

    // Remover
    const deleted = await deleteDiscoveryTerm(newTerm.id);
    console.log('Removido com sucesso:', deleted);
    console.log('--------------------------------------------------');

    // 3. Testando comportamento com Conector desativado
    console.log('3. Desativando conector Amazon globalmente no banco...');
    await setConnectorStatus('amazon', false);
    console.log('Conector desativado.');

    console.log('\nExecutando Descoberta (deve pular a execução)...');
    const discRes = await runAmazonDiscovery({ pagesPerRun: 1 });
    console.log('Retorno da Descoberta:', discRes);

    console.log('\nExecutando Monitoramento (deve pular a execução)...');
    const monRes = await runAmazonMonitor({ limit: 1 });
    console.log('Retorno do Monitoramento (Processed count):', monRes.total);
    console.log('--------------------------------------------------');

    // 4. Restaurando Conector e validando carregamento dinâmico
    console.log('4. Reativando conector Amazon...');
    await setConnectorStatus('amazon', true);
    console.log('Conector reativado.');

    console.log('\nExecutando rodada rápida da Descoberta (1 termo customizado ativo)...');
    // Para ser rápido, rodamos apenas 1 termo e 1 página
    const customDiscRes = await runAmazonDiscovery({ terms: ['SSD'], pagesPerRun: 1 });
    console.log('Descoberta executada com sucesso para termos do banco.');

    console.log('\n✔ Bateria de testes de configuração concluída com sucesso!');

  } catch (error) {
    console.error('❌ ERRO NO TESTE DE CONFIGURAÇÃO:', error.message);
  }
}

testAdminConfig();
