import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';

describe('config', () => {
  const savedEnv = {};
  const envKeys = [
    'EMBEDDING_PRESET', 'EMBEDDING_PROVIDER', 'EMBEDDING_MODEL',
    'EMBEDDING_DIMENSIONS', 'EMBEDDING_BACKEND', 'EMBEDDING_BASE_URL',
    'EMBEDDING_API_KEY', 'EMBEDDING_INSTRUCTION_PREFIX',
    'BEAR_DATABASE_PATH', 'DATA_DIR', 'LOG_LEVEL',
    'MCP_TRANSPORT', 'MCP_PORT', 'MCP_HOST',
    'MCP_AUTH_SECRET', 'MCP_AUTH_ISSUER_URL', 'MCP_AUTH_TOKEN_TTL',
  ];

  beforeEach(() => {
    for (const key of envKeys) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of envKeys) {
      if (savedEnv[key] !== undefined) {
        process.env[key] = savedEnv[key];
      } else {
        delete process.env[key];
      }
    }
  });

  it('defaults to light preset', () => {
    const config = loadConfig();
    assert.equal(config.embedding.provider, 'transformers');
    assert.equal(config.embedding.dimensions, 768);
    assert.ok(config.embedding.model.includes('embeddinggemma'));
  });

  it('resolves medium preset with default backend', () => {
    process.env.EMBEDDING_PRESET = 'medium';
    const config = loadConfig();
    assert.equal(config.embedding.provider, 'lmstudio');
    assert.equal(config.embedding.model, 'bge-m3');
    assert.equal(config.embedding.dimensions, 1024);
  });

  it('resolves heavy preset', () => {
    process.env.EMBEDDING_PRESET = 'heavy';
    const config = loadConfig();
    assert.equal(config.embedding.model, 'qwen3-embedding:4b');
    assert.equal(config.embedding.dimensions, 1024);
  });

  it('custom provider overrides preset', () => {
    process.env.EMBEDDING_PROVIDER = 'ollama';
    process.env.EMBEDDING_MODEL = 'custom-model';
    process.env.EMBEDDING_DIMENSIONS = '512';
    const config = loadConfig();
    assert.equal(config.embedding.provider, 'ollama');
    assert.equal(config.embedding.model, 'custom-model');
    assert.equal(config.embedding.dimensions, 512);
  });

  it('throws on unknown preset', () => {
    process.env.EMBEDDING_PRESET = 'ultra';
    assert.throws(() => loadConfig(), /Unknown EMBEDDING_PRESET/);
  });

  it('throws when custom provider missing model', () => {
    process.env.EMBEDDING_PROVIDER = 'ollama';
    process.env.EMBEDDING_DIMENSIONS = '384';
    assert.throws(() => loadConfig(), /EMBEDDING_MODEL is required/);
  });

  it('throws when custom provider missing dimensions', () => {
    process.env.EMBEDDING_PROVIDER = 'ollama';
    process.env.EMBEDDING_MODEL = 'test';
    assert.throws(() => loadConfig(), /EMBEDDING_DIMENSIONS must be/);
  });

  it('config object is frozen', () => {
    const config = loadConfig();
    assert.throws(() => { config.logLevel = 'debug'; }, TypeError);
    assert.throws(() => { config.embedding.provider = 'x'; }, TypeError);
  });

  it('defaults transport to stdio on port 3000', () => {
    const config = loadConfig();
    assert.equal(config.transport.mode, 'stdio');
    assert.equal(config.transport.port, 3000);
    assert.equal(config.transport.host, '127.0.0.1');
  });

  it('throws when http mode missing MCP_AUTH_SECRET', () => {
    process.env.MCP_TRANSPORT = 'http';
    process.env.MCP_AUTH_ISSUER_URL = 'http://localhost:3000';
    assert.throws(() => loadConfig(), /MCP_AUTH_SECRET is required/);
  });

  it('throws when http mode missing MCP_AUTH_ISSUER_URL', () => {
    process.env.MCP_TRANSPORT = 'http';
    process.env.MCP_AUTH_SECRET = 'secret';
    assert.throws(() => loadConfig(), /MCP_AUTH_ISSUER_URL is required/);
  });

  it('freezes transport and auth config', () => {
    process.env.MCP_TRANSPORT = 'http';
    process.env.MCP_AUTH_SECRET = 'secret';
    process.env.MCP_AUTH_ISSUER_URL = 'http://localhost:3000';
    const config = loadConfig();
    assert.throws(() => { config.transport.mode = 'stdio'; }, TypeError);
    assert.throws(() => { config.auth.secret = 'x'; }, TypeError);
  });
});
