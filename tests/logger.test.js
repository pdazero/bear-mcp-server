import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createLogger, setLogLevel } from '../src/utils/logger.js';

describe('logger', () => {
  let output;
  let originalError;

  beforeEach(() => {
    output = [];
    originalError = console.error;
    console.error = (...args) => output.push(args.join(' '));
  });

  afterEach(() => {
    console.error = originalError;
    setLogLevel('info'); // reset
  });

  it('logs info and above by default', () => {
    const log = createLogger('test');
    log.debug('hidden');
    log.info('visible');
    log.warn('also visible');
    assert.equal(output.length, 2);
    assert.ok(output[0].includes('[INFO]'));
    assert.ok(output[0].includes('[test]'));
  });

  it('respects debug level', () => {
    setLogLevel('debug');
    const log = createLogger('test');
    log.debug('now visible');
    assert.equal(output.length, 1);
    assert.ok(output[0].includes('[DEBUG]'));
  });

  it('error level suppresses info and warn', () => {
    setLogLevel('error');
    const log = createLogger('test');
    log.info('hidden');
    log.warn('hidden');
    log.error('visible');
    assert.equal(output.length, 1);
    assert.ok(output[0].includes('[ERROR]'));
  });
});
