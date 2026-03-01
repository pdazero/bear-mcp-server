import fs from 'fs';
import path from 'path';
import hnswlib from 'hnswlib-node';
const { HierarchicalNSW } = hnswlib;
import { createLogger } from '../utils/logger.js';

const log = createLogger('index');

const HNSW_M = 16;
const HNSW_EF_CONSTRUCTION = 200;
const MAX_ELEMENTS = 50000;

const INDEX_FILE = 'bear_vectors.hnsw';
const STATE_FILE = 'index_state.json';

export class IndexManager {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.index = null;
    this.uuidToLabel = new Map();
    this.labelToUuid = new Map();
    this.nextLabel = 0;
    this.dimensions = 0;
  }

  get isLoaded() {
    return this.index !== null;
  }

  get size() {
    return this.uuidToLabel.size;
  }

  get indexedUuids() {
    return Array.from(this.uuidToLabel.keys());
  }

  load(embeddingConfig) {
    const indexPath = path.join(this.dataDir, INDEX_FILE);
    const statePath = path.join(this.dataDir, STATE_FILE);

    if (!fs.existsSync(indexPath) || !fs.existsSync(statePath)) {
      log.info('No existing index found');
      return false;
    }

    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));

    // Dimension mismatch detection
    if (state.dimensions !== embeddingConfig.dimensions) {
      log.warn(
        `Dimension mismatch: index has ${state.dimensions}d, current config is ${embeddingConfig.dimensions}d. ` +
        'Please re-index with "npm run index".'
      );
      return false;
    }

    this.dimensions = state.dimensions;
    this.index = new HierarchicalNSW('cosine', this.dimensions);
    this.index.readIndexSync(indexPath, true);

    // Restore UUID mappings
    this.uuidToLabel = new Map(Object.entries(state.uuidToLabel).map(([k, v]) => [k, Number(v)]));
    this.labelToUuid = new Map();
    for (const [uuid, label] of this.uuidToLabel) {
      this.labelToUuid.set(label, uuid);
    }
    this.nextLabel = state.nextLabel || this.uuidToLabel.size;
    this.lastIndexedTimestamp = state.lastIndexedTimestamp || null;

    log.info(`Loaded index: ${this.size} vectors, ${this.dimensions}d`);
    return true;
  }

  initEmpty(dimensions) {
    this.dimensions = dimensions;
    this.index = new HierarchicalNSW('cosine', dimensions);
    this.index.initIndex(MAX_ELEMENTS, HNSW_M, HNSW_EF_CONSTRUCTION, undefined, true);
    this.uuidToLabel = new Map();
    this.labelToUuid = new Map();
    this.nextLabel = 0;
    log.info(`Initialized empty index: ${dimensions}d`);
  }

  addPoint(uuid, vector) {
    // If this UUID already exists, mark-delete old point
    if (this.uuidToLabel.has(uuid)) {
      const oldLabel = this.uuidToLabel.get(uuid);
      this.index.markDelete(oldLabel);
      this.labelToUuid.delete(oldLabel);
    }

    const label = this.nextLabel++;
    this.index.addPoint(vector, label, true);
    this.uuidToLabel.set(uuid, label);
    this.labelToUuid.set(label, uuid);
  }

  removePoint(uuid) {
    if (!this.uuidToLabel.has(uuid)) return false;
    const label = this.uuidToLabel.get(uuid);
    this.index.markDelete(label);
    this.labelToUuid.delete(label);
    this.uuidToLabel.delete(uuid);
    return true;
  }

  getVector(uuid) {
    if (!this.uuidToLabel.has(uuid)) return null;
    const label = this.uuidToLabel.get(uuid);
    return this.index.getPoint(label);
  }

  getAllVectors() {
    const result = [];
    for (const [uuid, label] of this.uuidToLabel) {
      result.push({ uuid, vector: this.index.getPoint(label) });
    }
    return result;
  }

  search(vector, k = 10) {
    if (!this.index || this.size === 0) return [];

    const actualK = Math.min(k, this.size);
    const result = this.index.searchKnn(vector, actualK);

    const results = [];
    for (let i = 0; i < result.neighbors.length; i++) {
      const label = result.neighbors[i];
      const uuid = this.labelToUuid.get(label);
      if (uuid) {
        // hnswlib cosine distance = 1 - cosine_similarity
        const similarity = 1 - result.distances[i];
        results.push({ noteUuid: uuid, similarity });
      }
    }

    return results.sort((a, b) => b.similarity - a.similarity);
  }

  save(embeddingConfig, { lastIndexedTimestamp } = {}) {
    fs.mkdirSync(this.dataDir, { recursive: true });

    const indexPath = path.join(this.dataDir, INDEX_FILE);
    const statePath = path.join(this.dataDir, STATE_FILE);

    this.index.writeIndexSync(indexPath);

    if (lastIndexedTimestamp !== undefined) {
      this.lastIndexedTimestamp = lastIndexedTimestamp;
    }

    const state = {
      provider: embeddingConfig.provider,
      model: embeddingConfig.model,
      dimensions: this.dimensions,
      vectorCount: this.size,
      nextLabel: this.nextLabel,
      uuidToLabel: Object.fromEntries(this.uuidToLabel),
      savedAt: new Date().toISOString(),
    };
    if (this.lastIndexedTimestamp != null) {
      state.lastIndexedTimestamp = this.lastIndexedTimestamp;
    }
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));

    log.info(`Saved index: ${this.size} vectors to ${this.dataDir}`);
  }
}
