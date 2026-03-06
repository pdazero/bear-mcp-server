import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { BearOAuthProvider } from '../src/auth/oauth-provider.js';

function mockClientsStore() {
  const clients = new Map();
  return {
    getClient(id) { return clients.get(id); },
    registerClient(info) {
      const client = { ...info, client_id: 'test-client', client_id_issued_at: 1 };
      clients.set('test-client', client);
      return client;
    },
  };
}

function makeClient() {
  return {
    client_id: 'test-client',
    redirect_uris: ['http://localhost/callback'],
  };
}

function makeParams(overrides = {}) {
  return {
    codeChallenge: 'test-challenge-xyz',
    redirectUri: 'http://localhost/callback',
    state: 'test-state',
    ...overrides,
  };
}

describe('BearOAuthProvider', () => {
  let provider;
  let client;

  beforeEach(() => {
    provider = new BearOAuthProvider({
      clientsStore: mockClientsStore(),
      secret: 'test-secret',
      tokenTtlSeconds: 3600,
    });
    client = makeClient();
  });

  describe('authorize', () => {
    it('saves pending auth and redirects to /login', async () => {
      let redirectedTo;
      const res = { redirect(url) { redirectedTo = url; } };

      await provider.authorize(client, makeParams(), res);
      assert.ok(redirectedTo.startsWith('/login?pending='));
    });
  });

  describe('approvePendingAuth', () => {
    it('generates auth code and returns redirect URL', async () => {
      let pendingId;
      const res = { redirect(url) { pendingId = new URL(url, 'http://x').searchParams.get('pending'); } };

      await provider.authorize(client, makeParams(), res);
      const redirectUrl = provider.approvePendingAuth(pendingId);

      const url = new URL(redirectUrl);
      assert.ok(url.searchParams.get('code'));
      assert.equal(url.searchParams.get('state'), 'test-state');
      assert.equal(url.origin + url.pathname, 'http://localhost/callback');
    });

    it('throws for invalid pending id', () => {
      assert.throws(() => provider.approvePendingAuth('nonexistent'), /Invalid or expired/);
    });
  });

  describe('challengeForAuthorizationCode', () => {
    it('returns the code challenge', async () => {
      let pendingId;
      const res = { redirect(url) { pendingId = new URL(url, 'http://x').searchParams.get('pending'); } };
      await provider.authorize(client, makeParams(), res);
      const redirectUrl = provider.approvePendingAuth(pendingId);
      const code = new URL(redirectUrl).searchParams.get('code');

      const challenge = await provider.challengeForAuthorizationCode(client, code);
      assert.equal(challenge, 'test-challenge-xyz');
    });
  });

  describe('exchangeAuthorizationCode', () => {
    async function getCode() {
      let pendingId;
      const res = { redirect(url) { pendingId = new URL(url, 'http://x').searchParams.get('pending'); } };
      await provider.authorize(client, makeParams(), res);
      const redirectUrl = provider.approvePendingAuth(pendingId);
      return new URL(redirectUrl).searchParams.get('code');
    }

    it('returns tokens and removes code', async () => {
      const code = await getCode();
      const tokens = await provider.exchangeAuthorizationCode(client, code);

      assert.ok(tokens.access_token);
      assert.ok(tokens.refresh_token);
      assert.equal(tokens.token_type, 'bearer');
      assert.equal(tokens.expires_in, 3600);

      // Code is single-use
      await assert.rejects(() => provider.exchangeAuthorizationCode(client, code), /Invalid/);
    });

    it('rejects invalid code', async () => {
      await assert.rejects(() => provider.exchangeAuthorizationCode(client, 'bogus'), /Invalid/);
    });

    it('rejects mismatched client', async () => {
      const code = await getCode();
      const otherClient = { ...client, client_id: 'other' };
      await assert.rejects(() => provider.exchangeAuthorizationCode(otherClient, code), /Client mismatch/);
    });
  });

  describe('exchangeRefreshToken', () => {
    it('generates new access token', async () => {
      let pendingId;
      const res = { redirect(url) { pendingId = new URL(url, 'http://x').searchParams.get('pending'); } };
      await provider.authorize(client, makeParams(), res);
      const code = new URL(provider.approvePendingAuth(pendingId)).searchParams.get('code');
      const tokens = await provider.exchangeAuthorizationCode(client, code);

      const refreshed = await provider.exchangeRefreshToken(client, tokens.refresh_token);
      assert.ok(refreshed.access_token);
      assert.notEqual(refreshed.access_token, tokens.access_token);
      assert.equal(refreshed.token_type, 'bearer');
    });
  });

  describe('verifyAccessToken', () => {
    async function getAccessToken() {
      let pendingId;
      const res = { redirect(url) { pendingId = new URL(url, 'http://x').searchParams.get('pending'); } };
      await provider.authorize(client, makeParams(), res);
      const code = new URL(provider.approvePendingAuth(pendingId)).searchParams.get('code');
      const tokens = await provider.exchangeAuthorizationCode(client, code);
      return tokens.access_token;
    }

    it('validates a good token', async () => {
      const token = await getAccessToken();
      const authInfo = await provider.verifyAccessToken(token);
      assert.equal(authInfo.token, token);
      assert.equal(authInfo.clientId, 'test-client');
    });

    it('rejects unknown token', async () => {
      await assert.rejects(() => provider.verifyAccessToken('bogus'), /Invalid/);
    });

    it('rejects expired token', async () => {
      const token = await getAccessToken();

      // Manually expire the token
      const record = provider._accessTokens.get(token);
      record.expiresAt = Math.floor(Date.now() / 1000) - 10;

      await assert.rejects(() => provider.verifyAccessToken(token), /expired/);
    });
  });

  describe('revokeToken', () => {
    it('removes token so verification fails', async () => {
      let pendingId;
      const res = { redirect(url) { pendingId = new URL(url, 'http://x').searchParams.get('pending'); } };
      await provider.authorize(client, makeParams(), res);
      const code = new URL(provider.approvePendingAuth(pendingId)).searchParams.get('code');
      const tokens = await provider.exchangeAuthorizationCode(client, code);

      await provider.revokeToken(client, { token: tokens.access_token });
      await assert.rejects(() => provider.verifyAccessToken(tokens.access_token), /Invalid/);
    });
  });

  describe('auth code expiration', () => {
    it('rejects expired auth codes', async () => {
      // Override AUTH_CODE_TTL by directly manipulating the stored code
      let pendingId;
      const res = { redirect(url) { pendingId = new URL(url, 'http://x').searchParams.get('pending'); } };
      await provider.authorize(client, makeParams(), res);
      const redirectUrl = provider.approvePendingAuth(pendingId);
      const code = new URL(redirectUrl).searchParams.get('code');

      // Expire the code manually
      const record = provider._authCodes.get(code);
      record.expiresAt = Date.now() - 1000;

      await assert.rejects(() => provider.exchangeAuthorizationCode(client, code), /expired/);
    });
  });

  describe('cleanup', () => {
    it('purges expired pending auths and auth codes', async () => {
      let pendingId;
      const res = { redirect(url) { pendingId = new URL(url, 'http://x').searchParams.get('pending'); } };

      // Create a pending auth and expire it
      await provider.authorize(client, makeParams(), res);
      const pendingRecord = provider._pendingAuths.get(pendingId);
      pendingRecord.expiresAt = Date.now() - 1000;

      // Create an auth code and expire it
      await provider.authorize(client, makeParams(), res);
      const redirectUrl = provider.approvePendingAuth(pendingId);
      const code = new URL(redirectUrl).searchParams.get('code');
      const codeRecord = provider._authCodes.get(code);
      codeRecord.expiresAt = Date.now() - 1000;

      const purged = provider._purgeExpired();
      assert.ok(purged >= 2);
      assert.equal(provider._authCodes.has(code), false);
    });

    it('purges expired access tokens', async () => {
      let pendingId;
      const res = { redirect(url) { pendingId = new URL(url, 'http://x').searchParams.get('pending'); } };
      await provider.authorize(client, makeParams(), res);
      const code = new URL(provider.approvePendingAuth(pendingId)).searchParams.get('code');
      const tokens = await provider.exchangeAuthorizationCode(client, code);

      // Expire the access token
      const record = provider._accessTokens.get(tokens.access_token);
      record.expiresAt = Math.floor(Date.now() / 1000) - 10;

      const purged = provider._purgeExpired();
      assert.ok(purged >= 1);
      assert.equal(provider._accessTokens.has(tokens.access_token), false);
    });

    it('startCleanup and stopCleanup manage interval lifecycle', () => {
      provider.startCleanup(100_000);
      assert.ok(provider._cleanupInterval);
      provider.stopCleanup();
      assert.equal(provider._cleanupInterval, null);
    });
  });
});
