#!/usr/bin/env node

import { loadConfig } from './config.js';
import { setLogLevel, createLogger } from './utils/logger.js';
import { openDatabase, closeDatabase } from './db/connection.js';
import * as queries from './db/queries.js';
import { createProvider } from './rag/embeddings.js';
import { IndexManager } from './rag/index-manager.js';
import { createReadTools } from './tools/read-tools.js';
import { createWriteTools } from './tools/write-tools.js';
import { createMcpServer, startStdioServer } from './server.js';
import { AutoIndexer } from './indexer/auto-indexer.js';

const log = createLogger('main');

async function main() {
  // 1. Config
  const config = loadConfig();
  setLogLevel(config.logLevel);
  log.info('Bear Notes MCP server starting...');

  // 2. Database
  let db;
  try {
    openDatabase(config.bearDbPath);
    db = queries;
    log.info('Database ready');
  } catch (error) {
    log.error('Failed to open database:', error.message);
    process.exit(1);
  }

  // 3. Embedding provider + index (graceful degradation)
  let provider = null;
  let indexManager = null;
  let hasSemanticSearch = false;

  try {
    provider = await createProvider(config);
    log.info('Embedding provider initialized');

    // Health check
    try {
      await provider.healthCheck();
      log.info('Provider health check passed');
    } catch (error) {
      log.warn('Provider health check failed:', error.message);
      log.warn('Semantic search may not work correctly');
    }

    // Load index
    indexManager = new IndexManager(config.dataDir);
    const loaded = indexManager.load(config.embedding);
    if (loaded) {
      hasSemanticSearch = true;
      log.info(`Semantic search enabled (${indexManager.size} vectors)`);
    } else {
      log.warn('Vector index not loaded. Run "npm run index" to create it.');
    }
  } catch (error) {
    log.warn('Embedding provider unavailable:', error.message);
    log.warn('Semantic search disabled, keyword search only');
  }

  // 4. Tools
  const readTools = createReadTools({ db, provider, indexManager, hasSemanticSearch });
  const writeTools = createWriteTools();
  const tools = [...readTools, ...writeTools];
  log.info(`Registered ${tools.length} tools`);

  // 5. Server
  let httpHandle = null;

  if (config.transport.mode === 'http') {
    const { startHttpServer } = await import('./transport/http.js');
    httpHandle = await startHttpServer({ createMcpServer, tools, config });
  } else {
    const server = createMcpServer(tools);
    await startStdioServer(server);
  }

  // 6. Auto-indexer
  let autoIndexer = null;
  if (config.autoIndex.enabled && provider && indexManager?.isLoaded) {
    autoIndexer = new AutoIndexer({ db, provider, indexManager, config });
    autoIndexer.start();
  }

  // 7. Signal handlers
  const shutdown = async (signal) => {
    log.info(`Received ${signal}, shutting down...`);
    if (autoIndexer) autoIndexer.stop();
    if (httpHandle) await httpHandle.shutdown().catch(() => {});
    closeDatabase();
    if (provider) provider.dispose().catch(() => {});
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGHUP', () => shutdown('SIGHUP'));
}

main().catch(error => {
  console.error('Server error:', error);
  process.exit(1);
});
