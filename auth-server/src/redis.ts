import { createClient, SetOptions } from "@redis/client";
import { logger } from "./utils/logger.js";
import { REDIS_URL } from "./config.js";

/**
 * Describes the Redis primitives we use in this application, to be able to mock
 * them in tests (so we don't need to actually hit Redis).
 */
export interface RedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: SetOptions): Promise<string | null>;
  getDel(key: string): Promise<string | null>;
  del(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<boolean>;
  lpush(key: string, ...values: string[]): Promise<number>;
  lrange(key: string, start: number, stop: number): Promise<string[]>;
  connect(): Promise<void>;
  on(event: string, callback: (error: Error) => void): void;
  options?: { url: string };
  exists(key: string): Promise<boolean>;
  numsub(key: string): Promise<number>;

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
    url: REDIS_URL,
    password: process.env.REDIS_PASSWORD,
    socket: {
      tls: process.env.REDIS_TLS === "1",
      ca: process.env.REDIS_TLS_CA,
    }
  });

  constructor() {
    this.redis.on("error", (error) =>
      logger.error("Redis client error", error as Error),
    );
  }

  async numsub(key: string): Promise<number> {
    const subs = await this.redis.pubSubNumSub(key);
    return subs[key] || 0;
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

  async del(key: string): Promise<number> {
    return await this.redis.del(key);
  }

  async expire(key: string, seconds: number): Promise<boolean> {
    return await this.redis.expire(key, seconds);
  }

  async lpush(key: string, ...values: string[]): Promise<number> {
    return await this.redis.lPush(key, values);
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    return await this.redis.lRange(key, start, stop);
  }

  async connect(): Promise<void> {
    await this.redis.connect();
  }

  on(event: string, callback: (error: Error) => void): void {
    this.redis.on(event, callback);
  }

  get options() {
    return { url: REDIS_URL };
  }

  async createSubscription(
    channel: string,
    onMessage: (message: string) => void,
    onError: (error: Error) => void,
  ): Promise<() => Promise<void>> {
    const subscriber = this.redis.duplicate();
    subscriber.on("error", (error) => {
      onError(error);
    });
    
    await subscriber.connect();
    
    await subscriber.subscribe(channel, (message) => {
      onMessage(message);
    });

    return async () => {
      await subscriber.disconnect();
    };
  }

  async publish(channel: string, message: string): Promise<void> {
    await this.redis.publish(channel, message);
  }

  async exists(key: string): Promise<boolean> {
    const result = await this.redis.exists(key);
    return result > 0;
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
  private lists = new Map<string, string[]>();
  public subscribers = new Map<string, ((message: string) => void)[]>(); // Public for testing access
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

  async del(key: string): Promise<number> {
    let deleted = 0;
    if (this.store.has(key)) {
      this.store.delete(key);
      deleted++;
    }
    if (this.lists.has(key)) {
      this.lists.delete(key);
      deleted++;
    }
    return deleted;
  }

  async expire(key: string, _seconds: number): Promise<boolean> {
    // Mock implementation - just return true if key exists
    return this.store.has(key) || this.lists.has(key);
  }

  async lpush(key: string, ...values: string[]): Promise<number> {
    const list = this.lists.get(key) || [];
    list.unshift(...values);
    this.lists.set(key, list);
    return list.length;
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    const list = this.lists.get(key) || [];
    if (stop === -1) {
      return list.slice(start);
    }
    return list.slice(start, stop + 1);
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

  async exists(key: string): Promise<boolean> {
    return this.store.has(key) || this.lists.has(key);
  }

  async numsub(key: string): Promise<number> {
    return (this.subscribers.get(key) || []).length;
  }

  clear() {
    this.store.clear();
    this.lists.clear();
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
