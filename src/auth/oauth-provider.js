import crypto from 'crypto';

const AUTH_CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export class BearOAuthProvider {
  constructor({ clientsStore, secret, tokenTtlSeconds }) {
    this._clientsStore = clientsStore;
    this._secret = secret;
    this._tokenTtlSeconds = tokenTtlSeconds;

    // In-memory stores (acceptable for personal server)
    this._pendingAuths = new Map();  // pendingId → { client, params }
    this._authCodes = new Map();     // code → { clientId, codeChallenge, redirectUri, state, expiresAt }
    this._accessTokens = new Map();  // token → { clientId, scopes, expiresAt }
    this._refreshTokens = new Map(); // token → { clientId, scopes }
  }

  get clientsStore() {
    return this._clientsStore;
  }

  async authorize(client, params, res) {
    const pendingId = crypto.randomUUID();
    this._pendingAuths.set(pendingId, { client, params, expiresAt: Date.now() + AUTH_CODE_TTL_MS });
    res.redirect(`/login?pending=${pendingId}`);
  }

  approvePendingAuth(pendingId) {
    const pending = this._pendingAuths.get(pendingId);
    if (!pending) {
      throw new Error('Invalid or expired pending authorization');
    }
    this._pendingAuths.delete(pendingId);
    if (Date.now() > pending.expiresAt) {
      throw new Error('Invalid or expired pending authorization');
    }

    const code = crypto.randomUUID();
    const { client, params } = pending;

    this._authCodes.set(code, {
      clientId: client.client_id,
      codeChallenge: params.codeChallenge,
      redirectUri: params.redirectUri,
      state: params.state,
      expiresAt: Date.now() + AUTH_CODE_TTL_MS,
    });

    const url = new URL(params.redirectUri);
    url.searchParams.set('code', code);
    if (params.state) {
      url.searchParams.set('state', params.state);
    }
    return url.toString();
  }

  async challengeForAuthorizationCode(_client, authorizationCode) {
    const record = this._authCodes.get(authorizationCode);
    if (!record) throw new Error('Invalid authorization code');
    if (Date.now() > record.expiresAt) {
      this._authCodes.delete(authorizationCode);
      throw new Error('Authorization code expired');
    }
    return record.codeChallenge;
  }

  async exchangeAuthorizationCode(client, authorizationCode, redirectUri) {
    const record = this._authCodes.get(authorizationCode);
    if (!record) throw new Error('Invalid authorization code');
    if (record.clientId !== client.client_id) throw new Error('Client mismatch');
    if (Date.now() > record.expiresAt) {
      this._authCodes.delete(authorizationCode);
      throw new Error('Authorization code expired');
    }
    if (record.redirectUri && redirectUri && record.redirectUri !== redirectUri) {
      throw new Error('Redirect URI mismatch');
    }

    this._authCodes.delete(authorizationCode);

    const accessToken = crypto.randomUUID();
    const refreshToken = crypto.randomUUID();
    const expiresAt = Math.floor(Date.now() / 1000) + this._tokenTtlSeconds;

    this._accessTokens.set(accessToken, {
      clientId: client.client_id,
      scopes: [],
      expiresAt,
    });

    this._refreshTokens.set(refreshToken, {
      clientId: client.client_id,
      scopes: [],
    });

    return {
      access_token: accessToken,
      token_type: 'bearer',
      expires_in: this._tokenTtlSeconds,
      refresh_token: refreshToken,
    };
  }

  async exchangeRefreshToken(client, refreshToken) {
    const record = this._refreshTokens.get(refreshToken);
    if (!record) throw new Error('Invalid refresh token');
    if (record.clientId !== client.client_id) throw new Error('Client mismatch');

    const accessToken = crypto.randomUUID();
    const expiresAt = Math.floor(Date.now() / 1000) + this._tokenTtlSeconds;

    this._accessTokens.set(accessToken, {
      clientId: client.client_id,
      scopes: record.scopes,
      expiresAt,
    });

    return {
      access_token: accessToken,
      token_type: 'bearer',
      expires_in: this._tokenTtlSeconds,
      refresh_token: refreshToken,
    };
  }

  async verifyAccessToken(token) {
    const record = this._accessTokens.get(token);
    if (!record) throw new Error('Invalid access token');
    if (Math.floor(Date.now() / 1000) > record.expiresAt) {
      this._accessTokens.delete(token);
      throw new Error('Access token expired');
    }

    return {
      token,
      clientId: record.clientId,
      scopes: record.scopes,
      expiresAt: record.expiresAt,
    };
  }

  async revokeToken(client, request) {
    const access = this._accessTokens.get(request.token);
    if (access && access.clientId === client.client_id) {
      this._accessTokens.delete(request.token);
    }
    const refresh = this._refreshTokens.get(request.token);
    if (refresh && refresh.clientId === client.client_id) {
      this._refreshTokens.delete(request.token);
    }
  }
}
