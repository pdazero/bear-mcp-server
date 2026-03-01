import { EmbeddingProvider } from '../embeddings.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('openai-compat');

const HEALTH_TIMEOUT_MS = 5000;

export default class OpenAICompatProvider extends EmbeddingProvider {
  constructor({ config }) {
    super({
      name: 'openai-compat',
      dimensions: config.dimensions,
    });
    this.model = config.model;
    this.baseUrl = config.baseUrl;
    this.apiKey = config.apiKey || null;
    this.instructionPrefix = config.instructionPrefix || null;

    if (!this.baseUrl) {
      throw new Error('EMBEDDING_BASE_URL is required for openai-compat provider');
    }
  }

  async initialize() {
    log.info(`OpenAI-compat provider: model=${this.model}, url=${this.baseUrl}`);
  }

  async embed(text) {
    const input = this.instructionPrefix ? `${this.instructionPrefix}${text}` : text;
    return this._request([input]).then(vecs => vecs[0]);
  }

  async embedBatch(texts) {
    const inputs = this.instructionPrefix
      ? texts.map(t => `${this.instructionPrefix}${t}`)
      : texts;
    return this._request(inputs);
  }

  async _request(input) {
    const headers = { 'Content-Type': 'application/json' };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const res = await fetch(`${this.baseUrl}/v1/embeddings`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: this.model, input }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`OpenAI-compat API error ${res.status}: ${body}`);
    }

    const data = await res.json();
    return data.data
      .sort((a, b) => a.index - b.index)
      .map(d => d.embedding);
  }

  async healthCheck() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;

      const res = await fetch(`${this.baseUrl}/v1/embeddings`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model: this.model, input: ['health check'] }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Health check failed: ${res.status}`);
      const data = await res.json();
      const dim = data.data[0].embedding.length;
      if (dim !== this.dimensions) {
        throw new Error(`Dimension mismatch: expected ${this.dimensions}, got ${dim}`);
      }
    } finally {
      clearTimeout(timeout);
    }
  }
}
