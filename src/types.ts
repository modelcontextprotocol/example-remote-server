import { OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";

// authorization code -> PendingAuthorization
export interface PendingAuthorization {
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  clientId: string;
  state?: string;
}

// authorization code -> MCP access token (once authorized)
export interface TokenExchange {
  mcpAccessToken: string;
  alreadyUsed: boolean;
}

export interface FakeUpstreamInstallation {
  fakeAccessTokenForDemonstration: string;
  fakeRefreshTokenForDemonstration: string;
}

// This is the object stored in Redis holding the upstream "Installation" + all the relevant MCP tokens
// It is stored encrypted by the MCP access token
export interface McpInstallation {
  fakeUpstreamInstallation: FakeUpstreamInstallation;
  mcpTokens: OAuthTokens;
  clientId: string;
  issuedAt: number;
  userId: string; // Unique identifier for the user (not client)
}