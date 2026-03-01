import { EmbeddingProvider } from '../embeddings.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('lmstudio');

const DEFAULT_BASE_URL = 'http://localhost:1234';
const HEALTH_TIMEOUT_MS = 5000;

export default class LMStudioProvider extends EmbeddingProvider {
  constructor({ config }) {
    super({
      name: 'lmstudio',
      dimensions: config.dimensions,
    });
    this.model = config.model;
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
    this.instructionPrefix = config.instructionPrefix || null;
  }

  async initialize() {
    log.info(`LM Studio provider: model=${this.model}, url=${this.baseUrl}`);
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
    const res = await fetch(`${this.baseUrl}/v1/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, input }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`LM Studio API error ${res.status}: ${body}`);
    }

    const data = await res.json();
    // Sort by index to preserve order
    return data.data
      .sort((a, b) => a.index - b.index)
      .map(d => d.embedding);
  }

  async healthCheck() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
    try {
      const res = await fetch(`${this.baseUrl}/v1/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.model, input: ['health check'] }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`LM Studio health check failed: ${res.status}`);
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
