import { createLogger } from '../utils/logger.js';

const log = createLogger('embeddings');

export class EmbeddingProvider {
  constructor({ name, dimensions, maxTokens = 512 }) {
    this.name = name;
    this.dimensions = dimensions;
    this.maxTokens = maxTokens;
  }

  async initialize() {
    throw new Error('Not implemented');
  }

  async embed(text) {
    throw new Error('Not implemented');
  }

  async embedBatch(texts) {
    // Default: sequential. Providers can override for native batch.
    const results = [];
    for (const text of texts) {
      results.push(await this.embed(text));
    }
    return results;
  }

  async healthCheck() {
    throw new Error('Not implemented');
  }

  async dispose() {
    // Optional cleanup
  }
}

const PROVIDER_MODULES = {
  transformers: './providers/transformers-provider.js',
  ollama: './providers/ollama-provider.js',
  lmstudio: './providers/lmstudio-provider.js',
  'openai-compat': './providers/openai-compat-provider.js',
};

export async function createProvider(config) {
  const { provider, model, dimensions } = config.embedding;
  const modulePath = PROVIDER_MODULES[provider];

  if (!modulePath) {
    throw new Error(`Unknown embedding provider: "${provider}". Valid: ${Object.keys(PROVIDER_MODULES).join(', ')}`);
  }

  log.info(`Creating ${provider} provider with model ${model} (${dimensions}d)`);

  const mod = await import(modulePath);
  const instance = new mod.default({ config: config.embedding });
  await instance.initialize();
  return instance;
}
