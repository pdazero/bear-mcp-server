import { exec } from 'node:child_process';
import { createLogger } from '../utils/logger.js';

const log = createLogger('xcallback');

/**
 * Build a Bear x-callback-url from an action and params.
 * Pure function — no side effects.
 */
export function buildBearUrl(action, params = {}) {
  const filtered = { show_window: 'no' };

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;

    if (typeof value === 'boolean') {
      filtered[key] = value ? 'yes' : 'no';
    } else {
      filtered[key] = String(value);
    }
  }

  const query = new URLSearchParams(filtered).toString();
  return `bear://x-callback-url/${action}${query ? '?' + query : ''}`;
}

/**
 * Fire-and-forget call to Bear via `open` command.
 * Returns { success: true } immediately.
 */
export function callBear(action, params = {}) {
  const url = buildBearUrl(action, params);
  log.debug(`${action}:`, url);

  return new Promise((resolve, reject) => {
    exec(`open "${url}"`, (error) => {
      if (error) {
        reject(new Error(`Failed to call Bear: ${error.message}`));
        return;
      }
      resolve({ success: true });
    });
  });
}
