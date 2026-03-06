import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import express from 'express';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { randomUUID } from 'crypto';
import { FileClientsStore } from '../src/auth/clients-store.js';
import { BearOAuthProvider } from '../src/auth/oauth-provider.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Minimal MCP server factory for tests
function createTestMcpServer() {
  const server = new Server(
    { name: 'test-bear', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [] }));
  server.setRequestHandler(CallToolRequestSchema, async () => ({
    content: [{ type: 'text', text: '{}' }],
  }));
  return server;
}

describe('HTTP Transport', () => {
  let baseUrl;
  let httpServer;
  let tmpDir;
  let oauthProvider;
  const sessions = new Map();
  const SECRET = 'test-secret-123';

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bear-http-'));

    const clientsStore = new FileClientsStore(tmpDir);
    oauthProvider = new BearOAuthProvider({
      clientsStore,
      secret: SECRET,
      tokenTtlSeconds: 3600,
    });

    const app = createMcpExpressApp({ host: '127.0.0.1' });

    // Body parsing for login form
    app.use('/login', express.urlencoded({ extended: false }));

    // Bind first so we know the real port for issuerUrl
    await new Promise((resolve) => {
      httpServer = app.listen(0, '127.0.0.1', () => {
        const addr = httpServer.address();
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });

    const issuerUrl = new URL(baseUrl);

    app.use(mcpAuthRouter({ provider: oauthProvider, issuerUrl, resourceServerUrl: new URL('/mcp', issuerUrl) }));

    app.get('/login', (req, res) => {
      const safePending = (req.query.pending || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      res.type('html').send(`<form method="POST"><input name="password"><input type="hidden" name="pending" value="${safePending}"></form>`);
    });

    app.post('/login', (req, res) => {
      const { password, pending } = req.body;
      if (password !== SECRET) {
        return res.status(401).send('Wrong password');
      }
      let redirectUrl;
      try {
        redirectUrl = oauthProvider.approvePendingAuth(pending);
      } catch {
        return res.status(400).send('Invalid pending');
      }
      res.redirect(redirectUrl);
    });

    const bearerAuth = requireBearerAuth({ verifier: oauthProvider });

    app.post('/mcp', bearerAuth, async (req, res) => {
      const sessionId = req.headers['mcp-session-id'];
      if (sessionId) {
        if (sessions.has(sessionId)) {
          const session = sessions.get(sessionId);
          await session.transport.handleRequest(req, res, req.body);
        } else {
          res.status(404).json({ error: 'Session not found' });
        }
        return;
      }
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
      });
      const server = createTestMcpServer();
      await server.connect(transport);
      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid) sessions.delete(sid);
      };
      await transport.handleRequest(req, res, req.body);
      if (transport.sessionId) {
        sessions.set(transport.sessionId, { transport, server });
      }
    });

    app.get('/mcp', bearerAuth, async (req, res) => {
      const sessionId = req.headers['mcp-session-id'];
      if (!sessionId || !sessions.has(sessionId)) {
        return res.status(400).json({ error: 'Invalid or missing session ID' });
      }
      const session = sessions.get(sessionId);
      await session.transport.handleRequest(req, res);
    });

    app.delete('/mcp', bearerAuth, async (req, res) => {
      const sessionId = req.headers['mcp-session-id'];
      if (!sessionId || !sessions.has(sessionId)) {
        return res.status(404).json({ error: 'Session not found' });
      }
      const session = sessions.get(sessionId);
      await session.transport.close();
      sessions.delete(sessionId);
      res.status(200).json({ message: 'Session terminated' });
    });
  });

  after(async () => {
    for (const [, session] of sessions) {
      await session.transport.close().catch(() => {});
    }
    sessions.clear();
    await new Promise((resolve) => httpServer.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // Helper for HTTP requests
  function request(method, urlPath, { body, headers = {} } = {}) {
    return new Promise((resolve, reject) => {
      const url = new URL(urlPath, baseUrl);
      const opts = {
        method,
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        headers: { ...headers },
      };
      let payload;
      if (body) {
        if (typeof body === 'string') {
          payload = body;
          opts.headers['content-type'] = opts.headers['content-type'] || 'application/x-www-form-urlencoded';
        } else {
          payload = JSON.stringify(body);
          opts.headers['content-type'] = 'application/json';
        }
        opts.headers['content-length'] = Buffer.byteLength(payload);
      }
      const req = http.request(opts, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: data,
            json() { return JSON.parse(data); },
          });
        });
      });
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  }

  // Helper: complete OAuth flow and get an access token
  async function getAccessToken() {
    // 1. Register client
    const regRes = await request('POST', '/register', {
      body: {
        redirect_uris: ['http://localhost/callback'],
        client_name: 'Test',
        grant_types: ['authorization_code'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      },
    });
    const clientInfo = regRes.json();

    // 2. Authorize — follow redirect to get pending ID
    const authRes = await request('GET', `/authorize?response_type=code&client_id=${clientInfo.client_id}&redirect_uri=${encodeURIComponent('http://localhost/callback')}&code_challenge=test-challenge&code_challenge_method=S256&state=test-state`);
    assert.equal(authRes.status, 302);
    const loginUrl = new URL(authRes.headers.location, baseUrl);
    const pendingId = loginUrl.searchParams.get('pending');

    // 3. Approve via provider directly (simulates correct password)
    const redirectUrl = oauthProvider.approvePendingAuth(pendingId);
    const code = new URL(redirectUrl).searchParams.get('code');

    // 4. Exchange code for token (skip PKCE since we're testing transport)
    // Use provider directly since PKCE validation would fail without proper verifier
    const tokens = await oauthProvider.exchangeAuthorizationCode(clientInfo, code);
    return tokens.access_token;
  }

  describe('OAuth metadata', () => {
    it('GET /.well-known/oauth-authorization-server returns metadata', async () => {
      const res = await request('GET', '/.well-known/oauth-authorization-server');
      assert.equal(res.status, 200);
      const meta = res.json();
      assert.ok(meta.authorization_endpoint);
      assert.ok(meta.token_endpoint);
      assert.ok(meta.registration_endpoint);
    });

    it('GET /.well-known/oauth-protected-resource/mcp returns resource metadata', async () => {
      const res = await request('GET', '/.well-known/oauth-protected-resource/mcp');
      assert.equal(res.status, 200);
      const meta = res.json();
      assert.ok(meta.resource);
      assert.ok(meta.authorization_servers);
    });
  });

  describe('Client registration', () => {
    it('POST /register with valid metadata returns client_id', async () => {
      const res = await request('POST', '/register', {
        body: {
          redirect_uris: ['http://localhost/callback'],
          client_name: 'Dynamic Client',
          grant_types: ['authorization_code'],
          response_types: ['code'],
          token_endpoint_auth_method: 'none',
        },
      });
      assert.equal(res.status, 201);
      const client = res.json();
      assert.ok(client.client_id);
    });
  });

  describe('Authorization flow', () => {
    it('GET /authorize redirects to /login', async () => {
      // Register a client first
      const regRes = await request('POST', '/register', {
        body: {
          redirect_uris: ['http://localhost/callback'],
          grant_types: ['authorization_code'],
          response_types: ['code'],
          token_endpoint_auth_method: 'none',
        },
      });
      const clientInfo = regRes.json();

      const res = await request('GET', `/authorize?response_type=code&client_id=${clientInfo.client_id}&redirect_uri=${encodeURIComponent('http://localhost/callback')}&code_challenge=abc&code_challenge_method=S256&state=xyz`);
      assert.equal(res.status, 302);
      assert.ok(res.headers.location.includes('/login?pending='));
    });
  });

  describe('Login page', () => {
    it('GET /login returns HTML form', async () => {
      const res = await request('GET', '/login?pending=test-id');
      assert.equal(res.status, 200);
      assert.ok(res.body.includes('<form'));
      assert.ok(res.body.includes('pending'));
    });

    it('POST /login with wrong password returns 401', async () => {
      const res = await request('POST', '/login', {
        body: 'password=wrong&pending=test-id',
      });
      assert.equal(res.status, 401);
    });

    it('POST /login with correct password redirects', async () => {
      // Set up a real pending auth
      const regRes = await request('POST', '/register', {
        body: {
          redirect_uris: ['http://localhost/callback'],
          grant_types: ['authorization_code'],
          response_types: ['code'],
          token_endpoint_auth_method: 'none',
        },
      });
      const clientInfo = regRes.json();
      const authRes = await request('GET', `/authorize?response_type=code&client_id=${clientInfo.client_id}&redirect_uri=${encodeURIComponent('http://localhost/callback')}&code_challenge=abc&code_challenge_method=S256&state=xyz`);
      const pendingId = new URL(authRes.headers.location, baseUrl).searchParams.get('pending');

      const loginRes = await request('POST', '/login', {
        body: `password=${SECRET}&pending=${pendingId}`,
      });
      assert.equal(loginRes.status, 302);
      const redirectUrl = new URL(loginRes.headers.location);
      assert.ok(redirectUrl.searchParams.get('code'));
      assert.equal(redirectUrl.searchParams.get('state'), 'xyz');
    });
  });

  describe('MCP endpoint', () => {
    it('POST /mcp without auth returns 401', async () => {
      const res = await request('POST', '/mcp', {
        body: { jsonrpc: '2.0', method: 'initialize', id: 1, params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } } },
      });
      assert.equal(res.status, 401);
    });

    it('POST /mcp with valid auth initializes session', async () => {
      const token = await getAccessToken();
      const res = await request('POST', '/mcp', {
        body: { jsonrpc: '2.0', method: 'initialize', id: 1, params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } } },
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json, text/event-stream' },
      });
      assert.equal(res.status, 200);
      assert.ok(res.headers['mcp-session-id']);
    });

    it('session reuse works', async () => {
      const token = await getAccessToken();

      // Initialize
      const initRes = await request('POST', '/mcp', {
        body: { jsonrpc: '2.0', method: 'initialize', id: 1, params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } } },
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json, text/event-stream' },
      });
      const sessionId = initRes.headers['mcp-session-id'];

      // Send initialized notification on same session
      const notifRes = await request('POST', '/mcp', {
        body: { jsonrpc: '2.0', method: 'notifications/initialized' },
        headers: { Authorization: `Bearer ${token}`, 'mcp-session-id': sessionId, Accept: 'application/json, text/event-stream' },
      });
      assert.ok([200, 202, 204].includes(notifRes.status));
    });

    it('DELETE /mcp terminates session', async () => {
      const token = await getAccessToken();

      const initRes = await request('POST', '/mcp', {
        body: { jsonrpc: '2.0', method: 'initialize', id: 1, params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } } },
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json, text/event-stream' },
      });
      const sessionId = initRes.headers['mcp-session-id'];

      const delRes = await request('DELETE', '/mcp', {
        headers: { Authorization: `Bearer ${token}`, 'mcp-session-id': sessionId },
      });
      assert.equal(delRes.status, 200);
    });
  });
});
