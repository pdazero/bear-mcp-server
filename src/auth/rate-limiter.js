const MAX_ATTEMPTS = 5;
const BASE_BLOCK_MS = 60_000;       // 1 minute
const MAX_BLOCK_MS = 15 * 60_000;   // 15 minutes
const CLEANUP_INTERVAL_MS = 10 * 60_000; // 10 minutes

export class LoginRateLimiter {
  constructor() {
    this._attempts = new Map(); // ip → { count, blockedUntil }
    this._cleanupTimer = setInterval(() => this._cleanup(), CLEANUP_INTERVAL_MS);
    this._cleanupTimer.unref();
  }

  check(ip) {
    const record = this._attempts.get(ip);
    if (!record || !record.blockedUntil) {
      return { blocked: false };
    }
    const remaining = record.blockedUntil - Date.now();
    if (remaining <= 0) {
      return { blocked: false };
    }
    return { blocked: true, retryAfterSeconds: Math.ceil(remaining / 1000) };
  }

  recordFailure(ip) {
    const record = this._attempts.get(ip) || { count: 0, blockedUntil: null };
    record.count += 1;
    if (record.count >= MAX_ATTEMPTS) {
      const backoff = Math.min(BASE_BLOCK_MS * Math.pow(2, record.count - MAX_ATTEMPTS), MAX_BLOCK_MS);
      record.blockedUntil = Date.now() + backoff;
    }
    this._attempts.set(ip, record);
  }

  recordSuccess(ip) {
    this._attempts.delete(ip);
  }

  dispose() {
    clearInterval(this._cleanupTimer);
    this._attempts.clear();
  }

  _cleanup() {
    const now = Date.now();
    for (const [ip, record] of this._attempts) {
      if (record.blockedUntil && record.blockedUntil <= now) {
        this._attempts.delete(ip);
      }
    }
  }
}
