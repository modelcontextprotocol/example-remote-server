import { AsyncLocalStorage } from "async_hooks";
import { FakeUpstreamInstallation } from "./types.js";

interface RequestContext {
  mcpAccessToken: string;
  fakeUpstreamInstallation: FakeUpstreamInstallation;
}

export const asyncLocalStorage = new AsyncLocalStorage<RequestContext>();

export function getFakeUpstreamInstallation(): FakeUpstreamInstallation {
  const context = asyncLocalStorage.getStore();
  if (!context) {
    throw new Error(
      "No request context found - are you calling this from within a request handler?",
    );
  }
  return context.fakeUpstreamInstallation;
}

export function getMcpAccessToken(): string {
  const context = asyncLocalStorage.getStore();
  if (!context) {
    throw new Error(
      "No request context found - are you calling this from within a request handler?",
    );
  }
  return context.mcpAccessToken;
}

export function withContext<T>(
  context: RequestContext,
  fn: () => T | Promise<T>,
): T | Promise<T> {
  return asyncLocalStorage.run(context, fn);
}
