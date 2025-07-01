import { createClient, SetOptions } from "@redis/client";

/**
 * Describes the Redis primitives we use in this application, to be able to mock
 * them in tests (so we don't need to actually hit Redis).
 */
export interface RedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: SetOptions): Promise<string | null>;
  setEx(key: string, seconds: number, value: string): Promise<string | null>;
  del(key: string | string[]): Promise<number>;
  keys(pattern: string): Promise<string[]>;
  getDel(key: string): Promise<string | null>;
  connect(): Promise<void>;
  on(event: string, callback: (error: Error) => void): void;
  options?: { url: string };

  /**
   * Creates a pub/sub subscription. Returns a cleanup function to unsubscribe.
   * Handles Redis client duplication and error handling internally.
   */
  createSubscription(
    channel: string,
    onMessage: (message: string) => void,
    onError: (error: Error) => void,
  ): Promise<() => Promise<void>>;

  /**
   * Publishes a message to a channel.
   */
  publish(channel: string, message: string): Promise<void>;
}

export class RedisClientImpl implements RedisClient {
  private redis = createClient({
    url: process.env.REDIS_URL || "redis://localhost:6379",
    password: process.env.REDIS_PASSWORD,
    socket: {
      tls: process.env.REDIS_TLS === "1",
      ca: process.env.REDIS_TLS_CA,
    }
  });

  constructor() {
    this.redis.on("error", (error) =>
      console.error("Redis client error:", error),
    );
  }

  async get(key: string): Promise<string | null> {
    return await this.redis.get(key);
  }

  async getDel(key: string): Promise<string | null> {
    return await this.redis.getDel(key);
  }

  async set(key: string, value: string, options?: SetOptions): Promise<string | null> {
    return await this.redis.set(
      key,
      value,
      options,
    );
  }

  async setEx(key: string, seconds: number, value: string): Promise<string | null> {
    return await this.redis.setEx(key, seconds, value);
  }

  async del(key: string | string[]): Promise<number> {
    return await this.redis.del(key);
  }

  async keys(pattern: string): Promise<string[]> {
    return await this.redis.keys(pattern);
  }

  async connect(): Promise<void> {
    await this.redis.connect();
  }

  on(event: string, callback: (error: Error) => void): void {
    this.redis.on(event, callback);
  }

  get options() {
    return { url: process.env.REDIS_URL || "redis://localhost:6379" };
  }

  async createSubscription(
    channel: string,
    onMessage: (message: string) => void,
    onError: (error: Error) => void,
  ): Promise<() => Promise<void>> {
    const subscriber = this.redis.duplicate();
    subscriber.on("error", onError);
    await subscriber.connect();
    await subscriber.subscribe(channel, onMessage);

    return async () => {
      await subscriber.disconnect();
    };
  }

  async publish(channel: string, message: string): Promise<void> {
    await this.redis.publish(channel, message);
  }
}

// Export a mutable reference that can be swapped in tests
export let redisClient: RedisClient = new RedisClientImpl();

// Function to replace the Redis client (used in tests)
export function setRedisClient(client: RedisClient) {
  redisClient = client;
}

export class MockRedisClient implements RedisClient {
  options = { url: "redis://localhost:6379" };
  private store = new Map<string, string>();
  private subscribers = new Map<string, ((message: string) => void)[]>();
  private errorCallbacks = new Map<string, ((error: Error) => void)[]>();

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async getDel(key: string): Promise<string | null> {
    const value = this.store.get(key) ?? null;
    this.store.delete(key);
    return value;
  }

  async set(key: string, value: string, options?: SetOptions): Promise<string | null> {
    let oldValue: string | null = null;
    if (options?.GET) {
      oldValue = this.store.get(key) ?? null;
    }
    this.store.set(key, value);
    return oldValue;
  }

  async setEx(key: string, seconds: number, value: string): Promise<string | null> {
    this.store.set(key, value);
    // Mock doesn't handle expiration
    return null;
  }

  async del(key: string | string[]): Promise<number> {
    const keys = Array.isArray(key) ? key : [key];
    let deleted = 0;
    for (const k of keys) {
      if (this.store.delete(k)) {
        deleted++;
      }
    }
    return deleted;
  }

  async keys(pattern: string): Promise<string[]> {
    // Simple pattern matching for mock (only supports * at end)
    const allKeys = Array.from(this.store.keys());
    if (pattern.endsWith('*')) {
      const prefix = pattern.slice(0, -1);
      return allKeys.filter(k => k.startsWith(prefix));
    }
    return allKeys.filter(k => k === pattern);
  }

  async connect(): Promise<void> {
    // No-op in mock
  }

  on(event: string, callback: (error: Error) => void): void {
    if (event === "error") {
      const callbacks = this.errorCallbacks.get("global") ?? [];
      callbacks.push(callback);
      this.errorCallbacks.set("global", callbacks);
    }
  }

  async createSubscription(
    channel: string,
    onMessage: (message: string) => void,
    onError: (error: Error) => void,
  ): Promise<() => Promise<void>> {
    const callbacks = this.subscribers.get(channel) ?? [];
    callbacks.push(onMessage);
    this.subscribers.set(channel, callbacks);

    const errorCallbacks = this.errorCallbacks.get(channel) ?? [];
    errorCallbacks.push(onError);
    this.errorCallbacks.set(channel, errorCallbacks);

    return async () => {
      const callbacks = this.subscribers.get(channel) ?? [];
      const index = callbacks.indexOf(onMessage);
      if (index !== -1) {
        callbacks.splice(index, 1);
      }
      this.subscribers.set(channel, callbacks);

      if (onError) {
        const errorCallbacks = this.errorCallbacks.get(channel) ?? [];
        const errorIndex = errorCallbacks.indexOf(onError);
        if (errorIndex !== -1) {
          errorCallbacks.splice(errorIndex, 1);
        }
        this.errorCallbacks.set(channel, errorCallbacks);
      }
    };
  }

  async publish(channel: string, message: string): Promise<void> {
    const callbacks = this.subscribers.get(channel) ?? [];
    for (const callback of callbacks) {
      try {
        callback(message);
      } catch (error) {
        const errorCallbacks = this.errorCallbacks.get(channel) ?? [];
        for (const errorCallback of errorCallbacks) {
          errorCallback(error as Error);
        }
      }
    }
  }

  clear() {
    this.store.clear();
    this.subscribers.clear();
    this.errorCallbacks.clear();
  }

  // Helper method for tests to simulate Redis errors
  simulateError(error: Error, channel?: string): void {
    if (channel) {
      const callbacks = this.errorCallbacks.get(channel) ?? [];
      for (const callback of callbacks) {
        callback(error);
      }
    } else {
      const callbacks = this.errorCallbacks.get("global") ?? [];
      for (const callback of callbacks) {
        callback(error);
      }
    }
  }
}
