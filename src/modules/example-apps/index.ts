/**
 * Example Apps Module - Mounts ext-apps example servers at /:slug/mcp
 *
 * Each example MCP App server is mounted at its own path, sharing the same
 * OAuth authentication as the main MCP server.
 *
 * These servers run in STATELESS mode - each request creates a fresh server
 * instance without maintaining session state across requests.
 */

import { Router, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { BearerAuthMiddlewareOptions, requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ITokenValidator } from '../../interfaces/auth-validator.js';
import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';

// Import createServer from each example package (compiled JS)
// All packages are published on the public npm registry
import { createServer as createBudgetAllocatorServer } from '@modelcontextprotocol/server-budget-allocator';
import { createServer as createCohortHeatmapServer } from '@modelcontextprotocol/server-cohort-heatmap';
import { createServer as createCustomerSegmentationServer } from '@modelcontextprotocol/server-customer-segmentation';
import { createServer as createMapServer } from '@modelcontextprotocol/server-map';
import { createServer as createPdfServer } from '@modelcontextprotocol/server-pdf';
import { createServer as createScenarioModelerServer } from '@modelcontextprotocol/server-scenario-modeler';
import { createServer as createShadertoyServer } from '@modelcontextprotocol/server-shadertoy';
import { createServer as createSheetMusicServer } from '@modelcontextprotocol/server-sheet-music';
import { createServer as createSystemMonitorServer } from '@modelcontextprotocol/server-system-monitor';
import { createServer as createThreejsServer } from '@modelcontextprotocol/server-threejs';
import { createServer as createTranscriptServer } from '@modelcontextprotocol/server-transcript';
import { createServer as createVideoResourceServer } from '@modelcontextprotocol/server-video-resource';
import { createServer as createWikiExplorerServer } from '@modelcontextprotocol/server-wiki-explorer';

declare module "express-serve-static-core" {
  interface Request {
    auth?: AuthInfo;
  }
}

// Map of slug to createServer function
const EXAMPLE_SERVERS: Record<string, () => McpServer> = {
  'budget-allocator': createBudgetAllocatorServer,
  'cohort-heatmap': createCohortHeatmapServer,
  'customer-segmentation': createCustomerSegmentationServer,
  'map': createMapServer,
  'pdf': createPdfServer,
  'scenario-modeler': createScenarioModelerServer,
  'shadertoy': createShadertoyServer,
  'sheet-music': createSheetMusicServer,
  'system-monitor': createSystemMonitorServer,
  'threejs': createThreejsServer,
  'transcript': createTranscriptServer,
  'video-resource': createVideoResourceServer,
  'wiki-explorer': createWikiExplorerServer,
};

export interface ExampleAppsConfig {
  baseUri: string;
}

export class ExampleAppsModule {
  private router: Router;

  constructor(
    private config: ExampleAppsConfig,
    private tokenValidator: ITokenValidator
  ) {
    this.router = this.setupRouter();
  }

  getRouter(): Router {
    return this.router;
  }

  private setupRouter(): Router {
    const router = Router();

    // CORS configuration - intentionally permissive for public MCP reference server
    const corsOptions = {
      origin: true,
      methods: ['GET', 'POST', 'DELETE'],
      allowedHeaders: ['Content-Type', 'Authorization', 'Mcp-Protocol-Version', 'Mcp-Protocol-Id', 'Mcp-Session-Id'],
      exposedHeaders: ['Mcp-Protocol-Version', 'Mcp-Protocol-Id', 'Mcp-Session-Id'],
      credentials: true
    };

    // Security headers
    const securityHeaders = (req: Request, res: Response, next: NextFunction) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'SAMEORIGIN');
      next();
    };

    // Bearer auth middleware
    const bearerAuthOptions: BearerAuthMiddlewareOptions = {
      verifier: this.tokenValidator,
      resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(new URL(this.config.baseUri))
    };
    const bearerAuth = requireBearerAuth(bearerAuthOptions);

    // Handler for /:slug/mcp - stateless: each request creates a fresh server
    const handleExampleMcp = async (req: Request, res: Response) => {
      const { slug } = req.params;
      const createServer = EXAMPLE_SERVERS[slug];

      if (!createServer) {
        res.status(404).json({
          jsonrpc: "2.0",
          error: { code: -32001, message: "Unknown example server" },
          id: null,
        });
        return;
      }

      try {
        // Log initialization requests to inspect client capabilities/extensions
        if (isInitializeRequest(req.body)) {
          const initParams = req.body?.params;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const capabilities = initParams?.capabilities as Record<string, any> | undefined;
          console.log(JSON.stringify({
            severity: 'INFO',
            message: `=== MCP INITIALIZE REQUEST (${slug}) ===`,
            timestamp: new Date().toISOString(),
            slug,
            clientInfo: initParams?.clientInfo,
            protocolVersion: initParams?.protocolVersion,
            capabilities,
            hasExtensions: !!capabilities?.extensions,
            extensions: capabilities?.extensions,
          }));
        }

        // Create fresh server and transport for each request (stateless mode)
        const server = createServer();
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined, // Stateless: no session management
        });

        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
      } catch (error) {
        console.error('Error handling MCP request:', error);
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: "2.0",
            error: { code: -32603, message: "Internal error" },
            id: null,
          });
        }
      }
    };

    // Mount routes for each example server
    router.get('/:slug/mcp', cors(corsOptions), bearerAuth, securityHeaders, handleExampleMcp);
    router.post('/:slug/mcp', cors(corsOptions), bearerAuth, securityHeaders, handleExampleMcp);
    router.delete('/:slug/mcp', cors(corsOptions), bearerAuth, securityHeaders, handleExampleMcp);

    return router;
  }
}

// Export list of available examples for documentation
export const AVAILABLE_EXAMPLES = Object.keys(EXAMPLE_SERVERS);
