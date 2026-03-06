import path from 'path';
import os from 'os';

const DEFAULT_DB_PATH = path.join(
  os.homedir(),
  'Library/Group Containers/9K33E3U3T4.net.shinyfrog.bear/Application Data/database.sqlite'
);

const PRESETS = {
  light: {
    provider: 'transformers',
    model: 'onnx-community/embeddinggemma-300m-ONNX',
    dimensions: 768,
  },
  medium: {
    provider: null, // resolved from EMBEDDING_BACKEND
    model: 'bge-m3',
    dimensions: 1024,
  },
  heavy: {
    provider: null, // resolved from EMBEDDING_BACKEND
    model: 'qwen3-embedding:4b',
    dimensions: 1024,
  },
};

const DEFAULT_BACKEND = 'lmstudio';

export function loadConfig() {
  const env = process.env;
  const presetName = env.EMBEDDING_PRESET || 'light';

  const transport = {
    mode: (env.MCP_TRANSPORT || 'stdio').toLowerCase(),
    port: parseInt(env.MCP_PORT, 10) || 3000,
    host: env.MCP_HOST || '127.0.0.1',
  };

  const auth = {
    secret: env.MCP_AUTH_SECRET || null,
    issuerUrl: env.MCP_AUTH_ISSUER_URL || null,
    tokenTtlSeconds: parseInt(env.MCP_AUTH_TOKEN_TTL, 10) || 86400,
  };

  if (transport.mode === 'http') {
    if (!auth.secret) throw new Error('MCP_AUTH_SECRET is required when MCP_TRANSPORT=http');
    if (!auth.issuerUrl) throw new Error('MCP_AUTH_ISSUER_URL is required when MCP_TRANSPORT=http');
  }

  if (env.EMBEDDING_PROVIDER) {
    // Fully custom configuration
    const provider = env.EMBEDDING_PROVIDER;
    const model = env.EMBEDDING_MODEL;
    const dimensions = parseInt(env.EMBEDDING_DIMENSIONS, 10);

    if (!model) throw new Error('EMBEDDING_MODEL is required when EMBEDDING_PROVIDER is set');
    if (!dimensions || isNaN(dimensions)) throw new Error('EMBEDDING_DIMENSIONS must be a positive integer when EMBEDDING_PROVIDER is set');

    return freeze({
      bearDbPath: env.BEAR_DATABASE_PATH || DEFAULT_DB_PATH,
      dataDir: env.DATA_DIR || 'data',
      logLevel: env.LOG_LEVEL || 'info',
      transport,
      auth,
      embedding: {
        provider,
        model,
        dimensions,
        baseUrl: env.EMBEDDING_BASE_URL || null,
        apiKey: env.EMBEDDING_API_KEY || null,
        instructionPrefix: env.EMBEDDING_INSTRUCTION_PREFIX || null,
      },
      autoIndex: {
        enabled: env.AUTO_INDEX_ENABLED === 'true',
        intervalSeconds: parseInt(env.AUTO_INDEX_INTERVAL_SECONDS, 10) || 300,
      },
    });
  }

  const preset = PRESETS[presetName];
  if (!preset) {
    throw new Error(`Unknown EMBEDDING_PRESET: "${presetName}". Valid: ${Object.keys(PRESETS).join(', ')}`);
  }

  const provider = preset.provider || env.EMBEDDING_BACKEND || DEFAULT_BACKEND;

  return freeze({
    bearDbPath: env.BEAR_DATABASE_PATH || DEFAULT_DB_PATH,
    dataDir: env.DATA_DIR || 'data',
    logLevel: env.LOG_LEVEL || 'info',
    transport,
    auth,
    embedding: {
      provider,
      model: env.EMBEDDING_MODEL || preset.model,
      dimensions: parseInt(env.EMBEDDING_DIMENSIONS, 10) || preset.dimensions,
      baseUrl: env.EMBEDDING_BASE_URL || null,
      apiKey: env.EMBEDDING_API_KEY || null,
      instructionPrefix: env.EMBEDDING_INSTRUCTION_PREFIX || null,
    },
    autoIndex: {
      enabled: env.AUTO_INDEX_ENABLED === 'true',
      intervalSeconds: parseInt(env.AUTO_INDEX_INTERVAL_SECONDS, 10) || 300,
    },
  });
}

function freeze(config) {
  Object.freeze(config.transport);
  Object.freeze(config.auth);
  Object.freeze(config.embedding);
  Object.freeze(config.autoIndex);
  return Object.freeze(config);
}
