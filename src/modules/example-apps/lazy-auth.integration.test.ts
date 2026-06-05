/**
 * Integration tests for the lazy-auth example mount.
 *
 * Verifies that the @modelcontextprotocol/server-lazy-auth app, mounted at
 * /lazy-auth, advertises URLs under the mount path, that RFC 8414/9728
 * path-insertion well-known URLs at the host root reach the example, that the
 * host's own root OAuth endpoints are untouched, and that the full lazy-auth
 * flow (401 -> discovery -> PKCE -> token -> authed tool call) works
 * end-to-end over HTTP.
 */
import { createHash } from 'crypto';
import http from 'http';
import express from 'express';
import { AddressInfo } from 'net';
import { mountLazyAuthExample } from './lazy-auth.js';

interface HttpResult {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

function request(url: string, options: http.RequestOptions = {}, body?: string): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const req = http.request(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

function callTool(base: string, name: string, accessToken?: string): Promise<HttpResult> {
  return request(
    `${base}/lazy-auth/mcp`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      },
    },
    JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: {} } })
  );
}

describe('Lazy Auth example mount', () => {
  let server: http.Server;
  let base: string;

  beforeAll(async () => {
    const app = express();
    // Mirror src/index.ts: the example mounts before the host's middleware
    // and routes.
    mountLazyAuthExample(app);
    app.use(express.json());
    // Sentinels for the host's own root OAuth surface, which the example's
    // well-known rewrite must not shadow.
    app.get('/.well-known/oauth-authorization-server', (_req, res) => {
      res.json({ issuer: 'HOST-OWN-AS' });
    });
    app.get('/authorize', (_req, res) => {
      res.send('HOST-OWN-AUTHORIZE');
    });

    server = await new Promise((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    base = `http://localhost:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it('serves public MCP requests without auth', async () => {
    const res = await request(
      `${base}/lazy-auth/mcp`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      },
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } },
      })
    );
    expect(res.status).toBe(200);
    expect(res.body).toContain('Lazy Auth');
  });

  it('answers 401 with resource_metadata under the mount path for protected tools', async () => {
    const res = await callTool(base, 'get_secret');
    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toContain(`resource_metadata="${base}/lazy-auth/auth/prm"`);
  });

  it('advertises mount-prefixed URLs in PRM and AS metadata', async () => {
    const prm = JSON.parse((await request(`${base}/lazy-auth/auth/prm`)).body);
    expect(prm.resource).toBe(`${base}/lazy-auth/mcp`);
    expect(prm.authorization_servers).toEqual([`${base}/lazy-auth`]);

    // RFC 8414 path-insertion form at the host root (the only form MCP SDK
    // clients try for an issuer with a path).
    const asRes = await request(`${base}/.well-known/oauth-authorization-server/lazy-auth`);
    expect(asRes.status).toBe(200);
    const as = JSON.parse(asRes.body);
    expect(as.issuer).toBe(`${base}/lazy-auth`);
    expect(as.authorization_endpoint).toBe(`${base}/lazy-auth/authorize`);
    expect(as.token_endpoint).toBe(`${base}/lazy-auth/token`);
  });

  it('serves TTL-scoped PRM through the path-insertion form', async () => {
    const res = await request(`${base}/.well-known/oauth-protected-resource/lazy-auth/ttl/3600/mcp`);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).resource).toBe(`${base}/lazy-auth/ttl/3600/mcp`);
  });

  it('leaves the host root OAuth surface untouched', async () => {
    const as = await request(`${base}/.well-known/oauth-authorization-server`);
    expect(JSON.parse(as.body).issuer).toBe('HOST-OWN-AS');
    const authorize = await request(`${base}/authorize`);
    expect(authorize.body).toBe('HOST-OWN-AUTHORIZE');
  });

  it('completes the full lazy-auth flow: PKCE -> token -> authed tool call', async () => {
    const verifier = 'v'.repeat(43);
    const challenge = createHash('sha256').update(verifier).digest('base64url');

    const authorizeUrl = new URL(`${base}/lazy-auth/authorize`);
    const params: Record<string, string> = {
      client_id: 'test-client',
      redirect_uri: 'http://localhost:1234/callback',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: 'test-state',
      approved: '1',
      resource: `${base}/lazy-auth/mcp`,
    };
    for (const [k, v] of Object.entries(params)) authorizeUrl.searchParams.set(k, v);

    const authorizeRes = await request(authorizeUrl.href);
    expect(authorizeRes.status).toBe(302);
    const redirect = new URL(authorizeRes.headers.location!);
    const code = redirect.searchParams.get('code')!;
    expect(code).toBeTruthy();
    expect(redirect.searchParams.get('state')).toBe('test-state');

    const tokenRes = await request(
      `${base}/lazy-auth/token`,
      { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' } },
      new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
        resource: `${base}/lazy-auth/mcp`,
      }).toString()
    );
    expect(tokenRes.status).toBe(200);
    const token = JSON.parse(tokenRes.body);
    expect(token.access_token).toBeTruthy();
    expect(token.refresh_token).toBeTruthy();

    const secretRes = await callTool(base, 'get_secret', token.access_token);
    expect(secretRes.status).toBe(200);
    expect(secretRes.body).toContain('the-answer-is-42');
  });
});
