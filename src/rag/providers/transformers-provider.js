import { EmbeddingProvider } from '../embeddings.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('transformers');

export default class TransformersProvider extends EmbeddingProvider {
  constructor({ config }) {
    super({
      name: 'transformers',
      dimensions: config.dimensions,
    });
    this.modelName = config.model;
    this.tokenizer = null;
    this.model = null;
  }

  async initialize() {
    log.info(`Loading model: ${this.modelName}`);
    const { AutoTokenizer, AutoModel } = await import('@huggingface/transformers');
    this.tokenizer = await AutoTokenizer.from_pretrained(this.modelName);
    this.model = await AutoModel.from_pretrained(this.modelName, { dtype: 'q8' });
    log.info('Model loaded');
  }

  async embed(text) {
    const inputs = await this.tokenizer(text, { padding: true, truncation: true });
    const output = await this.model(inputs);

    let embedding;
    if (output.sentence_embedding) {
      // EmbeddingGemma and similar models with dedicated sentence_embedding output
      embedding = output.sentence_embedding.data;
    } else {
      // Mean pooling fallback
      embedding = this._meanPool(output.last_hidden_state, inputs.attention_mask);
    }

    return this._normalize(Array.from(embedding));
  }

  _meanPool(lastHiddenState, attentionMask) {
    const [batchSize, seqLen, hiddenSize] = lastHiddenState.dims;
    const result = new Float32Array(hiddenSize);
    const data = lastHiddenState.data;
    const mask = attentionMask.data;

    let tokenCount = 0;
    for (let i = 0; i < seqLen; i++) {
      if (mask[i] === 1n || mask[i] === 1) {
        tokenCount++;
        for (let j = 0; j < hiddenSize; j++) {
          result[j] += data[i * hiddenSize + j];
        }
      }
    }

    if (tokenCount > 0) {
      for (let j = 0; j < hiddenSize; j++) {
        result[j] /= tokenCount;
      }
    }
    return result;
  }

  _normalize(vec) {
    let norm = 0;
    for (const v of vec) norm += v * v;
    norm = Math.sqrt(norm);
    if (norm === 0) return vec;
    return vec.map(v => v / norm);
  }

  async healthCheck() {
    const vec = await this.embed('health check');
    if (vec.length !== this.dimensions) {
      throw new Error(`Dimension mismatch: expected ${this.dimensions}, got ${vec.length}`);
    }
  }

  async dispose() {
    this.tokenizer = null;
    this.model = null;
  }
}
