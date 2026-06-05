/**
 * Lazy Auth Example - Mounts @modelcontextprotocol/server-lazy-auth at /lazy-auth
 *
 * Unlike the other example servers (plain createServer() factories in
 * ./index.ts), the lazy-auth example's whole point is its HTTP layer: public
 * tools work unauthenticated, protected tools answer 401 + WWW-Authenticate,
 * and a built-in mock OAuth authorization server completes the flow. So we
 * mount its full Express app under /lazy-auth instead of adding it to the
 * generic stateless handler.
 *
 * Call mountLazyAuthExample() BEFORE registering the host's own middleware
 * (CORS, body parsing, logging) so the example's responses stay fully
 * self-contained, and before any other /.well-known routes.
 *
 * The example advertises absolute OAuth URLs (issuer, authorize/token
 * endpoints, PRM resource, WWW-Authenticate resource_metadata). It resolves
 * them from PUBLIC_URL, falling back to the request Host header for loopback
 * hosts only. We derive PUBLIC_URL from this server's own public base URI -
 * already the source of truth for the host's OAuth issuer - so deployments
 * need no separate env var. An explicit PUBLIC_URL still wins (e.g. a tunnel);
 * omitting baseUri (e.g. tests on an ephemeral port) keeps the package's
 * per-request Host resolution.
 */
import { Express, Request, Response, NextFunction } from 'express';
import { createApp as createLazyAuthApp } from '@modelcontextprotocol/server-lazy-auth';

export const LAZY_AUTH_SLUG = 'lazy-auth';

export function mountLazyAuthExample(app: Express, baseUri?: string): void {
  if (baseUri && !process.env.PUBLIC_URL) {
    process.env.PUBLIC_URL = `${baseUri.replace(/\/+$/, '')}/${LAZY_AUTH_SLUG}`;
  }

  // RFC 8414/9728 place well-known discovery documents at the origin root,
  // with the resource path inserted after the well-known prefix
  // (e.g. /.well-known/oauth-authorization-server/lazy-auth), and MCP SDK
  // clients only try that insertion form. Rewrite those root paths into the
  // mount - rather than dispatching to the sub-app directly - so req.baseUrl
  // (and therefore every URL the example advertises) stays consistent.
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const wellKnown = req.url.match(
      /^\/\.well-known\/(oauth-authorization-server|oauth-protected-resource)\/lazy-auth(\/.*)?$/
    );
    if (wellKnown) {
      req.url = `/${LAZY_AUTH_SLUG}/.well-known/${wellKnown[1]}${wellKnown[2] ?? ''}`;
    }
    next();
  });

  app.use(`/${LAZY_AUTH_SLUG}`, createLazyAuthApp());
}
