/**
 * Unified configuration for the merged MCP + Auth server
 *
 * This configuration supports two modes:
 * - internal: Auth server runs in-process (default for demo/development)
 * - external: Auth server runs separately (production pattern)
 */

import 'dotenv/config';

export interface Config {
  // Server configuration
  port: number;
  baseUri: string;
  nodeEnv: string;

  // Auth configuration
  auth: {
    mode: 'internal' | 'external' | 'auth_server';
    externalUrl?: string; // URL of external auth server (if mode=external)
  };

  // Redis configuration (optional)
  redis: {
    enabled: boolean;
    url?: string;
    tls?: boolean;
  };
}

/**
 * Load configuration from environment variables
 */
function loadConfig(): Config {
  const authMode = (process.env.AUTH_MODE || 'internal') as 'internal' | 'external' | 'auth_server';

  // Validate configuration
  if (authMode === 'external' && !process.env.AUTH_SERVER_URL) {
    throw new Error('AUTH_SERVER_URL must be set when AUTH_MODE=external');
  }

  return {
    // Server configuration
    port: Number(process.env.PORT) || 3232,
    baseUri: process.env.BASE_URI || 'http://localhost:3232',
    nodeEnv: process.env.NODE_ENV || 'development',

    // Auth configuration
    auth: {
      mode: authMode,
      externalUrl: process.env.AUTH_SERVER_URL
    },

    // Redis configuration
    redis: {
      enabled: !!process.env.REDIS_URL,
      url: process.env.REDIS_URL,
      tls: process.env.REDIS_TLS === '1' || process.env.REDIS_TLS === 'true'
    }
  };
}

// Export singleton config
export const config = loadConfig();

// Log configuration on startup (without sensitive values)
console.log('Configuration loaded:');
console.log('   Port:', config.port);
console.log('   Base URI:', config.baseUri);
console.log('   Auth Mode:', config.auth.mode);
if (config.auth.mode === 'external') {
  console.log('   Auth Server:', config.auth.externalUrl);
}
console.log('   Redis:', config.redis.enabled ? 'enabled' : 'disabled');
console.log('');