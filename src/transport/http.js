import express from 'express';
import crypto, { randomUUID } from 'crypto';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { FileClientsStore } from '../auth/clients-store.js';
import { BearOAuthProvider } from '../auth/oauth-provider.js';
import { LoginRateLimiter } from '../auth/rate-limiter.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('http');
const MAX_SESSIONS = 100;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export async function startHttpServer({ createMcpServer, tools, config }) {
  const { transport: transportConfig, auth: authConfig } = config;
  const issuerUrl = new URL(authConfig.issuerUrl);
  const resourceServerUrl = new URL('/mcp', issuerUrl);

  const clientsStore = new FileClientsStore(config.dataDir);
  const oauthProvider = new BearOAuthProvider({
    clientsStore,
    secret: authConfig.secret,
    tokenTtlSeconds: authConfig.tokenTtlSeconds,
  });

  const app = createMcpExpressApp({ host: issuerUrl.hostname });
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  // Security headers
  app.use((_req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
    });
    next();
  });

  // Body parsing for login form
  app.use('/login', express.urlencoded({ extended: false }));

  // Request logging (before all routes)
  app.use((req, _res, next) => {
    log.debug(`${req.method} ${req.path}`);
    next();
  });

  // OAuth endpoints (must be before bearer auth)
  app.use(mcpAuthRouter({
    provider: oauthProvider,
    issuerUrl,
    resourceServerUrl,
  }));

  // Rate limiter and CSRF tokens
  const rateLimiter = new LoginRateLimiter();
  const CSRF_TTL_MS = 5 * 60 * 1000; // 5 minutes
  const csrfTokens = new Map(); // csrfToken → { pendingId, createdAt }
  const csrfCleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [token, entry] of csrfTokens) {
      if (now - entry.createdAt > CSRF_TTL_MS) csrfTokens.delete(token);
    }
  }, CSRF_TTL_MS);
  csrfCleanupTimer.unref();

  function generateCsrf(pendingId) {
    const token = crypto.randomUUID();
    csrfTokens.set(token, { pendingId, createdAt: Date.now() });
    return token;
  }

  // Login page
  app.get('/login', (req, res) => {
    const pendingId = req.query.pending;
    const error = req.query.error;
    res.type('html').send(loginPage(pendingId, error, generateCsrf(pendingId)));
  });

  app.post('/login', (req, res) => {
    const { password, pending, csrf_token } = req.body;

    // CSRF validation
    const csrfEntry = csrf_token && csrfTokens.get(csrf_token);
    if (!csrfEntry || csrfEntry.pendingId !== pending || Date.now() - csrfEntry.createdAt > CSRF_TTL_MS) {
      return res.redirect(`/login?pending=${encodeURIComponent(pending)}&error=invalid_pending`);
    }
    csrfTokens.delete(csrf_token);

    // Rate limiting
    const ip = req.ip;
    const rateCheck = rateLimiter.check(ip);
    if (rateCheck.blocked) {
      res.set('Retry-After', String(rateCheck.retryAfterSeconds));
      return res.status(429).type('html').send(loginPage(pending, 'too_many_attempts', generateCsrf(pending)));
    }

    const passwordBuf = Buffer.from(password || '');
    const secretBuf = Buffer.from(authConfig.secret);
    if (passwordBuf.length !== secretBuf.length || !crypto.timingSafeEqual(passwordBuf, secretBuf)) {
      rateLimiter.recordFailure(ip);
      return res.redirect(`/login?pending=${encodeURIComponent(pending)}&error=wrong_password`);
    }

    rateLimiter.recordSuccess(ip);

    let redirectUrl;
    try {
      redirectUrl = oauthProvider.approvePendingAuth(pending);
    } catch {
      return res.redirect(`/login?pending=${encodeURIComponent(pending)}&error=invalid_pending`);
    }

    res.redirect(redirectUrl);
  });

  // MCP endpoint with bearer auth
  const bearerAuth = requireBearerAuth({ verifier: oauthProvider });
  const sessions = new Map(); // sessionId → { transport, server }

  function getSession(sessionId) {
    const session = sessions.get(sessionId);
    if (!session) return null;
    if (Date.now() - session.createdAt > SESSION_TTL_MS) {
      session.transport.close().catch(() => {});
      sessions.delete(sessionId);
      return null;
    }
    return session;
  }

  app.post('/mcp', bearerAuth, async (req, res) => {
    const sessionId = req.headers['mcp-session-id'];

    if (sessionId) {
      const session = getSession(sessionId);
      if (session) {
        await session.transport.handleRequest(req, res, req.body);
      } else {
        res.status(404).json({ error: 'Session not found' });
      }
      return;
    }

    // New session (no session ID — must be initialize)
    // Evict oldest session if at capacity
    if (sessions.size >= MAX_SESSIONS) {
      const oldestKey = sessions.keys().next().value;
      const oldest = sessions.get(oldestKey);
      await oldest.transport.close().catch(() => {});
      sessions.delete(oldestKey);
    }

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
    });

    const server = createMcpServer(tools);
    await server.connect(transport);

    transport.onclose = () => {
      const sid = transport.sessionId;
      if (sid) sessions.delete(sid);
    };

    await transport.handleRequest(req, res, req.body);

    if (transport.sessionId) {
      sessions.set(transport.sessionId, { transport, server, createdAt: Date.now() });
    }
  });

  app.get('/mcp', bearerAuth, async (req, res) => {
    const sessionId = req.headers['mcp-session-id'];
    const session = sessionId && getSession(sessionId);
    if (!session) {
      return res.status(400).json({ error: 'Invalid or missing session ID' });
    }
    await session.transport.handleRequest(req, res);
  });

  app.delete('/mcp', bearerAuth, async (req, res) => {
    const sessionId = req.headers['mcp-session-id'];
    const session = sessionId && getSession(sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    await session.transport.close();
    sessions.delete(sessionId);
    res.status(200).json({ message: 'Session terminated' });
  });

  // Global error handler — catches unhandled errors from SDK OAuth routes
  app.use((err, req, _res, next) => {
    log.error(`${req.method} ${req.path}: ${err.message}`);
    next(err);
  });

  const httpServer = app.listen(transportConfig.port, transportConfig.host, () => {
    log.info(`HTTP server listening on ${transportConfig.host}:${transportConfig.port}`);
  });

  oauthProvider.startCleanup();

  return {
    httpServer,
    sessions,
    oauthProvider,
    async shutdown() {
      clearInterval(csrfCleanupTimer);
      rateLimiter.dispose();
      oauthProvider.stopCleanup();
      for (const [, session] of sessions) {
        await session.transport.close().catch(() => {});
      }
      sessions.clear();
      await new Promise((resolve) => httpServer.close(resolve));
    },
  };
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function loginPage(pendingId, error, csrfToken) {
  const errorMsg = error === 'wrong_password' ? 'Incorrect password. Try again.'
    : error === 'invalid_pending' ? 'Authorization request expired. Start over.'
    : error === 'too_many_attempts' ? 'Too many failed attempts. Please wait before trying again.'
    : '';
  const safePendingId = escapeHtml(pendingId);
  const safeCsrfToken = escapeHtml(csrfToken);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bear MCP — Login</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, system-ui, sans-serif; background: #1a1a2e; color: #e0e0e0; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 1rem; }
  .card { background: #16213e; border-radius: 12px; padding: 2rem; max-width: 360px; width: 100%; box-shadow: 0 4px 24px rgba(0,0,0,0.3); }
  h1 { font-size: 1.25rem; margin-bottom: 1.5rem; text-align: center; }
  label { display: block; font-size: 0.875rem; margin-bottom: 0.5rem; color: #aaa; }
  input[type=password] { width: 100%; padding: 0.75rem; border: 1px solid #333; border-radius: 8px; background: #0f3460; color: #fff; font-size: 1rem; }
  input[type=password]:focus { outline: none; border-color: #e94560; }
  button { width: 100%; margin-top: 1rem; padding: 0.75rem; background: #e94560; border: none; border-radius: 8px; color: #fff; font-size: 1rem; cursor: pointer; }
  button:hover { background: #c73652; }
  .error { background: #3d1524; border: 1px solid #e94560; border-radius: 8px; padding: 0.75rem; margin-bottom: 1rem; font-size: 0.875rem; color: #ff8a9e; }
</style>
</head>
<body>
<div class="card">
  <h1>Bear MCP Server</h1>
  ${errorMsg ? `<div class="error">${errorMsg}</div>` : ''}
  <form method="POST" action="/login">
    <input type="hidden" name="pending" value="${safePendingId}">
    <input type="hidden" name="csrf_token" value="${safeCsrfToken}">
    <label for="password">Password</label>
    <input type="password" id="password" name="password" required autofocus>
    <button type="submit">Sign In</button>
  </form>
</div>
</body>
</html>`;
}
