import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { LoginRateLimiter } from '../src/auth/rate-limiter.js';

describe('LoginRateLimiter', () => {
  let limiter;

  afterEach(() => {
    if (limiter) limiter.dispose();
  });

  it('allows requests below threshold', () => {
    limiter = new LoginRateLimiter();
    for (let i = 0; i < 4; i++) {
      limiter.recordFailure('1.2.3.4');
    }
    const result = limiter.check('1.2.3.4');
    assert.equal(result.blocked, false);
  });

  it('blocks after 5 failures', () => {
    limiter = new LoginRateLimiter();
    for (let i = 0; i < 5; i++) {
      limiter.recordFailure('1.2.3.4');
    }
    const result = limiter.check('1.2.3.4');
    assert.equal(result.blocked, true);
    assert.ok(result.retryAfterSeconds > 0);
  });

  it('clears on success', () => {
    limiter = new LoginRateLimiter();
    for (let i = 0; i < 5; i++) {
      limiter.recordFailure('1.2.3.4');
    }
    limiter.recordSuccess('1.2.3.4');
    const result = limiter.check('1.2.3.4');
    assert.equal(result.blocked, false);
  });

  it('isolates IPs', () => {
    limiter = new LoginRateLimiter();
    for (let i = 0; i < 5; i++) {
      limiter.recordFailure('1.2.3.4');
    }
    const result = limiter.check('5.6.7.8');
    assert.equal(result.blocked, false);
  });

  it('applies exponential backoff', () => {
    limiter = new LoginRateLimiter();
    // 6 failures = 2min block (base * 2^1)
    for (let i = 0; i < 6; i++) {
      limiter.recordFailure('1.2.3.4');
    }
    const result = limiter.check('1.2.3.4');
    assert.equal(result.blocked, true);
    assert.ok(result.retryAfterSeconds > 60, 'should be more than 1 minute');
  });
});
