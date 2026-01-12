# Distributed MCP Server Library Design Document

## Executive Summary

This document outlines the design for transforming the MCP Feature Reference Server into a portable, cloud-agnostic library that enables developers to create distributed MCP servers in just a few lines of code.

**Goals:**
1. Create a simple, intuitive API for building distributed MCP servers
2. Abstract transport mechanisms to support multiple cloud providers
3. Abstract storage backends for session and auth state
4. Maintain security features (OAuth 2.0, PKCE, session isolation)
5. Enable horizontal scaling across multiple instances

---

## Table of Contents

1. [Current Architecture Analysis](#1-current-architecture-analysis)
2. [Target API Design](#2-target-api-design)
3. [Core Abstractions](#3-core-abstractions)
4. [Transport Layer Design](#4-transport-layer-design)
5. [Storage Layer Design](#5-storage-layer-design)
6. [Authentication Layer Design](#6-authentication-layer-design)
7. [Cloud Provider Implementations](#7-cloud-provider-implementations)
8. [Package Structure](#8-package-structure)
9. [Migration Path](#9-migration-path)
10. [Performance Considerations](#10-performance-considerations)
11. [Security Considerations](#11-security-considerations)
12. [Implementation Roadmap](#12-implementation-roadmap)

---

## 1. Current Architecture Analysis

### 1.1 Existing Components

| Component | Current Implementation | Coupling Level |
|-----------|----------------------|----------------|
| Transport | Redis Pub/Sub only | **Tight** |
| Session Storage | Redis + In-Memory | **Moderate** |
| Auth Storage | Redis + In-Memory | **Moderate** |
| Auth Provider | Internal OAuth server | **Moderate** |
| HTTP Framework | Express.js | **Tight** |
| MCP Protocol | @modelcontextprotocol/sdk | **Required** |

### 1.2 Pain Points for Library Users

1. **Redis Dependency**: Must run Redis even for simple deployments
2. **No Transport Alternatives**: Can't use native cloud messaging (SQS, Pub/Sub, etc.)
3. **Express Coupling**: Hard to integrate with other frameworks (Fastify, Hono, etc.)
4. **Monolithic Structure**: Can't pick and choose components
5. **Configuration Complexity**: Many environment variables to configure

### 1.3 What Works Well (Keep These)

1. Clean auth/MCP separation via `ITokenValidator` interface
2. Session ownership model for security
3. Streamable HTTP transport protocol
4. Structured logging approach
5. PKCE + OAuth 2.0 implementation

---

## 2. Target API Design

### 2.1 Simple "Hello World" (5 Lines)

```typescript
import { createMcpServer } from '@mcp/distributed-server';

const server = createMcpServer({
  name: 'my-server',
  version: '1.0.0',
});

server.tool('greet', { name: 'string' }, async ({ name }) => {
  return { content: [{ type: 'text', text: `Hello, ${name}!` }] };
});

server.listen(3000);
```

### 2.2 Distributed Server (10 Lines)

```typescript
import { createMcpServer } from '@mcp/distributed-server';
import { RedisTransport } from '@mcp/transport-redis';

const server = createMcpServer({
  name: 'distributed-server',
  version: '1.0.0',
  transport: new RedisTransport({ url: process.env.REDIS_URL }),
});

server.tool('greet', { name: 'string' }, async ({ name }) => {
  return { content: [{ type: 'text', text: `Hello, ${name}!` }] };
});

server.listen(3000);
```

### 2.3 Full Production Setup

```typescript
import { createMcpServer } from '@mcp/distributed-server';
import { SQSTransport } from '@mcp/transport-aws';
import { DynamoDBStorage } from '@mcp/storage-aws';
import { CognitoAuth } from '@mcp/auth-aws';

const server = createMcpServer({
  name: 'production-server',
  version: '1.0.0',

  // Cloud-native transport
  transport: new SQSTransport({
    region: 'us-east-1',
    queuePrefix: 'mcp-',
  }),

  // Cloud-native storage
  storage: new DynamoDBStorage({
    tableName: 'mcp-sessions',
    region: 'us-east-1',
  }),

  // Cloud-native auth
  auth: new CognitoAuth({
    userPoolId: process.env.COGNITO_POOL_ID,
    clientId: process.env.COGNITO_CLIENT_ID,
  }),

  // Optional: Custom HTTP framework adapter
  adapter: 'express', // or 'fastify', 'hono', 'node-http'
});

// Register tools, resources, prompts...
server.tool('query-database', schema, handler);
server.resource('users/{id}', handler);
server.prompt('summarize', handler);

server.listen(3000);
```

### 2.4 Serverless Deployment (AWS Lambda)

```typescript
import { createMcpHandler } from '@mcp/distributed-server/serverless';
import { SQSTransport } from '@mcp/transport-aws';
import { DynamoDBStorage } from '@mcp/storage-aws';

const handler = createMcpHandler({
  name: 'serverless-mcp',
  version: '1.0.0',
  transport: new SQSTransport({ /* ... */ }),
  storage: new DynamoDBStorage({ /* ... */ }),
  tools: {
    greet: {
      schema: { name: 'string' },
      handler: async ({ name }) => ({
        content: [{ type: 'text', text: `Hello, ${name}!` }]
      }),
    },
  },
});

export { handler };
```

---

## 3. Core Abstractions

### 3.1 Interface Hierarchy

```
┌─────────────────────────────────────────────────────────────────┐
│                        McpServer                                 │
│  (Main entry point - orchestrates all components)               │
└─────────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│  ITransport   │    │   IStorage    │    │    IAuth      │
│  (messaging)  │    │  (state)      │    │ (identity)    │
└───────────────┘    └───────────────┘    └───────────────┘
        │                     │                     │
        ▼                     ▼                     ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│ Implementations│   │ Implementations│   │ Implementations│
│ - Redis       │    │ - Redis       │    │ - Internal    │
│ - SQS/SNS     │    │ - DynamoDB    │    │ - Cognito     │
│ - Pub/Sub     │    │ - Firestore   │    │ - Auth0       │
│ - Service Bus │    │ - CosmosDB    │    │ - Okta        │
│ - Kafka       │    │ - Memory      │    │ - Azure AD    │
│ - Memory      │    │ - PostgreSQL  │    │ - Custom      │
└───────────────┘    └───────────────┘    └───────────────┘
```

### 3.2 Core Interfaces

```typescript
// ============================================
// Transport Interface
// ============================================

interface ITransport {
  /**
   * Unique identifier for this transport type
   */
  readonly type: string;

  /**
   * Initialize the transport (connect to messaging system)
   */
  connect(): Promise<void>;

  /**
   * Clean shutdown
   */
  disconnect(): Promise<void>;

  /**
   * Subscribe to messages for a session
   */
  subscribe(
    sessionId: string,
    handler: MessageHandler
  ): Promise<Subscription>;

  /**
   * Publish a message to a session
   */
  publish(
    sessionId: string,
    message: McpMessage,
    options?: PublishOptions
  ): Promise<void>;

  /**
   * Check if a session has active subscribers
   */
  hasActiveSubscribers(sessionId: string): Promise<boolean>;

  /**
   * Send control message (shutdown, ping, etc.)
   */
  sendControl(
    sessionId: string,
    control: ControlMessage
  ): Promise<void>;
}

interface MessageHandler {
  (message: McpMessage): Promise<void>;
}

interface Subscription {
  unsubscribe(): Promise<void>;
  readonly isActive: boolean;
}

interface PublishOptions {
  /** Message ID for request/response correlation */
  messageId?: string;
  /** Message priority (if supported by transport) */
  priority?: 'low' | 'normal' | 'high';
  /** Time-to-live in milliseconds */
  ttl?: number;
}

// ============================================
// Storage Interface
// ============================================

interface IStorage {
  /**
   * Unique identifier for this storage type
   */
  readonly type: string;

  /**
   * Initialize storage connection
   */
  connect(): Promise<void>;

  /**
   * Clean shutdown
   */
  disconnect(): Promise<void>;

  // Key-Value Operations
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, options?: SetOptions): Promise<void>;
  delete(key: string): Promise<boolean>;
  exists(key: string): Promise<boolean>;

  // Session-specific operations
  sessions: ISessionStorage;

  // Auth-specific operations (optional)
  auth?: IAuthStorage;
}

interface SetOptions {
  /** Time-to-live in seconds */
  ttl?: number;
  /** Only set if key doesn't exist */
  nx?: boolean;
  /** Only set if key exists */
  xx?: boolean;
}

interface ISessionStorage {
  create(session: Session): Promise<void>;
  get(sessionId: string): Promise<Session | null>;
  update(sessionId: string, updates: Partial<Session>): Promise<void>;
  delete(sessionId: string): Promise<void>;
  setOwner(sessionId: string, userId: string): Promise<void>;
  getOwner(sessionId: string): Promise<string | null>;
  touch(sessionId: string): Promise<void>; // Update last activity
  listByUser(userId: string): Promise<Session[]>;
}

interface IAuthStorage {
  // Client registration
  saveClient(client: OAuthClient): Promise<void>;
  getClient(clientId: string): Promise<OAuthClient | null>;

  // Authorization codes
  saveAuthCode(code: AuthorizationCode): Promise<void>;
  getAuthCode(code: string): Promise<AuthorizationCode | null>;
  deleteAuthCode(code: string): Promise<void>;

  // Tokens
  saveToken(token: TokenRecord): Promise<void>;
  getToken(accessToken: string): Promise<TokenRecord | null>;
  revokeToken(accessToken: string): Promise<void>;

  // Refresh tokens
  saveRefreshToken(token: RefreshTokenRecord): Promise<void>;
  getByRefreshToken(refreshToken: string): Promise<TokenRecord | null>;
  revokeRefreshToken(refreshToken: string): Promise<void>;
}

// ============================================
// Auth Interface
// ============================================

interface IAuth {
  /**
   * Unique identifier for this auth provider
   */
  readonly type: string;

  /**
   * Get OAuth metadata for discovery
   */
  getMetadata(): Promise<OAuthMetadata>;

  /**
   * Validate an access token and return user info
   */
  validateToken(token: string): Promise<AuthInfo | null>;

  /**
   * Introspect a token (RFC 7662)
   */
  introspect(token: string): Promise<TokenIntrospectionResponse>;

  /**
   * Optional: Handle authorization flow
   * (Not needed for external providers like Auth0)
   */
  handleAuthorization?(req: AuthRequest): Promise<AuthResponse>;

  /**
   * Optional: Handle token exchange
   */
  handleTokenExchange?(req: TokenRequest): Promise<TokenResponse>;

  /**
   * Optional: Get Express/HTTP routes for OAuth endpoints
   */
  getRoutes?(): Router | RequestHandler[];
}

interface AuthInfo {
  userId: string;
  scopes: string[];
  clientId: string;
  expiresAt?: Date;
  metadata?: Record<string, unknown>;
}
```

---

## 4. Transport Layer Design

### 4.1 Transport Comparison Matrix

| Transport | Latency | Throughput | Ordering | Persistence | Cost Model |
|-----------|---------|------------|----------|-------------|------------|
| **In-Memory** | <1ms | Very High | Guaranteed | None | Free |
| **Redis Pub/Sub** | 1-5ms | High | Per-channel | None | Per-hour |
| **Redis Streams** | 1-5ms | High | Guaranteed | Yes | Per-hour |
| **AWS SQS** | 10-50ms | High | FIFO available | Yes | Per-request |
| **AWS SNS + SQS** | 20-100ms | Very High | No | Yes | Per-request |
| **Google Pub/Sub** | 10-50ms | Very High | Ordering keys | Yes | Per-request |
| **Azure Service Bus** | 10-50ms | High | Sessions | Yes | Per-operation |
| **Apache Kafka** | 5-20ms | Extreme | Per-partition | Yes | Self-hosted |
| **NATS** | 1-5ms | Very High | Per-subject | Optional | Self-hosted |
| **RabbitMQ** | 5-15ms | High | Per-queue | Yes | Self-hosted |

### 4.2 Redis Transport (Current - Refactored)

```typescript
import { ITransport, Subscription, McpMessage } from '@mcp/distributed-server';
import { createClient, RedisClientType } from 'redis';

export interface RedisTransportOptions {
  url?: string;
  host?: string;
  port?: number;
  password?: string;
  tls?: boolean;
  keyPrefix?: string;

  /** Use Redis Streams instead of Pub/Sub for persistence */
  useStreams?: boolean;

  /** Stream retention period (if using streams) */
  streamRetention?: number;
}

export class RedisTransport implements ITransport {
  readonly type = 'redis';

  private client: RedisClientType;
  private subscriber: RedisClientType;
  private readonly keyPrefix: string;
  private readonly useStreams: boolean;

  constructor(options: RedisTransportOptions = {}) {
    this.keyPrefix = options.keyPrefix ?? 'mcp:';
    this.useStreams = options.useStreams ?? false;
    // ... initialization
  }

  async connect(): Promise<void> {
    await this.client.connect();
    this.subscriber = this.client.duplicate();
    await this.subscriber.connect();
  }

  async disconnect(): Promise<void> {
    await this.subscriber.quit();
    await this.client.quit();
  }

  async subscribe(
    sessionId: string,
    handler: MessageHandler
  ): Promise<Subscription> {
    const channel = this.getChannel('toserver', sessionId);

    if (this.useStreams) {
      return this.subscribeStream(channel, handler);
    }

    await this.subscriber.subscribe(channel, async (message) => {
      const parsed = JSON.parse(message) as McpMessage;
      await handler(parsed);
    });

    return {
      isActive: true,
      unsubscribe: async () => {
        await this.subscriber.unsubscribe(channel);
      },
    };
  }

  async publish(
    sessionId: string,
    message: McpMessage,
    options?: PublishOptions
  ): Promise<void> {
    const channel = options?.messageId
      ? this.getChannel('toclient', sessionId, options.messageId)
      : this.getChannel('toclient', sessionId);

    if (this.useStreams) {
      await this.client.xAdd(channel, '*', {
        data: JSON.stringify(message),
      });
    } else {
      await this.client.publish(channel, JSON.stringify(message));
    }
  }

  async hasActiveSubscribers(sessionId: string): Promise<boolean> {
    const channel = this.getChannel('toserver', sessionId);
    const result = await this.client.pubSubNumSub(channel);
    return (result[channel] ?? 0) > 0;
  }

  async sendControl(
    sessionId: string,
    control: ControlMessage
  ): Promise<void> {
    const channel = this.getChannel('control', sessionId);
    await this.client.publish(channel, JSON.stringify(control));
  }

  private getChannel(
    type: 'toserver' | 'toclient' | 'control',
    sessionId: string,
    messageId?: string
  ): string {
    const base = `${this.keyPrefix}${type}:${sessionId}`;
    return messageId ? `${base}:${messageId}` : base;
  }
}
```

### 4.3 AWS SQS/SNS Transport

```typescript
import {
  SQSClient,
  SendMessageCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  CreateQueueCommand,
  GetQueueUrlCommand,
} from '@aws-sdk/client-sqs';
import {
  SNSClient,
  PublishCommand,
  SubscribeCommand,
} from '@aws-sdk/client-sns';

export interface SQSTransportOptions {
  region: string;
  queuePrefix?: string;

  /** Use FIFO queues for ordering guarantees */
  fifo?: boolean;

  /** Use SNS for fan-out (multiple subscribers) */
  useSns?: boolean;

  /** Message visibility timeout in seconds */
  visibilityTimeout?: number;

  /** Long polling wait time in seconds */
  waitTimeSeconds?: number;

  /** AWS credentials (optional - uses default chain) */
  credentials?: {
    accessKeyId: string;
    secretAccessKey: string;
  };
}

export class SQSTransport implements ITransport {
  readonly type = 'aws-sqs';

  private sqs: SQSClient;
  private sns?: SNSClient;
  private readonly queuePrefix: string;
  private readonly fifo: boolean;
  private activePollers: Map<string, AbortController> = new Map();

  constructor(private options: SQSTransportOptions) {
    this.queuePrefix = options.queuePrefix ?? 'mcp-';
    this.fifo = options.fifo ?? true;

    this.sqs = new SQSClient({
      region: options.region,
      credentials: options.credentials,
    });

    if (options.useSns) {
      this.sns = new SNSClient({
        region: options.region,
        credentials: options.credentials,
      });
    }
  }

  async connect(): Promise<void> {
    // Connection is lazy in AWS SDK
  }

  async disconnect(): Promise<void> {
    // Stop all pollers
    for (const controller of this.activePollers.values()) {
      controller.abort();
    }
    this.activePollers.clear();

    this.sqs.destroy();
    this.sns?.destroy();
  }

  async subscribe(
    sessionId: string,
    handler: MessageHandler
  ): Promise<Subscription> {
    const queueUrl = await this.getOrCreateQueue(sessionId, 'toserver');
    const controller = new AbortController();

    this.activePollers.set(sessionId, controller);

    // Start long-polling loop
    this.pollMessages(queueUrl, handler, controller.signal);

    return {
      isActive: true,
      unsubscribe: async () => {
        controller.abort();
        this.activePollers.delete(sessionId);
      },
    };
  }

  async publish(
    sessionId: string,
    message: McpMessage,
    options?: PublishOptions
  ): Promise<void> {
    const queueUrl = await this.getOrCreateQueue(sessionId, 'toclient');

    await this.sqs.send(new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(message),
      MessageGroupId: this.fifo ? sessionId : undefined,
      MessageDeduplicationId: this.fifo ? options?.messageId : undefined,
    }));
  }

  async hasActiveSubscribers(sessionId: string): Promise<boolean> {
    return this.activePollers.has(sessionId);
  }

  async sendControl(
    sessionId: string,
    control: ControlMessage
  ): Promise<void> {
    const queueUrl = await this.getOrCreateQueue(sessionId, 'control');

    await this.sqs.send(new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(control),
      MessageGroupId: this.fifo ? sessionId : undefined,
    }));
  }

  private async pollMessages(
    queueUrl: string,
    handler: MessageHandler,
    signal: AbortSignal
  ): Promise<void> {
    while (!signal.aborted) {
      try {
        const result = await this.sqs.send(new ReceiveMessageCommand({
          QueueUrl: queueUrl,
          MaxNumberOfMessages: 10,
          WaitTimeSeconds: this.options.waitTimeSeconds ?? 20,
          VisibilityTimeout: this.options.visibilityTimeout ?? 30,
        }));

        for (const msg of result.Messages ?? []) {
          if (signal.aborted) break;

          const parsed = JSON.parse(msg.Body!) as McpMessage;
          await handler(parsed);

          // Delete processed message
          await this.sqs.send(new DeleteMessageCommand({
            QueueUrl: queueUrl,
            ReceiptHandle: msg.ReceiptHandle,
          }));
        }
      } catch (error) {
        if (signal.aborted) break;
        // Log error and continue polling
        console.error('SQS polling error:', error);
        await this.delay(1000);
      }
    }
  }

  private async getOrCreateQueue(
    sessionId: string,
    type: string
  ): Promise<string> {
    const queueName = `${this.queuePrefix}${type}-${sessionId}${this.fifo ? '.fifo' : ''}`;

    try {
      const result = await this.sqs.send(new GetQueueUrlCommand({
        QueueName: queueName,
      }));
      return result.QueueUrl!;
    } catch {
      const result = await this.sqs.send(new CreateQueueCommand({
        QueueName: queueName,
        Attributes: this.fifo ? {
          FifoQueue: 'true',
          ContentBasedDeduplication: 'true',
        } : {},
      }));
      return result.QueueUrl!;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
```

### 4.4 Google Cloud Pub/Sub Transport

```typescript
import { PubSub, Subscription as GcpSubscription, Topic } from '@google-cloud/pubsub';

export interface PubSubTransportOptions {
  projectId: string;
  topicPrefix?: string;

  /** Use ordering keys for message ordering */
  enableOrdering?: boolean;

  /** Ack deadline in seconds */
  ackDeadlineSeconds?: number;

  /** Credentials (optional - uses default chain) */
  keyFilename?: string;
}

export class PubSubTransport implements ITransport {
  readonly type = 'gcp-pubsub';

  private pubsub: PubSub;
  private readonly topicPrefix: string;
  private readonly enableOrdering: boolean;
  private subscriptions: Map<string, GcpSubscription> = new Map();

  constructor(private options: PubSubTransportOptions) {
    this.topicPrefix = options.topicPrefix ?? 'mcp-';
    this.enableOrdering = options.enableOrdering ?? true;

    this.pubsub = new PubSub({
      projectId: options.projectId,
      keyFilename: options.keyFilename,
    });
  }

  async connect(): Promise<void> {
    // Connection is lazy in GCP SDK
  }

  async disconnect(): Promise<void> {
    for (const sub of this.subscriptions.values()) {
      await sub.close();
    }
    this.subscriptions.clear();
    await this.pubsub.close();
  }

  async subscribe(
    sessionId: string,
    handler: MessageHandler
  ): Promise<Subscription> {
    const topicName = this.getTopicName(sessionId, 'toserver');
    const subscriptionName = `${topicName}-sub-${Date.now()}`;

    // Ensure topic exists
    const [topic] = await this.pubsub.topic(topicName).get({ autoCreate: true });

    // Create subscription
    const [subscription] = await topic.createSubscription(subscriptionName, {
      ackDeadlineSeconds: this.options.ackDeadlineSeconds ?? 60,
      enableMessageOrdering: this.enableOrdering,
    });

    this.subscriptions.set(sessionId, subscription);

    subscription.on('message', async (message) => {
      try {
        const parsed = JSON.parse(message.data.toString()) as McpMessage;
        await handler(parsed);
        message.ack();
      } catch (error) {
        console.error('Message handling error:', error);
        message.nack();
      }
    });

    return {
      isActive: true,
      unsubscribe: async () => {
        subscription.removeAllListeners();
        await subscription.close();
        await subscription.delete();
        this.subscriptions.delete(sessionId);
      },
    };
  }

  async publish(
    sessionId: string,
    message: McpMessage,
    options?: PublishOptions
  ): Promise<void> {
    const topicName = this.getTopicName(sessionId, 'toclient');
    const [topic] = await this.pubsub.topic(topicName).get({ autoCreate: true });

    await topic.publishMessage({
      data: Buffer.from(JSON.stringify(message)),
      orderingKey: this.enableOrdering ? sessionId : undefined,
      attributes: options?.messageId ? { messageId: options.messageId } : undefined,
    });
  }

  async hasActiveSubscribers(sessionId: string): Promise<boolean> {
    return this.subscriptions.has(sessionId);
  }

  async sendControl(
    sessionId: string,
    control: ControlMessage
  ): Promise<void> {
    const topicName = this.getTopicName(sessionId, 'control');
    const [topic] = await this.pubsub.topic(topicName).get({ autoCreate: true });

    await topic.publishMessage({
      data: Buffer.from(JSON.stringify(control)),
    });
  }

  private getTopicName(sessionId: string, type: string): string {
    return `${this.topicPrefix}${type}-${sessionId}`;
  }
}
```

### 4.5 Azure Service Bus Transport

```typescript
import {
  ServiceBusClient,
  ServiceBusSender,
  ServiceBusReceiver,
  ServiceBusAdministrationClient,
} from '@azure/service-bus';

export interface ServiceBusTransportOptions {
  connectionString: string;
  queuePrefix?: string;

  /** Use sessions for message ordering */
  useSessions?: boolean;

  /** Use topics instead of queues for fan-out */
  useTopics?: boolean;
}

export class ServiceBusTransport implements ITransport {
  readonly type = 'azure-servicebus';

  private client: ServiceBusClient;
  private admin: ServiceBusAdministrationClient;
  private readonly queuePrefix: string;
  private receivers: Map<string, ServiceBusReceiver> = new Map();

  constructor(private options: ServiceBusTransportOptions) {
    this.queuePrefix = options.queuePrefix ?? 'mcp-';
    this.client = new ServiceBusClient(options.connectionString);
    this.admin = new ServiceBusAdministrationClient(options.connectionString);
  }

  async connect(): Promise<void> {
    // Connection is lazy in Azure SDK
  }

  async disconnect(): Promise<void> {
    for (const receiver of this.receivers.values()) {
      await receiver.close();
    }
    this.receivers.clear();
    await this.client.close();
  }

  async subscribe(
    sessionId: string,
    handler: MessageHandler
  ): Promise<Subscription> {
    const queueName = this.getQueueName(sessionId, 'toserver');
    await this.ensureQueue(queueName);

    const receiver = this.options.useSessions
      ? await this.client.acceptSession(queueName, sessionId)
      : this.client.createReceiver(queueName);

    this.receivers.set(sessionId, receiver);

    const subscription = receiver.subscribe({
      processMessage: async (message) => {
        const parsed = JSON.parse(message.body) as McpMessage;
        await handler(parsed);
        await receiver.completeMessage(message);
      },
      processError: async (error) => {
        console.error('Service Bus error:', error);
      },
    });

    return {
      isActive: true,
      unsubscribe: async () => {
        await subscription.close();
        await receiver.close();
        this.receivers.delete(sessionId);
      },
    };
  }

  async publish(
    sessionId: string,
    message: McpMessage,
    options?: PublishOptions
  ): Promise<void> {
    const queueName = this.getQueueName(sessionId, 'toclient');
    await this.ensureQueue(queueName);

    const sender = this.client.createSender(queueName);

    try {
      await sender.sendMessages({
        body: JSON.stringify(message),
        sessionId: this.options.useSessions ? sessionId : undefined,
        messageId: options?.messageId,
      });
    } finally {
      await sender.close();
    }
  }

  async hasActiveSubscribers(sessionId: string): Promise<boolean> {
    return this.receivers.has(sessionId);
  }

  async sendControl(
    sessionId: string,
    control: ControlMessage
  ): Promise<void> {
    const queueName = this.getQueueName(sessionId, 'control');
    await this.ensureQueue(queueName);

    const sender = this.client.createSender(queueName);

    try {
      await sender.sendMessages({
        body: JSON.stringify(control),
        sessionId: this.options.useSessions ? sessionId : undefined,
      });
    } finally {
      await sender.close();
    }
  }

  private async ensureQueue(queueName: string): Promise<void> {
    try {
      await this.admin.getQueue(queueName);
    } catch {
      await this.admin.createQueue(queueName, {
        requiresSession: this.options.useSessions,
      });
    }
  }

  private getQueueName(sessionId: string, type: string): string {
    return `${this.queuePrefix}${type}-${sessionId}`;
  }
}
```

### 4.6 In-Memory Transport (Development/Testing)

```typescript
import { EventEmitter } from 'events';

export class InMemoryTransport implements ITransport {
  readonly type = 'memory';

  private emitter = new EventEmitter();
  private subscriptions: Map<string, Set<MessageHandler>> = new Map();

  async connect(): Promise<void> {
    // No-op for in-memory
  }

  async disconnect(): Promise<void> {
    this.emitter.removeAllListeners();
    this.subscriptions.clear();
  }

  async subscribe(
    sessionId: string,
    handler: MessageHandler
  ): Promise<Subscription> {
    const channel = `toserver:${sessionId}`;

    if (!this.subscriptions.has(channel)) {
      this.subscriptions.set(channel, new Set());
    }
    this.subscriptions.get(channel)!.add(handler);

    const listener = (message: McpMessage) => handler(message);
    this.emitter.on(channel, listener);

    return {
      isActive: true,
      unsubscribe: async () => {
        this.emitter.off(channel, listener);
        this.subscriptions.get(channel)?.delete(handler);
      },
    };
  }

  async publish(
    sessionId: string,
    message: McpMessage,
    options?: PublishOptions
  ): Promise<void> {
    const channel = options?.messageId
      ? `toclient:${sessionId}:${options.messageId}`
      : `toclient:${sessionId}`;

    // Use setImmediate to simulate async behavior
    setImmediate(() => {
      this.emitter.emit(channel, message);
    });
  }

  async hasActiveSubscribers(sessionId: string): Promise<boolean> {
    const channel = `toserver:${sessionId}`;
    return (this.subscriptions.get(channel)?.size ?? 0) > 0;
  }

  async sendControl(
    sessionId: string,
    control: ControlMessage
  ): Promise<void> {
    const channel = `control:${sessionId}`;
    setImmediate(() => {
      this.emitter.emit(channel, control);
    });
  }
}
```

---

## 5. Storage Layer Design

### 5.1 Storage Comparison Matrix

| Storage | Latency | Scalability | Consistency | TTL Support | Cost Model |
|---------|---------|-------------|-------------|-------------|------------|
| **In-Memory** | <1ms | None | N/A | Manual | Free |
| **Redis** | 1-5ms | Cluster | Eventual | Native | Per-hour |
| **DynamoDB** | 5-20ms | Infinite | Strong available | Native | Per-request |
| **Firestore** | 10-50ms | Infinite | Strong | Manual | Per-operation |
| **CosmosDB** | 5-20ms | Infinite | Configurable | Native | Per-RU |
| **PostgreSQL** | 5-20ms | Limited | Strong | Manual | Per-hour |
| **MongoDB** | 5-15ms | Sharded | Configurable | Native | Per-hour |

### 5.2 Redis Storage (Current - Refactored)

```typescript
export interface RedisStorageOptions {
  url?: string;
  host?: string;
  port?: number;
  password?: string;
  tls?: boolean;
  keyPrefix?: string;
  defaultTtl?: number;
}

export class RedisStorage implements IStorage {
  readonly type = 'redis';

  private client: RedisClientType;
  private readonly keyPrefix: string;

  readonly sessions: ISessionStorage;
  readonly auth: IAuthStorage;

  constructor(options: RedisStorageOptions = {}) {
    this.keyPrefix = options.keyPrefix ?? 'mcp:';
    this.sessions = new RedisSessionStorage(this);
    this.auth = new RedisAuthStorage(this);
  }

  async connect(): Promise<void> {
    await this.client.connect();
  }

  async disconnect(): Promise<void> {
    await this.client.quit();
  }

  async get<T>(key: string): Promise<T | null> {
    const value = await this.client.get(this.prefixKey(key));
    return value ? JSON.parse(value) : null;
  }

  async set<T>(key: string, value: T, options?: SetOptions): Promise<void> {
    const serialized = JSON.stringify(value);
    const redisOptions: any = {};

    if (options?.ttl) redisOptions.EX = options.ttl;
    if (options?.nx) redisOptions.NX = true;
    if (options?.xx) redisOptions.XX = true;

    await this.client.set(this.prefixKey(key), serialized, redisOptions);
  }

  async delete(key: string): Promise<boolean> {
    const result = await this.client.del(this.prefixKey(key));
    return result > 0;
  }

  async exists(key: string): Promise<boolean> {
    const result = await this.client.exists(this.prefixKey(key));
    return result > 0;
  }

  private prefixKey(key: string): string {
    return `${this.keyPrefix}${key}`;
  }
}

class RedisSessionStorage implements ISessionStorage {
  constructor(private storage: RedisStorage) {}

  async create(session: Session): Promise<void> {
    await this.storage.set(`session:${session.id}`, session);
  }

  async get(sessionId: string): Promise<Session | null> {
    return this.storage.get(`session:${sessionId}`);
  }

  async update(sessionId: string, updates: Partial<Session>): Promise<void> {
    const session = await this.get(sessionId);
    if (session) {
      await this.storage.set(`session:${sessionId}`, { ...session, ...updates });
    }
  }

  async delete(sessionId: string): Promise<void> {
    await this.storage.delete(`session:${sessionId}`);
    await this.storage.delete(`session:${sessionId}:owner`);
  }

  async setOwner(sessionId: string, userId: string): Promise<void> {
    await this.storage.set(`session:${sessionId}:owner`, userId);
  }

  async getOwner(sessionId: string): Promise<string | null> {
    return this.storage.get(`session:${sessionId}:owner`);
  }

  async touch(sessionId: string): Promise<void> {
    await this.update(sessionId, { lastActivity: new Date().toISOString() });
  }

  async listByUser(userId: string): Promise<Session[]> {
    // Note: This requires scanning - consider a user->sessions index
    // For production, maintain a separate index
    return [];
  }
}
```

### 5.3 DynamoDB Storage (AWS)

```typescript
import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  DeleteItemCommand,
  QueryCommand,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

export interface DynamoDBStorageOptions {
  region: string;
  tableName: string;
  ttlAttribute?: string;
  credentials?: {
    accessKeyId: string;
    secretAccessKey: string;
  };
}

export class DynamoDBStorage implements IStorage {
  readonly type = 'dynamodb';

  private client: DynamoDBClient;
  private readonly tableName: string;
  private readonly ttlAttribute: string;

  readonly sessions: ISessionStorage;
  readonly auth: IAuthStorage;

  constructor(private options: DynamoDBStorageOptions) {
    this.tableName = options.tableName;
    this.ttlAttribute = options.ttlAttribute ?? 'ttl';

    this.client = new DynamoDBClient({
      region: options.region,
      credentials: options.credentials,
    });

    this.sessions = new DynamoDBSessionStorage(this);
    this.auth = new DynamoDBAuthStorage(this);
  }

  async connect(): Promise<void> {
    // Connection is lazy
  }

  async disconnect(): Promise<void> {
    this.client.destroy();
  }

  async get<T>(key: string): Promise<T | null> {
    const result = await this.client.send(new GetItemCommand({
      TableName: this.tableName,
      Key: marshall({ pk: key }),
    }));

    if (!result.Item) return null;

    const item = unmarshall(result.Item);
    return item.data as T;
  }

  async set<T>(key: string, value: T, options?: SetOptions): Promise<void> {
    const item: any = {
      pk: key,
      data: value,
      updatedAt: new Date().toISOString(),
    };

    if (options?.ttl) {
      item[this.ttlAttribute] = Math.floor(Date.now() / 1000) + options.ttl;
    }

    const params: any = {
      TableName: this.tableName,
      Item: marshall(item),
    };

    if (options?.nx) {
      params.ConditionExpression = 'attribute_not_exists(pk)';
    }
    if (options?.xx) {
      params.ConditionExpression = 'attribute_exists(pk)';
    }

    await this.client.send(new PutItemCommand(params));
  }

  async delete(key: string): Promise<boolean> {
    await this.client.send(new DeleteItemCommand({
      TableName: this.tableName,
      Key: marshall({ pk: key }),
    }));
    return true;
  }

  async exists(key: string): Promise<boolean> {
    const result = await this.get(key);
    return result !== null;
  }
}
```

### 5.4 Firestore Storage (GCP)

```typescript
import { Firestore, FieldValue } from '@google-cloud/firestore';

export interface FirestoreStorageOptions {
  projectId: string;
  collection?: string;
  keyFilename?: string;
}

export class FirestoreStorage implements IStorage {
  readonly type = 'firestore';

  private db: Firestore;
  private readonly collection: string;

  readonly sessions: ISessionStorage;
  readonly auth: IAuthStorage;

  constructor(private options: FirestoreStorageOptions) {
    this.collection = options.collection ?? 'mcp';

    this.db = new Firestore({
      projectId: options.projectId,
      keyFilename: options.keyFilename,
    });

    this.sessions = new FirestoreSessionStorage(this);
    this.auth = new FirestoreAuthStorage(this);
  }

  async connect(): Promise<void> {
    // Connection is lazy
  }

  async disconnect(): Promise<void> {
    await this.db.terminate();
  }

  async get<T>(key: string): Promise<T | null> {
    const doc = await this.db.collection(this.collection).doc(key).get();

    if (!doc.exists) return null;

    const data = doc.data()!;

    // Check TTL
    if (data.expiresAt && data.expiresAt.toDate() < new Date()) {
      await this.delete(key);
      return null;
    }

    return data.value as T;
  }

  async set<T>(key: string, value: T, options?: SetOptions): Promise<void> {
    const doc = this.db.collection(this.collection).doc(key);

    const data: any = {
      value,
      updatedAt: FieldValue.serverTimestamp(),
    };

    if (options?.ttl) {
      data.expiresAt = new Date(Date.now() + options.ttl * 1000);
    }

    if (options?.nx) {
      await this.db.runTransaction(async (tx) => {
        const existing = await tx.get(doc);
        if (!existing.exists) {
          tx.set(doc, data);
        }
      });
    } else {
      await doc.set(data);
    }
  }

  async delete(key: string): Promise<boolean> {
    await this.db.collection(this.collection).doc(key).delete();
    return true;
  }

  async exists(key: string): Promise<boolean> {
    const doc = await this.db.collection(this.collection).doc(key).get();
    return doc.exists;
  }
}
```

### 5.5 In-Memory Storage (Development/Testing)

```typescript
export class InMemoryStorage implements IStorage {
  readonly type = 'memory';

  private data: Map<string, { value: any; expiresAt?: number }> = new Map();
  private cleanupInterval?: NodeJS.Timeout;

  readonly sessions: ISessionStorage;
  readonly auth: IAuthStorage;

  constructor() {
    this.sessions = new InMemorySessionStorage(this);
    this.auth = new InMemoryAuthStorage(this);

    // Periodic cleanup of expired keys
    this.cleanupInterval = setInterval(() => this.cleanup(), 60000);
  }

  async connect(): Promise<void> {
    // No-op
  }

  async disconnect(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.data.clear();
  }

  async get<T>(key: string): Promise<T | null> {
    const entry = this.data.get(key);

    if (!entry) return null;

    if (entry.expiresAt && entry.expiresAt < Date.now()) {
      this.data.delete(key);
      return null;
    }

    return entry.value as T;
  }

  async set<T>(key: string, value: T, options?: SetOptions): Promise<void> {
    if (options?.nx && this.data.has(key)) return;
    if (options?.xx && !this.data.has(key)) return;

    this.data.set(key, {
      value,
      expiresAt: options?.ttl ? Date.now() + options.ttl * 1000 : undefined,
    });
  }

  async delete(key: string): Promise<boolean> {
    return this.data.delete(key);
  }

  async exists(key: string): Promise<boolean> {
    const value = await this.get(key);
    return value !== null;
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.data) {
      if (entry.expiresAt && entry.expiresAt < now) {
        this.data.delete(key);
      }
    }
  }
}
```

---

## 6. Authentication Layer Design

### 6.1 Auth Provider Comparison

| Provider | Self-Hosted | OAuth 2.0 | PKCE | OIDC | MFA | Cost |
|----------|-------------|-----------|------|------|-----|------|
| **Internal** | Yes | Yes | Yes | No | No | Free |
| **Auth0** | No | Yes | Yes | Yes | Yes | Per-MAU |
| **Cognito** | No | Yes | Yes | Yes | Yes | Per-MAU |
| **Okta** | No | Yes | Yes | Yes | Yes | Per-user |
| **Azure AD** | No | Yes | Yes | Yes | Yes | Per-user |
| **Keycloak** | Yes | Yes | Yes | Yes | Yes | Free |
| **Firebase Auth** | No | Yes | Yes | Yes | Yes | Free tier |

### 6.2 Internal Auth Provider (Current - Refactored)

```typescript
export interface InternalAuthOptions {
  storage: IAuthStorage;
  issuer: string;

  /** Token expiry in seconds */
  accessTokenTtl?: number;
  refreshTokenTtl?: number;

  /** Enable PKCE requirement */
  requirePkce?: boolean;

  /** Custom token generation */
  generateToken?: () => string;
}

export class InternalAuthProvider implements IAuth {
  readonly type = 'internal';

  constructor(private options: InternalAuthOptions) {}

  async getMetadata(): Promise<OAuthMetadata> {
    return {
      issuer: this.options.issuer,
      authorization_endpoint: `${this.options.issuer}/authorize`,
      token_endpoint: `${this.options.issuer}/token`,
      registration_endpoint: `${this.options.issuer}/register`,
      introspection_endpoint: `${this.options.issuer}/introspect`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['client_secret_post'],
    };
  }

  async validateToken(token: string): Promise<AuthInfo | null> {
    const introspection = await this.introspect(token);

    if (!introspection.active) return null;

    return {
      userId: introspection.sub!,
      scopes: introspection.scope?.split(' ') ?? [],
      clientId: introspection.client_id!,
      expiresAt: introspection.exp ? new Date(introspection.exp * 1000) : undefined,
    };
  }

  async introspect(token: string): Promise<TokenIntrospectionResponse> {
    const tokenRecord = await this.options.storage.getToken(token);

    if (!tokenRecord) {
      return { active: false };
    }

    if (tokenRecord.expiresAt < Date.now()) {
      return { active: false };
    }

    return {
      active: true,
      sub: tokenRecord.userId,
      client_id: tokenRecord.clientId,
      scope: tokenRecord.scopes.join(' '),
      exp: Math.floor(tokenRecord.expiresAt / 1000),
      iat: Math.floor(tokenRecord.issuedAt / 1000),
      token_type: 'Bearer',
    };
  }

  getRoutes(): Router {
    const router = Router();

    router.get('/.well-known/oauth-authorization-server', this.handleMetadata);
    router.post('/register', this.handleRegister);
    router.get('/authorize', this.handleAuthorize);
    router.post('/authorize', this.handleAuthorizeSubmit);
    router.post('/token', this.handleToken);
    router.post('/introspect', this.handleIntrospect);

    return router;
  }

  // ... handler implementations
}
```

### 6.3 Auth0 Provider

```typescript
import { ManagementClient, AuthenticationClient } from 'auth0';

export interface Auth0Options {
  domain: string;
  clientId: string;
  clientSecret: string;
  audience: string;

  /** Cache token introspection results */
  cacheSeconds?: number;
}

export class Auth0Provider implements IAuth {
  readonly type = 'auth0';

  private auth: AuthenticationClient;
  private management: ManagementClient;
  private cache: Map<string, { result: AuthInfo; expiresAt: number }> = new Map();

  constructor(private options: Auth0Options) {
    this.auth = new AuthenticationClient({
      domain: options.domain,
      clientId: options.clientId,
      clientSecret: options.clientSecret,
    });

    this.management = new ManagementClient({
      domain: options.domain,
      clientId: options.clientId,
      clientSecret: options.clientSecret,
    });
  }

  async getMetadata(): Promise<OAuthMetadata> {
    return {
      issuer: `https://${this.options.domain}/`,
      authorization_endpoint: `https://${this.options.domain}/authorize`,
      token_endpoint: `https://${this.options.domain}/oauth/token`,
      userinfo_endpoint: `https://${this.options.domain}/userinfo`,
      jwks_uri: `https://${this.options.domain}/.well-known/jwks.json`,
      response_types_supported: ['code', 'token', 'id_token'],
      grant_types_supported: ['authorization_code', 'refresh_token', 'client_credentials'],
      code_challenge_methods_supported: ['S256'],
    };
  }

  async validateToken(token: string): Promise<AuthInfo | null> {
    // Check cache
    const cached = this.cache.get(token);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.result;
    }

    try {
      const userInfo = await this.auth.getProfile(token);

      const result: AuthInfo = {
        userId: userInfo.sub,
        scopes: [], // Would need to decode JWT for scopes
        clientId: this.options.clientId,
        metadata: userInfo,
      };

      // Cache result
      this.cache.set(token, {
        result,
        expiresAt: Date.now() + (this.options.cacheSeconds ?? 60) * 1000,
      });

      return result;
    } catch {
      return null;
    }
  }

  async introspect(token: string): Promise<TokenIntrospectionResponse> {
    const authInfo = await this.validateToken(token);

    if (!authInfo) {
      return { active: false };
    }

    return {
      active: true,
      sub: authInfo.userId,
      client_id: authInfo.clientId,
      scope: authInfo.scopes.join(' '),
    };
  }
}
```

### 6.4 AWS Cognito Provider

```typescript
import {
  CognitoIdentityProviderClient,
  GetUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { CognitoJwtVerifier } from 'aws-jwt-verify';

export interface CognitoAuthOptions {
  region: string;
  userPoolId: string;
  clientId: string;

  /** Cache token validation results */
  cacheSeconds?: number;
}

export class CognitoAuthProvider implements IAuth {
  readonly type = 'cognito';

  private client: CognitoIdentityProviderClient;
  private verifier: CognitoJwtVerifier;
  private cache: Map<string, { result: AuthInfo; expiresAt: number }> = new Map();

  constructor(private options: CognitoAuthOptions) {
    this.client = new CognitoIdentityProviderClient({
      region: options.region,
    });

    this.verifier = CognitoJwtVerifier.create({
      userPoolId: options.userPoolId,
      tokenUse: 'access',
      clientId: options.clientId,
    });
  }

  async getMetadata(): Promise<OAuthMetadata> {
    const issuer = `https://cognito-idp.${this.options.region}.amazonaws.com/${this.options.userPoolId}`;

    return {
      issuer,
      authorization_endpoint: `${issuer}/oauth2/authorize`,
      token_endpoint: `${issuer}/oauth2/token`,
      userinfo_endpoint: `${issuer}/oauth2/userInfo`,
      jwks_uri: `${issuer}/.well-known/jwks.json`,
      response_types_supported: ['code', 'token'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
    };
  }

  async validateToken(token: string): Promise<AuthInfo | null> {
    // Check cache
    const cached = this.cache.get(token);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.result;
    }

    try {
      const payload = await this.verifier.verify(token);

      const result: AuthInfo = {
        userId: payload.sub,
        scopes: (payload.scope as string)?.split(' ') ?? [],
        clientId: payload.client_id as string,
        expiresAt: new Date(payload.exp * 1000),
      };

      // Cache result
      this.cache.set(token, {
        result,
        expiresAt: Date.now() + (this.options.cacheSeconds ?? 60) * 1000,
      });

      return result;
    } catch {
      return null;
    }
  }

  async introspect(token: string): Promise<TokenIntrospectionResponse> {
    const authInfo = await this.validateToken(token);

    if (!authInfo) {
      return { active: false };
    }

    return {
      active: true,
      sub: authInfo.userId,
      client_id: authInfo.clientId,
      scope: authInfo.scopes.join(' '),
      exp: authInfo.expiresAt ? Math.floor(authInfo.expiresAt.getTime() / 1000) : undefined,
    };
  }
}
```

---

## 7. Cloud Provider Implementations

### 7.1 AWS Complete Stack

```typescript
import { createMcpServer } from '@mcp/distributed-server';
import { SQSTransport } from '@mcp/transport-aws';
import { DynamoDBStorage } from '@mcp/storage-aws';
import { CognitoAuth } from '@mcp/auth-aws';

// Full AWS-native MCP server
const server = createMcpServer({
  name: 'aws-mcp-server',
  version: '1.0.0',

  transport: new SQSTransport({
    region: 'us-east-1',
    queuePrefix: 'mcp-',
    fifo: true,
  }),

  storage: new DynamoDBStorage({
    region: 'us-east-1',
    tableName: 'mcp-state',
  }),

  auth: new CognitoAuth({
    region: 'us-east-1',
    userPoolId: process.env.COGNITO_USER_POOL_ID!,
    clientId: process.env.COGNITO_CLIENT_ID!,
  }),
});
```

### 7.2 GCP Complete Stack

```typescript
import { createMcpServer } from '@mcp/distributed-server';
import { PubSubTransport } from '@mcp/transport-gcp';
import { FirestoreStorage } from '@mcp/storage-gcp';
import { FirebaseAuth } from '@mcp/auth-gcp';

// Full GCP-native MCP server
const server = createMcpServer({
  name: 'gcp-mcp-server',
  version: '1.0.0',

  transport: new PubSubTransport({
    projectId: process.env.GCP_PROJECT_ID!,
    enableOrdering: true,
  }),

  storage: new FirestoreStorage({
    projectId: process.env.GCP_PROJECT_ID!,
    collection: 'mcp-state',
  }),

  auth: new FirebaseAuth({
    projectId: process.env.GCP_PROJECT_ID!,
  }),
});
```

### 7.3 Azure Complete Stack

```typescript
import { createMcpServer } from '@mcp/distributed-server';
import { ServiceBusTransport } from '@mcp/transport-azure';
import { CosmosDBStorage } from '@mcp/storage-azure';
import { AzureADAuth } from '@mcp/auth-azure';

// Full Azure-native MCP server
const server = createMcpServer({
  name: 'azure-mcp-server',
  version: '1.0.0',

  transport: new ServiceBusTransport({
    connectionString: process.env.AZURE_SERVICEBUS_CONNECTION!,
    useSessions: true,
  }),

  storage: new CosmosDBStorage({
    endpoint: process.env.COSMOS_ENDPOINT!,
    key: process.env.COSMOS_KEY!,
    database: 'mcp',
    container: 'state',
  }),

  auth: new AzureADAuth({
    tenantId: process.env.AZURE_TENANT_ID!,
    clientId: process.env.AZURE_CLIENT_ID!,
    clientSecret: process.env.AZURE_CLIENT_SECRET!,
  }),
});
```

### 7.4 Self-Hosted Stack

```typescript
import { createMcpServer } from '@mcp/distributed-server';
import { RedisTransport } from '@mcp/transport-redis';
import { RedisStorage } from '@mcp/storage-redis';
import { InternalAuth } from '@mcp/auth-internal';

// Self-hosted with Redis
const server = createMcpServer({
  name: 'self-hosted-mcp',
  version: '1.0.0',

  transport: new RedisTransport({
    url: process.env.REDIS_URL,
  }),

  storage: new RedisStorage({
    url: process.env.REDIS_URL,
  }),

  auth: new InternalAuth({
    issuer: process.env.BASE_URL!,
  }),
});
```

---

## 8. Package Structure

### 8.1 Monorepo Layout

```
@mcp/
├── distributed-server/          # Core library
│   ├── src/
│   │   ├── index.ts            # Main exports
│   │   ├── server.ts           # McpServer class
│   │   ├── interfaces/         # Core interfaces
│   │   ├── adapters/           # HTTP framework adapters
│   │   │   ├── express.ts
│   │   │   ├── fastify.ts
│   │   │   ├── hono.ts
│   │   │   └── node-http.ts
│   │   └── serverless/         # Serverless handlers
│   │       ├── aws-lambda.ts
│   │       ├── gcp-functions.ts
│   │       └── azure-functions.ts
│   └── package.json
│
├── transport-redis/            # Redis transport
│   ├── src/
│   │   ├── index.ts
│   │   ├── pubsub.ts          # Pub/Sub implementation
│   │   └── streams.ts         # Streams implementation
│   └── package.json
│
├── transport-aws/              # AWS transports
│   ├── src/
│   │   ├── index.ts
│   │   ├── sqs.ts
│   │   └── sns-sqs.ts
│   └── package.json
│
├── transport-gcp/              # GCP transports
│   ├── src/
│   │   ├── index.ts
│   │   └── pubsub.ts
│   └── package.json
│
├── transport-azure/            # Azure transports
│   ├── src/
│   │   ├── index.ts
│   │   └── servicebus.ts
│   └── package.json
│
├── storage-redis/              # Redis storage
│   ├── src/
│   │   └── index.ts
│   └── package.json
│
├── storage-aws/                # AWS storage
│   ├── src/
│   │   ├── index.ts
│   │   └── dynamodb.ts
│   └── package.json
│
├── storage-gcp/                # GCP storage
│   ├── src/
│   │   ├── index.ts
│   │   └── firestore.ts
│   └── package.json
│
├── storage-azure/              # Azure storage
│   ├── src/
│   │   ├── index.ts
│   │   └── cosmosdb.ts
│   └── package.json
│
├── auth-internal/              # Built-in OAuth server
│   ├── src/
│   │   └── index.ts
│   └── package.json
│
├── auth-auth0/                 # Auth0 integration
├── auth-cognito/               # AWS Cognito integration
├── auth-firebase/              # Firebase Auth integration
├── auth-azure-ad/              # Azure AD integration
├── auth-okta/                  # Okta integration
│
└── create-mcp-server/          # CLI scaffolding tool
    ├── src/
    │   └── index.ts
    ├── templates/
    │   ├── basic/
    │   ├── aws/
    │   ├── gcp/
    │   └── azure/
    └── package.json
```

### 8.2 Package Dependencies

```
@mcp/distributed-server
├── @modelcontextprotocol/sdk (peer)
├── express (optional peer)
└── zod

@mcp/transport-redis
├── @mcp/distributed-server (peer)
└── redis

@mcp/transport-aws
├── @mcp/distributed-server (peer)
├── @aws-sdk/client-sqs
└── @aws-sdk/client-sns

@mcp/storage-aws
├── @mcp/distributed-server (peer)
└── @aws-sdk/client-dynamodb

@mcp/auth-cognito
├── @mcp/distributed-server (peer)
├── @aws-sdk/client-cognito-identity-provider
└── aws-jwt-verify
```

### 8.3 CLI Tool: create-mcp-server

```bash
# Create a new MCP server project
npx create-mcp-server my-server

# With specific template
npx create-mcp-server my-server --template aws

# Interactive mode
npx create-mcp-server

? Project name: my-mcp-server
? Cloud provider:
  ❯ None (local development)
    AWS
    Google Cloud
    Azure
    Self-hosted (Redis)
? Authentication:
  ❯ Built-in OAuth
    Auth0
    AWS Cognito
    Firebase Auth
    Azure AD
? Include example tools? Yes
? TypeScript? Yes

Creating project in ./my-mcp-server...
✓ Created package.json
✓ Created tsconfig.json
✓ Created src/index.ts
✓ Created src/tools/
✓ Created .env.example
✓ Installed dependencies

Done! Run:
  cd my-mcp-server
  npm run dev
```

---

## 9. Migration Path

### 9.1 Phase 1: Extract Core Interfaces

**Goal**: Define stable interfaces without breaking existing code

1. Create `src/lib/interfaces/` with all interface definitions
2. Refactor existing code to use interfaces internally
3. Keep all existing exports working
4. Add interface exports alongside existing exports

**Estimated Changes**: ~20 files, low risk

### 9.2 Phase 2: Implement Abstraction Layers

**Goal**: Create transport and storage abstractions

1. Create `InMemoryTransport` as default
2. Refactor `RedisTransport` to implement `ITransport`
3. Create `InMemoryStorage` as default
4. Refactor Redis storage to implement `IStorage`
5. Update handlers to use abstractions

**Estimated Changes**: ~15 files, medium risk

### 9.3 Phase 3: Create Builder API

**Goal**: Simple `createMcpServer()` API

1. Create `McpServerBuilder` class
2. Implement fluent API for configuration
3. Add `tool()`, `resource()`, `prompt()` helpers
4. Create HTTP framework adapters
5. Maintain backward compatibility with existing API

**Estimated Changes**: ~10 new files, low risk

### 9.4 Phase 4: Extract Packages

**Goal**: Split into separate npm packages

1. Create monorepo structure with pnpm workspaces
2. Move core to `@mcp/distributed-server`
3. Move Redis implementations to `@mcp/transport-redis` and `@mcp/storage-redis`
4. Create cloud provider packages
5. Set up proper peer dependencies
6. Add package publishing workflow

**Estimated Changes**: Project restructure, medium risk

### 9.5 Phase 5: Cloud Provider Implementations

**Goal**: Native cloud provider support

1. Implement AWS packages (SQS, DynamoDB, Cognito)
2. Implement GCP packages (Pub/Sub, Firestore, Firebase Auth)
3. Implement Azure packages (Service Bus, CosmosDB, Azure AD)
4. Add integration tests for each provider
5. Create deployment guides

**Estimated Changes**: ~30 new files per provider, low risk (additive)

---

## 10. Performance Considerations

### 10.1 Transport Latency Optimization

```typescript
interface TransportOptimizations {
  // Connection pooling
  poolSize?: number;

  // Message batching
  batchSize?: number;
  batchTimeout?: number;

  // Compression
  compression?: 'none' | 'gzip' | 'lz4';

  // Keep-alive
  keepAliveInterval?: number;
}
```

### 10.2 Storage Caching Layer

```typescript
interface CacheConfig {
  enabled: boolean;

  // Local in-memory cache
  localCache?: {
    maxSize: number;
    ttl: number;
  };

  // Distributed cache (Redis)
  distributedCache?: {
    url: string;
    ttl: number;
  };
}

// Usage
const server = createMcpServer({
  storage: new DynamoDBStorage({
    // ...
    cache: {
      enabled: true,
      localCache: { maxSize: 1000, ttl: 60 },
    },
  }),
});
```

### 10.3 Horizontal Scaling

```
                    Load Balancer
                         │
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
   ┌─────────┐      ┌─────────┐      ┌─────────┐
   │ MCP     │      │ MCP     │      │ MCP     │
   │ Server 1│      │ Server 2│      │ Server 3│
   └────┬────┘      └────┬────┘      └────┬────┘
        │                │                │
        └────────────────┼────────────────┘
                         │
                   ┌─────┴─────┐
                   │ Transport │
                   │ (Redis/   │
                   │  SQS/etc) │
                   └───────────┘

Session Affinity: Via Mcp-Session-Id header
State Sharing: Via distributed storage
Message Routing: Via transport pub/sub
```

---

## 11. Security Considerations

### 11.1 Transport Security

- **Encryption in Transit**: All transports should support TLS
- **Message Signing**: Optional HMAC signing for message integrity
- **Access Control**: IAM roles for cloud transports

### 11.2 Storage Security

- **Encryption at Rest**: All storage backends encrypt data
- **Key Management**: Integration with cloud KMS services
- **Access Control**: Least-privilege IAM policies

### 11.3 Authentication Security

- **Token Validation Caching**: Configurable cache duration
- **Rate Limiting**: Per-endpoint rate limits
- **PKCE Enforcement**: Required for public clients
- **Token Rotation**: Automatic refresh token rotation

### 11.4 Session Security

- **Session Isolation**: Users can only access their own sessions
- **Session Timeout**: Configurable inactivity timeout
- **Session Revocation**: Ability to invalidate all user sessions

---

## 12. Implementation Roadmap

### Milestone 1: Core Library (v0.1.0)
- [ ] Define all core interfaces
- [ ] Implement InMemoryTransport
- [ ] Implement InMemoryStorage
- [ ] Create McpServerBuilder API
- [ ] Express adapter
- [ ] Basic documentation

### Milestone 2: Redis Support (v0.2.0)
- [ ] RedisTransport (Pub/Sub)
- [ ] RedisTransport (Streams)
- [ ] RedisStorage
- [ ] Connection pooling
- [ ] Failover support

### Milestone 3: AWS Support (v0.3.0)
- [ ] SQSTransport
- [ ] DynamoDBStorage
- [ ] CognitoAuth
- [ ] Lambda handler
- [ ] AWS deployment guide

### Milestone 4: GCP Support (v0.4.0)
- [ ] PubSubTransport
- [ ] FirestoreStorage
- [ ] FirebaseAuth
- [ ] Cloud Functions handler
- [ ] GCP deployment guide

### Milestone 5: Azure Support (v0.5.0)
- [ ] ServiceBusTransport
- [ ] CosmosDBStorage
- [ ] AzureADAuth
- [ ] Azure Functions handler
- [ ] Azure deployment guide

### Milestone 6: Production Ready (v1.0.0)
- [ ] Comprehensive test suite
- [ ] Performance benchmarks
- [ ] Security audit
- [ ] Full documentation
- [ ] CLI tool (create-mcp-server)
- [ ] Example applications

---

## Appendix A: Full API Reference

See separate API documentation (to be generated from TypeScript definitions).

## Appendix B: Cloud Provider Setup Guides

See separate deployment guides for each cloud provider.

## Appendix C: Performance Benchmarks

To be added after implementation.

---

*Document Version: 1.0.0*
*Last Updated: 2026-01-12*
*Authors: Generated for MCP Feature Reference Server*
