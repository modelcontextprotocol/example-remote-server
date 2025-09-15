import { Request, Response } from "express";
import { generateMcpTokens, readPendingAuthorization, saveMcpInstallation, saveRefreshToken, saveTokenExchange } from "../services/auth.js";
import { McpInstallation } from "../types.js";
import { logger } from "../utils/logger.js";

// this module has a fake upstream auth server that returns a fake auth code, it also allows you to authorize or fail 
// authorization, to test the different flows

// TODO: make an implementation of this using the ProxyAuthProvider

// This is mocking an upstream auth server. This wouldn't normally be in the same server as the MCP auth server
export async function handleFakeAuthorize(req: Request, res: Response) {
  // get the redirect_uri and state from the query params
  const { redirect_uri, state } = req.query;

  // Set a more permissive CSP for auth pages to allow inline styles and scripts
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "style-src 'self' 'unsafe-inline'",    // Allow inline styles for auth page styling
    "script-src 'self' 'unsafe-inline'",   // Allow inline scripts for auth page functionality
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "base-uri 'self'"
  ].join('; '));

  res.send(`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Upstream Provider Authentication</title>
        <style>
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
          }
          
          .auth-container {
            background: white;
            border-radius: 16px;
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.1);
            padding: 40px;
            max-width: 480px;
            width: 100%;
            text-align: center;
          }
          
          .logo {
            width: 64px;
            height: 64px;
            background: linear-gradient(135deg, #667eea, #764ba2);
            border-radius: 16px;
            margin: 0 auto 24px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 24px;
            font-weight: bold;
            color: white;
          }
          
          h1 {
            color: #1a202c;
            font-size: 28px;
            font-weight: 700;
            margin-bottom: 8px;
          }
          
          .subtitle {
            color: #718096;
            font-size: 16px;
            margin-bottom: 32px;
          }
          
          .user-section {
            background: #f7fafc;
            border-radius: 12px;
            padding: 24px;
            margin-bottom: 32px;
            border: 2px solid #e2e8f0;
          }
          
          .user-section h3 {
            color: #2d3748;
            font-size: 18px;
            font-weight: 600;
            margin-bottom: 16px;
          }
          
          .user-id-display {
            background: white;
            border: 2px solid #e2e8f0;
            border-radius: 8px;
            padding: 12px;
            font-family: 'Courier New', monospace;
            font-size: 14px;
            color: #4a5568;
            margin-bottom: 16px;
            word-break: break-all;
          }
          
          .user-actions {
            display: flex;
            gap: 12px;
            flex-wrap: wrap;
          }
          
          .btn {
            flex: 1;
            min-width: 120px;
            padding: 12px 24px;
            border: none;
            border-radius: 8px;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s ease;
            text-decoration: none;
            display: inline-flex;
            align-items: center;
            justify-content: center;
          }
          
          .btn-secondary {
            background: #e2e8f0;
            color: #4a5568;
          }
          
          .btn-secondary:hover {
            background: #cbd5e0;
          }
          
          .btn-primary {
            background: linear-gradient(135deg, #4299e1, #3182ce);
            color: white;
            font-size: 16px;
            padding: 16px 32px;
            margin-top: 16px;
            width: 100%;
          }
          
          .btn-primary:hover {
            background: linear-gradient(135deg, #3182ce, #2c5282);
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(66, 153, 225, 0.3);
          }
          
          .help-text {
            color: #718096;
            font-size: 14px;
            margin-top: 24px;
            line-height: 1.5;
          }
          
          .help-text strong {
            color: #4a5568;
          }
        </style>
      </head>
      <body>
        <div class="auth-container">
          <div class="logo">🔒</div>
          <h1>Upstream Authentication</h1>
          <p class="subtitle">Please verify your identity with the upstream provider</p>
          
          <div class="user-section">
            <h3>Your User Identity</h3>
            <div class="user-id-display" id="userIdDisplay">Loading...</div>
            <div class="user-actions">
              <button class="btn btn-secondary" onclick="generateNewUserId()">Generate New ID</button>
              <button class="btn btn-secondary" onclick="editUserId()">Edit ID</button>
            </div>
          </div>
          
          <button class="btn btn-primary" onclick="authorize()">
            Complete Authentication
          </button>
          
          <div class="help-text">
            <strong>Testing Multiple Users:</strong> Open this page in different browser windows or incognito tabs to simulate different users. Each will have their own unique User ID and separate MCP sessions.
          </div>
        </div>
        
        <script>
          // Generate UUID v4
          function generateUUID() {
            return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
              var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
              return v.toString(16);
            });
          }
          
          // Get or create user ID
          function getUserId() {
            let userId = localStorage.getItem('mcpUserId');
            if (!userId) {
              userId = generateUUID();
              localStorage.setItem('mcpUserId', userId);
            }
            return userId;
          }
          
          // Update the display
          function updateDisplay() {
            const userId = getUserId();
            document.getElementById('userIdDisplay').textContent = userId;
          }
          
          // Generate new user ID
          function generateNewUserId() {
            const newId = generateUUID();
            localStorage.setItem('mcpUserId', newId);
            updateDisplay();
          }
          
          // Edit user ID
          function editUserId() {
            const currentId = getUserId();
            const newId = prompt('Enter new User ID:', currentId);
            if (newId && newId.trim()) {
              localStorage.setItem('mcpUserId', newId.trim());
              updateDisplay();
            }
          }
          
          // Authorize with current user ID
          function authorize() {
            const userId = getUserId();
            // Handle relative URLs by making them absolute
            const redirectUri = '${redirect_uri}';
            const baseUrl = redirectUri.startsWith('http') ? redirectUri : window.location.origin + redirectUri;
            const url = new URL(baseUrl);
            url.searchParams.set('state', '${state}');
            url.searchParams.set('code', 'fakecode');
            url.searchParams.set('userId', userId);
            window.location.href = url.toString();
          }
          
          // Initialize on page load
          updateDisplay();
        </script>
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
    userId, // User ID from the authorization flow
  } = req.query;

  logger.debug('Fake auth redirect received', {
    mcpAuthorizationCode: typeof mcpAuthorizationCode === 'string' ? mcpAuthorizationCode.substring(0, 8) + '...' : mcpAuthorizationCode,
    upstreamAuthorizationCode: typeof upstreamAuthorizationCode === 'string' ? upstreamAuthorizationCode.substring(0, 8) + '...' : upstreamAuthorizationCode,
    userId
  });

  // This is where you'd exchange the upstreamAuthorizationCode for access/refresh tokens
  // In this case, we're just going to fake it
  const upstreamTokens = await fakeUpstreamTokenExchange(upstreamAuthorizationCode as string);

  // Validate that it's a string
  if (typeof mcpAuthorizationCode !== "string") {
    throw new Error("Invalid authorization code");
  }

  const pendingAuth = await readPendingAuthorization(mcpAuthorizationCode);
  logger.debug('Reading pending authorization', {
    mcpAuthorizationCode: mcpAuthorizationCode.substring(0, 8) + '...',
    found: !!pendingAuth
  });

  if (!pendingAuth) {
    throw new Error("No matching authorization found");
  }

  logger.debug('Generating MCP tokens');
  const mcpTokens = generateMcpTokens();
  logger.debug('MCP tokens generated', {
    hasAccessToken: !!mcpTokens.access_token,
    hasRefreshToken: !!mcpTokens.refresh_token
  });

  const mcpInstallation: McpInstallation = {
    fakeUpstreamInstallation: {
      fakeAccessTokenForDemonstration: upstreamTokens.access_token,
      fakeRefreshTokenForDemonstration: upstreamTokens.refresh_token,
    },
    mcpTokens,
    clientId: pendingAuth.clientId,
    issuedAt: Date.now() / 1000,
    userId: (userId as string) || 'anonymous-user', // Include user ID from auth flow
  }

  logger.debug('Saving MCP installation');
  // Store the upstream authorization data
  await saveMcpInstallation(mcpTokens.access_token, mcpInstallation);
  logger.debug('MCP installation saved');

  // Store the refresh token -> access token mapping
  if (mcpTokens.refresh_token) {
    logger.debug('Saving refresh token mapping');
    await saveRefreshToken(mcpTokens.refresh_token, mcpTokens.access_token);
    logger.debug('Refresh token mapping saved');
  }

  logger.debug('Saving token exchange data');
  // Store the token exchange data
  await saveTokenExchange(mcpAuthorizationCode, {
    mcpAccessToken: mcpTokens.access_token,
    alreadyUsed: false,
  });
  logger.debug('Token exchange data saved');

  // Redirect back to the original application with the authorization code and state
  const redirectUrl = pendingAuth.state ?
    `${pendingAuth.redirectUri}?code=${mcpAuthorizationCode}&state=${pendingAuth.state}` :
    `${pendingAuth.redirectUri}?code=${mcpAuthorizationCode}`;

  logger.debug('Redirecting to callback', {
    redirectUrl,
    hasState: !!pendingAuth.state
  });
  res.redirect(redirectUrl);
  logger.debug('Redirect completed');
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