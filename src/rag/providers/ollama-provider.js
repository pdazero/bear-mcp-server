import { EmbeddingProvider } from '../embeddings.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('ollama');

const DEFAULT_BASE_URL = 'http://localhost:11434';
const HEALTH_TIMEOUT_MS = 5000;

export default class OllamaProvider extends EmbeddingProvider {
  constructor({ config }) {
    super({
      name: 'ollama',
      dimensions: config.dimensions,
    });
    this.model = config.model;
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
    this.instructionPrefix = config.instructionPrefix || null;
  }

  async initialize() {
    log.info(`Ollama provider: model=${this.model}, url=${this.baseUrl}`);
  }

  async embed(text) {
    const prompt = this.instructionPrefix ? `${this.instructionPrefix}${text}` : text;
    const res = await fetch(`${this.baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, prompt }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Ollama API error ${res.status}: ${body}`);
    }

    const data = await res.json();
    return data.embedding;
  }

  async healthCheck() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
    try {
      const res = await fetch(`${this.baseUrl}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.model, prompt: 'health check' }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Ollama health check failed: ${res.status}`);
      const data = await res.json();
      if (data.embedding.length !== this.dimensions) {
        throw new Error(`Dimension mismatch: expected ${this.dimensions}, got ${data.embedding.length}`);
      }
    } finally {
      clearTimeout(timeout);
    }
  }
}
