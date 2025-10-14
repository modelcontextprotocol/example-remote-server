/**
 * MCP Module - Self-contained MCP server module
 *
 * This module provides all MCP protocol functionality (tools, resources, prompts).
 * It depends only on the ITokenValidator interface for authentication, not on
 * any specific auth implementation.
 *
 * This clean separation means the MCP module works identically whether auth
 * is internal (in-process) or external (HTTP).
 */

import { Router, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { BearerAuthMiddlewareOptions, requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { ITokenValidator } from '../../interfaces/auth-validator.js';
import { handleStreamableHTTP } from './handlers/shttp.js';
import { handleMessage, handleSSEConnection } from './handlers/sse.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface MCPConfig {
  baseUri: string;
  redisUrl?: string;
}

export class MCPModule {
  private router: Router;

  constructor(
    private config: MCPConfig,
    private tokenValidator: ITokenValidator
  ) {
    this.router = this.setupRouter();
  }

  /**
   * Get Express router with all MCP endpoints
   */
  getRouter(): Router {
    return this.router;
  }

  private setupRouter(): Router {
    const router = Router();

    // CORS configuration for MCP endpoints
    const corsOptions = {
      origin: true, // Allow any origin
      methods: ['GET', 'POST', 'DELETE'],
      allowedHeaders: ['Content-Type', 'Authorization', 'Mcp-Protocol-Version', 'Mcp-Protocol-Id'],
      exposedHeaders: ['Mcp-Protocol-Version', 'Mcp-Protocol-Id'],
      credentials: true
    };

    // Security headers for MCP endpoints
    const securityHeaders = (req: Request, res: Response, next: NextFunction) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'SAMEORIGIN');
      next();
    };

    // SSE-specific headers
    const sseHeaders = (req: Request, res: Response, next: NextFunction) => {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-store, max-age=0');
      res.setHeader('Connection', 'keep-alive');
      next();
    };

    // Bearer auth middleware using our token validator
    // This works the same whether the validator is internal or external
    const bearerAuthOptions: BearerAuthMiddlewareOptions = {
      verifier: this.tokenValidator,
      resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(new URL(this.config.baseUri))
    };
    const bearerAuth = requireBearerAuth(bearerAuthOptions);

    // MCP endpoints - Streamable HTTP transport (recommended)
    router.get('/mcp', cors(corsOptions), bearerAuth, securityHeaders, handleStreamableHTTP);
    router.post('/mcp', cors(corsOptions), bearerAuth, securityHeaders, handleStreamableHTTP);
    router.delete('/mcp', cors(corsOptions), bearerAuth, securityHeaders, handleStreamableHTTP);

    // MCP endpoints - SSE transport (legacy)
    router.get('/sse', cors(corsOptions), bearerAuth, sseHeaders, handleSSEConnection);
    router.post('/message', cors(corsOptions), bearerAuth, securityHeaders, handleMessage);

    // Health check
    router.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        service: 'mcp',
        endpoints: {
          streamable: '/mcp',
          sse: '/sse'
        }
      });
    });

    // Static files for MCP
    router.get('/styles.css', (req, res) => {
      const cssPath = path.join(__dirname, '../../static', 'styles.css');
      res.setHeader('Content-Type', 'text/css');
      res.sendFile(cssPath);
    });

    return router;
  }
}