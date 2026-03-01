const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
let currentLevel = LEVELS.info;

export function setLogLevel(level) {
  if (level in LEVELS) {
    currentLevel = LEVELS[level];
  }
}

export function createLogger(component) {
  const log = (level, ...args) => {
    if (LEVELS[level] >= currentLevel) {
      const prefix = `[${level.toUpperCase()}] [${component}]`;
      console.error(prefix, ...args);
    }
  };

  return {
    debug: (...args) => log('debug', ...args),
    info: (...args) => log('info', ...args),
    warn: (...args) => log('warn', ...args),
    error: (...args) => log('error', ...args),
  };
}
