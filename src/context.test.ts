import { describe, test, expect } from '@jest/globals';
import { getFakeUpstreamInstallation, getMcpAccessToken, withContext } from "./context.js";
import { generateToken } from "./services/auth.js";

describe("context", () => {
  const mockContext = {
    mcpAccessToken: generateToken(),
    fakeUpstreamInstallation: {
      fakeAccessTokenForDemonstration: "fake-upstream-access-token",
      fakeRefreshTokenForDemonstration: "fake-upstream-refresh-token",
    },
  };

  test("getFakeUpstreamInstallation throws when called outside context", () => {
    expect(() => getFakeUpstreamInstallation()).toThrow(
      "No request context found - are you calling this from within a request handler?"
    );
  });

  test("getMcpAccessToken throws when called outside context", () => {
    expect(() => getMcpAccessToken()).toThrow(
      "No request context found - are you calling this from within a request handler?"
    );
  });

  test("context functions return data within context", async () => {
    await withContext(mockContext, () => {
      const upstreamInstall = getFakeUpstreamInstallation();
      expect(upstreamInstall).toEqual(mockContext.fakeUpstreamInstallation);

      const mcpToken = getMcpAccessToken();
      expect(mcpToken).toEqual(mockContext.mcpAccessToken);
    });
  });

  test("nested contexts maintain isolation", async () => {
    const context1 = {
      mcpAccessToken: generateToken(),
      fakeUpstreamInstallation: {
        fakeAccessTokenForDemonstration: "fake-upstream-access-token",
        fakeRefreshTokenForDemonstration: "fake-upstream-refresh-token",
      },
    };
    const context2 = {
      mcpAccessToken: generateToken(),
      fakeUpstreamInstallation: {
        fakeAccessTokenForDemonstration: "fake-upstream-access-token",
        fakeRefreshTokenForDemonstration: "fake-upstream-refresh-token",
      },
    };

    await withContext(context1, async () => {
      expect(getFakeUpstreamInstallation()).toEqual(context1.fakeUpstreamInstallation);
      expect(getMcpAccessToken()).toEqual(context1.mcpAccessToken);

      await withContext(context2, () => {
        expect(getFakeUpstreamInstallation()).toEqual(context2.fakeUpstreamInstallation);
        expect(getMcpAccessToken()).toEqual(context2.mcpAccessToken);
      });

      // Outer context should be preserved
      expect(getFakeUpstreamInstallation()).toEqual(context1.fakeUpstreamInstallation);
      expect(getMcpAccessToken()).toEqual(context1.mcpAccessToken);
    });
  });

  test("concurrent contexts maintain isolation", async () => {
    const context1 = {
      mcpAccessToken: generateToken(),
      fakeUpstreamInstallation: {
        fakeAccessTokenForDemonstration: "fake-upstream-access-token",
        fakeRefreshTokenForDemonstration: "fake-upstream-refresh-token",
      },
    };
    const context2 = {
      mcpAccessToken: generateToken(),
      fakeUpstreamInstallation: {
        fakeAccessTokenForDemonstration: "fake-upstream-access-token",
        fakeRefreshTokenForDemonstration: "fake-upstream-refresh-token",
      },
    };

    // Run two contexts concurrently
    await Promise.all([
      withContext(context1, async () => {
        // Simulate async work
        await new Promise(resolve => setTimeout(resolve, 10));
        expect(getFakeUpstreamInstallation()).toEqual(context1.fakeUpstreamInstallation);
        expect(getMcpAccessToken()).toEqual(context1.mcpAccessToken);
      }),
      withContext(context2, async () => {
        // Simulate async work
        await new Promise(resolve => setTimeout(resolve, 5));
        expect(getFakeUpstreamInstallation()).toEqual(context2.fakeUpstreamInstallation);
        expect(getMcpAccessToken()).toEqual(context2.mcpAccessToken);
      }),
    ]);
  });

  test("context is preserved across async operations", async () => {
    await withContext(mockContext, async () => {
      const initialUpstreamInstall = getFakeUpstreamInstallation();
      const initialMcpToken = getMcpAccessToken();
      
      // Simulate async work
      await new Promise(resolve => setTimeout(resolve, 10));
      
      const afterUpstreamInstall = getFakeUpstreamInstallation();
      const afterMcpToken = getMcpAccessToken();
      expect(afterUpstreamInstall).toEqual(initialUpstreamInstall);
      expect(afterMcpToken).toEqual(initialMcpToken);
    });
  });
});