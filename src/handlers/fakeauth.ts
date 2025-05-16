import { Request, Response } from "express";
import { generateMcpTokens, readPendingAuthorization, saveMcpInstallation, saveRefreshToken, saveTokenExchange } from "../services/auth.js";
import { McpInstallation } from "../types.js";

// this module has a fake upstream auth server that returns a fake auth code, it also allows you to authorize or fail 
// authorization, to test the different flows

// TODO: make an implementation of this using the ProxyAuthProvider

// This is mocking an upstream auth server. This wouldn't normally be in the same server as the MCP auth server
export async function handleFakeAuthorize(req: Request, res: Response) {
  // get the redirect_uri and state from the query params
  const { redirect_uri, state } = req.query;

  // TODO, mint actual codes?

  res.send(`
    <html>
      <head>
        <title>Fake Upstream Auth Provider!</title>
      </head>
      <body>
        <h1>Fake Auth</h1>
        <p>Fake auth page</p>
        <p>Click <a href="${redirect_uri}?state=${state}&code=fakecode">here</a> to authorize</p>
        <p>Click <a href="${redirect_uri}?state=${state}&code=fakecode">here</a> to fail authorization</p>
      </body>
    </html>
  `);
}


// This is the callback URL that the upstream auth server will redirect to after authorization
export async function handleFakeAuthorizeRedirect(req: Request, res: Response) {
  const {
    // The state returned from the upstream auth server is actually the authorization code
    state: mcpAuthorizationCode,
    code: upstreamAuthorizationCode,
  } = req.query;

  // This is where you'd exchange the upstreamAuthorizationCode for access/refresh tokens
  // In this case, we're just going to fake it
  const upstreamTokens = await fakeUpstreamTokenExchange(upstreamAuthorizationCode as string);

  // Validate that it's a string
  if (typeof mcpAuthorizationCode !== "string") {
    throw new Error("Invalid authorization code");
  }

  const pendingAuth = await readPendingAuthorization(mcpAuthorizationCode);
  if (!pendingAuth) {
    throw new Error("No matching authorization found");
  }


  const mcpTokens = generateMcpTokens();

  const mcpInstallation: McpInstallation = {
    fakeUpstreamInstallation: {
      fakeAccessTokenForDemonstration: upstreamTokens.access_token,
      fakeRefreshTokenForDemonstration: upstreamTokens.refresh_token,
    },
    mcpTokens,
    clientId: pendingAuth.clientId,
    issuedAt: Date.now() / 1000,
  }

  // Store the upstream authorization data
  await saveMcpInstallation(mcpTokens.access_token, mcpInstallation);

  // Store the refresh token -> access token mapping
  if (mcpTokens.refresh_token) {
    await saveRefreshToken(mcpTokens.refresh_token, mcpTokens.access_token);
  }

  // Store the token exchange data
  await saveTokenExchange(mcpAuthorizationCode, {
    mcpAccessToken: mcpTokens.access_token,
    alreadyUsed: false,
  });

  // Redirect back to the original application with the authorization code and state
  const redirectUrl = pendingAuth.state ?
    `${pendingAuth.redirectUri}?code=${mcpAuthorizationCode}&state=${pendingAuth.state}` :
    `${pendingAuth.redirectUri}?code=${mcpAuthorizationCode}`;
  res.redirect(redirectUrl);
};

function fakeUpstreamTokenExchange(
  authorizationCode: string,
): Promise<{ access_token: string; refresh_token: string }> {
  // just return the authorization code with a suffix
  return new Promise((resolve) => {
    resolve({
      access_token: `${authorizationCode}-exchanged-for-access-token`,
      refresh_token: `${authorizationCode}-exchanged-for-refresh-token`,
    });
  });
}