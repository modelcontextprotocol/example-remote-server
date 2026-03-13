# Distributed MCP Server Library Design Document

## Executive Summary

This document outlines the design for transforming the MCP Feature Reference Server into a portable, cloud-agnostic library that enables developers to create distributed MCP servers in just a few lines of code.

**Goals:**
1. Create a simple, intuitive API for building distributed MCP servers
2. Abstract transport mechanisms to support multiple cloud providers
3. Abstract storage backends for session and auth state
4. Maintain security features (OAuth 2.0, PKCE, session isolation)
5. Enable horizontal scaling across multiple instances
6. Support edge/serverless platforms (Vercel, Netlify, Cloudflare Workers)
7. Provide deployment skills and conformance testing out of the box

---

## Table of Contents

1. [Current Architecture Analysis](#1-current-architecture-analysis)
2. [Target API Design](#2-target-api-design)
3. [Core Abstractions](#3-core-abstractions)
4. [Transport Layer Design](#4-transport-layer-design)
5. [Storage Layer Design](#5-storage-layer-design)
6. [Authentication Layer Design](#6-authentication-layer-design)
7. [Cloud Provider Implementations](#7-cloud-provider-implementations)
8. [Edge & Serverless Platforms](#8-edge--serverless-platforms)
9. [Workspace Package Design](#9-workspace-package-design)
10. [Deployment Skills](#10-deployment-skills)
11. [MCP Conformance Testing](#11-mcp-conformance-testing)
12. [Migration Path](#12-migration-path)
13. [Performance Considerations](#13-performance-considerations)
14. [Security Considerations](#14-security-considerations)
15. [Implementation Roadmap](#15-implementation-roadmap)

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

## 8. Edge & Serverless Platforms

### 8.1 Platform Capability Matrix

| Capability | **Vercel** | **Netlify** | **Cloudflare Workers** |
|------------|-----------|------------|----------------------|
| Runtime | Node.js / Edge (V8) | Node.js / Deno (Edge) | V8 Isolates |
| SSE Streaming | Serverless Functions only | Functions (v2) | Native support |
| WebSockets | No (use third-party) | No | Native support |
| Max Execution | 300s (Pro) / 60s (Edge) | 26s / 50ms (Edge) | 30s (standard) / 15min (Workflows) |
| KV Storage | Vercel KV (Upstash) | Netlify Blobs | Cloudflare KV |
| Durable State | -- | -- | Durable Objects |
| Message Queues | Via Upstash QStash | Via external | Cloudflare Queues |
| SQL Database | Vercel Postgres | Netlify Connect | Cloudflare D1 (SQLite) |
| Cold Start | ~250ms / <1ms (Edge) | ~500ms / <1ms (Edge) | <1ms |

### 8.2 Vercel + Upstash

Vercel is the most natural fit for Node.js MCP servers. Its ecosystem with Upstash provides edge-compatible Redis, queuing, and Kafka.

**Key Insight**: Upstash Redis uses an **HTTP-based REST API**, making it compatible with edge runtimes that lack raw TCP socket support. This is critical — standard `redis` npm clients won't work on edge, but `@upstash/redis` will.

#### Transport: Upstash QStash + Redis

```typescript
import { Redis } from '@upstash/redis';
import { Client as QStashClient } from '@upstash/qstash';

export interface UpstashTransportOptions {
  redis: {
    url: string;
    token: string;
  };
  /** Use QStash for reliable delivery with retries */
  qstash?: {
    token: string;
    callbackUrl: string;
  };
}

export class UpstashTransport implements ITransport {
  readonly type = 'upstash';

  private redis: Redis;
  private qstash?: QStashClient;

  constructor(private options: UpstashTransportOptions) {
    // HTTP-based Redis — works on Vercel Edge, CF Workers, Netlify Edge
    this.redis = new Redis({
      url: options.redis.url,
      token: options.redis.token,
    });

    if (options.qstash) {
      this.qstash = new QStashClient({ token: options.qstash.token });
    }
  }

  async subscribe(
    sessionId: string,
    handler: MessageHandler
  ): Promise<Subscription> {
    // Upstash doesn't support true Pub/Sub over HTTP.
    // Two strategies:
    //
    // Strategy A: Polling (simple, higher latency)
    //   - Messages written to a Redis list
    //   - Subscriber polls with LPOP
    //
    // Strategy B: QStash webhooks (recommended)
    //   - Publisher sends via QStash
    //   - QStash calls webhook URL on subscriber
    //   - Built-in retries, deduplication, DLQ

    const listKey = `mcp:toserver:${sessionId}`;
    let active = true;

    const poll = async () => {
      while (active) {
        const message = await this.redis.lpop<string>(listKey);
        if (message) {
          await handler(JSON.parse(message));
        } else {
          // Backoff when no messages
          await new Promise(r => setTimeout(r, 100));
        }
      }
    };

    poll(); // fire-and-forget

    return {
      get isActive() { return active; },
      unsubscribe: async () => { active = false; },
    };
  }

  async publish(
    sessionId: string,
    message: McpMessage,
    options?: PublishOptions
  ): Promise<void> {
    if (this.qstash && this.options.qstash) {
      // Reliable delivery via QStash webhook
      await this.qstash.publishJSON({
        url: `${this.options.qstash.callbackUrl}/mcp/webhook/${sessionId}`,
        body: message,
        deduplicationId: options?.messageId,
        retries: 3,
      });
    } else {
      // Direct Redis list push
      const listKey = `mcp:toclient:${sessionId}`;
      await this.redis.rpush(listKey, JSON.stringify(message));
    }
  }

  async hasActiveSubscribers(sessionId: string): Promise<boolean> {
    // Check if session marker exists
    const marker = await this.redis.exists(`mcp:active:${sessionId}`);
    return marker === 1;
  }

  async sendControl(
    sessionId: string,
    control: ControlMessage
  ): Promise<void> {
    const key = `mcp:control:${sessionId}`;
    await this.redis.rpush(key, JSON.stringify(control));
  }
}
```

#### Storage: Upstash Redis

```typescript
export class UpstashStorage implements IStorage {
  readonly type = 'upstash';

  private redis: Redis;
  readonly sessions: ISessionStorage;
  readonly auth: IAuthStorage;

  constructor(options: { url: string; token: string }) {
    this.redis = new Redis({ url: options.url, token: options.token });
    this.sessions = new UpstashSessionStorage(this.redis);
    this.auth = new UpstashAuthStorage(this.redis);
  }

  // All standard IStorage methods — works identically to Redis
  // but uses HTTP instead of TCP, so it's edge-compatible
  async get<T>(key: string): Promise<T | null> {
    return this.redis.get<T>(key);
  }

  async set<T>(key: string, value: T, options?: SetOptions): Promise<void> {
    if (options?.ttl) {
      await this.redis.set(key, JSON.stringify(value), { ex: options.ttl });
    } else {
      await this.redis.set(key, JSON.stringify(value));
    }
  }

  async delete(key: string): Promise<boolean> {
    const result = await this.redis.del(key);
    return result > 0;
  }

  async exists(key: string): Promise<boolean> {
    const result = await this.redis.exists(key);
    return result === 1;
  }

  async connect(): Promise<void> { /* HTTP-based, no connection needed */ }
  async disconnect(): Promise<void> { /* No-op */ }
}
```

#### Vercel Deployment Example

```typescript
// api/mcp/route.ts (Next.js App Router)
import { createMcpHandler } from '@mcp/distributed-server/vercel';
import { UpstashTransport } from '@mcp/transport-upstash';
import { UpstashStorage } from '@mcp/storage-upstash';

const handler = createMcpHandler({
  name: 'my-vercel-mcp',
  version: '1.0.0',
  transport: new UpstashTransport({
    redis: {
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    },
  }),
  storage: new UpstashStorage({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  }),
  tools: { /* ... */ },
});

export const POST = handler;
export const GET = handler;
export const DELETE = handler;
```

### 8.3 Cloudflare Workers + Durable Objects

Cloudflare Workers are the most interesting platform for MCP because **Durable Objects** provide exactly what distributed MCP needs: stateful, single-instance actors with WebSocket support.

**Key Insight**: A Durable Object can *be* the MCP session. Instead of external pub/sub routing messages between stateless handlers and stateful servers, each session lives inside its own Durable Object. This eliminates the transport layer entirely for single-region deployments.

#### Architecture: Durable Objects as Sessions

```
Client Request
    │
    ▼
┌──────────────────┐
│  Worker (Router)  │  ← Stateless, routes by session ID
└────────┬─────────┘
         │
         ▼
┌──────────────────────────────┐
│  Durable Object: MCP Session │  ← Stateful, single-threaded
│  ┌─────────────────────────┐ │
│  │  MCP Server Instance    │ │
│  │  Tools, Resources, etc. │ │
│  │  Session State          │ │
│  └─────────────────────────┘ │
│  Built-in: WebSocket, Alarm  │
│  Storage: Transactional KV   │
└──────────────────────────────┘
```

#### Transport: Durable Objects (Zero External Dependencies)

```typescript
import { DurableObject } from 'cloudflare:workers';

export interface CloudflareTransportOptions {
  /** Fallback to Cloudflare Queues for cross-region */
  queues?: {
    producer: Queue;
    consumerHandler: (batch: MessageBatch) => Promise<void>;
  };
}

// The Durable Object IS the transport + session combined
export class McpSessionDO extends DurableObject {
  private mcpServer: McpServerInstance | null = null;
  private websockets: Set<WebSocket> = new Set();

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
  }

  // HTTP request handler — Streamable HTTP transport
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.headers.get('Upgrade') === 'websocket') {
      return this.handleWebSocket(request);
    }

    if (request.method === 'POST') {
      return this.handleMcpRequest(request);
    }

    if (request.method === 'GET') {
      return this.handleSSE(request);
    }

    if (request.method === 'DELETE') {
      return this.handleShutdown(request);
    }

    return new Response('Method not allowed', { status: 405 });
  }

  private async handleMcpRequest(request: Request): Promise<Response> {
    if (!this.mcpServer) {
      this.mcpServer = await this.initializeMcpServer();
    }

    const body = await request.json();
    const response = await this.mcpServer.handleMessage(body);

    // Reset inactivity alarm
    await this.ctx.storage.setAlarm(Date.now() + 5 * 60 * 1000);

    return new Response(JSON.stringify(response), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  private handleWebSocket(request: Request): Response {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.ctx.acceptWebSocket(server);
    this.websockets.add(server);

    server.addEventListener('message', async (event) => {
      if (!this.mcpServer) {
        this.mcpServer = await this.initializeMcpServer();
      }

      const message = JSON.parse(event.data as string);
      const response = await this.mcpServer.handleMessage(message);

      server.send(JSON.stringify(response));
    });

    server.addEventListener('close', () => {
      this.websockets.delete(server);
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  // Durable Object alarm — inactivity timeout
  async alarm(): Promise<void> {
    // No activity for 5 minutes — shut down
    for (const ws of this.websockets) {
      ws.close(1000, 'Session timeout');
    }
    this.websockets.clear();
    this.mcpServer = null;
  }

  private async initializeMcpServer(): Promise<McpServerInstance> {
    // Tools and resources registered via env bindings
    // This is where the user's tool definitions run
    return createMcpServerInstance(this.env);
  }
}

// Worker router — stateless entry point
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Extract or generate session ID
    const sessionId = request.headers.get('Mcp-Session-Id')
      ?? crypto.randomUUID();

    // Route to the Durable Object for this session
    const id = env.MCP_SESSIONS.idFromName(sessionId);
    const stub = env.MCP_SESSIONS.get(id);

    const response = await stub.fetch(request);

    // Add session ID header if this is a new session
    if (!request.headers.get('Mcp-Session-Id')) {
      const headers = new Headers(response.headers);
      headers.set('Mcp-Session-Id', sessionId);
      return new Response(response.body, {
        status: response.status,
        headers,
      });
    }

    return response;
  },
};
```

#### Storage: Durable Object Transactional Storage + KV

```typescript
// For session-local state: Durable Object built-in storage
// For shared state (auth, clients): Cloudflare KV

export class CloudflareStorage implements IStorage {
  readonly type = 'cloudflare';

  readonly sessions: ISessionStorage;
  readonly auth: IAuthStorage;

  constructor(
    private kv: KVNamespace,
    private doStorage?: DurableObjectStorage
  ) {
    this.sessions = new CloudflareSessionStorage(kv, doStorage);
    this.auth = new CloudflareAuthStorage(kv);
  }

  async get<T>(key: string): Promise<T | null> {
    const value = await this.kv.get(key, 'json');
    return value as T | null;
  }

  async set<T>(key: string, value: T, options?: SetOptions): Promise<void> {
    await this.kv.put(key, JSON.stringify(value), {
      expirationTtl: options?.ttl,
    });
  }

  async delete(key: string): Promise<boolean> {
    await this.kv.delete(key);
    return true;
  }

  async exists(key: string): Promise<boolean> {
    const value = await this.kv.get(key);
    return value !== null;
  }

  async connect(): Promise<void> { /* Bound at deploy time */ }
  async disconnect(): Promise<void> { /* No-op */ }
}

// For transactional session state inside a Durable Object:
class DurableObjectSessionStore {
  constructor(private storage: DurableObjectStorage) {}

  async get<T>(key: string): Promise<T | undefined> {
    return this.storage.get<T>(key);
  }

  async set<T>(key: string, value: T): Promise<void> {
    await this.storage.put(key, value);
  }

  // Transactional batch operations
  async transaction(fn: (txn: DurableObjectTransaction) => Promise<void>) {
    await this.storage.transaction(fn);
  }
}
```

#### Cross-Region: Cloudflare Queues

```typescript
// For multi-region Cloudflare deployments where Durable Objects
// need to communicate across regions:

export class CloudflareQueuesTransport implements ITransport {
  readonly type = 'cloudflare-queues';

  constructor(
    private producer: Queue,
    private env: Env
  ) {}

  async publish(
    sessionId: string,
    message: McpMessage,
    options?: PublishOptions
  ): Promise<void> {
    await this.producer.send({
      sessionId,
      message,
      messageId: options?.messageId,
    });
  }

  // Consumer is configured in wrangler.toml:
  // [[queues.consumers]]
  //   queue = "mcp-messages"
  //   max_batch_size = 10
  //   max_batch_timeout = 1

  async queue(batch: MessageBatch): Promise<void> {
    for (const msg of batch.messages) {
      const { sessionId, message } = msg.body;

      const id = this.env.MCP_SESSIONS.idFromName(sessionId);
      const stub = this.env.MCP_SESSIONS.get(id);

      await stub.fetch(new Request('https://internal/mcp', {
        method: 'POST',
        body: JSON.stringify(message),
      }));

      msg.ack();
    }
  }
}
```

#### Cloudflare Deployment Example

```toml
# wrangler.toml
name = "my-mcp-server"
main = "src/worker.ts"
compatibility_date = "2025-12-01"

[[durable_objects.bindings]]
name = "MCP_SESSIONS"
class_name = "McpSessionDO"

[[kv_namespaces]]
binding = "MCP_KV"
id = "abc123"

[[queues.producers]]
binding = "MCP_QUEUE"
queue = "mcp-messages"

[[queues.consumers]]
queue = "mcp-messages"
max_batch_size = 10
```

```typescript
// src/worker.ts
import { createMcpWorker, McpSessionDO } from '@mcp/platform-cloudflare';

export { McpSessionDO };

export default createMcpWorker({
  name: 'my-mcp-server',
  version: '1.0.0',
  tools: {
    greet: {
      description: 'Greet someone',
      schema: { name: { type: 'string' } },
      handler: async ({ name }) => ({
        content: [{ type: 'text', text: `Hello, ${name}!` }],
      }),
    },
  },
});
```

### 8.4 Netlify

Netlify Functions v2 (AWS Lambda-based) support streaming responses, making them viable for MCP's Streamable HTTP transport. Edge Functions (Deno-based) have tighter execution limits.

**Best strategy**: Use Netlify Functions v2 for the MCP handler, pair with an external transport (Upstash is the best fit since it works over HTTP).

#### Netlify Deployment Example

```typescript
// netlify/functions/mcp.mts (Netlify Functions v2)
import { createMcpHandler } from '@mcp/distributed-server/netlify';
import { UpstashTransport } from '@mcp/transport-upstash';
import { UpstashStorage } from '@mcp/storage-upstash';

export default createMcpHandler({
  name: 'netlify-mcp',
  version: '1.0.0',
  transport: new UpstashTransport({
    redis: {
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    },
  }),
  storage: new UpstashStorage({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  }),
  tools: { /* ... */ },
});

// Config for streaming
export const config = {
  path: '/mcp',
  method: ['GET', 'POST', 'DELETE'],
};
```

### 8.5 Platform Decision Guide

```
┌─────────────────────────────────────────────────────────────┐
│  Which platform should I use?                               │
└─────────────────────────────────────────────────────────────┘
         │
         ├── Need WebSocket support?
         │       YES → Cloudflare Workers (Durable Objects)
         │
         ├── Need zero cold start?
         │       YES → Cloudflare Workers (<1ms)
         │             or Vercel Edge Functions
         │
         ├── Already using Next.js?
         │       YES → Vercel + Upstash
         │
         ├── Need stateful sessions without external DB?
         │       YES → Cloudflare Durable Objects
         │             (session state lives in the DO itself)
         │
         ├── Need managed infrastructure cloud?
         │       AWS → Lambda + SQS + DynamoDB
         │       GCP → Cloud Functions + Pub/Sub + Firestore
         │       Azure → Functions + Service Bus + CosmosDB
         │
         ├── Already using Netlify?
         │       YES → Netlify Functions v2 + Upstash
         │
         └── Just want it to work?
                 → Self-hosted Node.js + Redis
                   (simplest, most flexible)
```

---

## 9. Workspace Package Design

### 9.1 pnpm Workspace Configuration

The monorepo uses **pnpm workspaces** for fast installs, strict dependency isolation, and efficient disk usage via content-addressable storage.

```yaml
# pnpm-workspace.yaml
packages:
  - 'packages/*'
  - 'platforms/*'
  - 'examples/*'
  - 'skills/*'
```

```jsonc
// Root package.json
{
  "name": "@mcp/monorepo",
  "private": true,
  "scripts": {
    "build": "turbo run build",
    "test": "turbo run test",
    "lint": "turbo run lint",
    "typecheck": "turbo run typecheck",
    "conformance": "turbo run conformance",
    "publish-packages": "pnpm -r publish --access public"
  },
  "devDependencies": {
    "turbo": "^2.0.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0",
    "tsup": "^8.0.0",
    "changesets": "^2.27.0"
  }
}
```

### 9.2 Full Monorepo Layout

```
@mcp/
├── pnpm-workspace.yaml
├── turbo.json                        # Turborepo build orchestration
├── .changeset/                       # Changeset version management
│
├── packages/                         # Core library + provider packages
│   ├── core/                         # @mcp/distributed-server
│   │   ├── src/
│   │   │   ├── index.ts             # Public API exports
│   │   │   ├── server.ts            # McpServer class
│   │   │   ├── interfaces/          # ITransport, IStorage, IAuth
│   │   │   │   ├── transport.ts
│   │   │   │   ├── storage.ts
│   │   │   │   └── auth.ts
│   │   │   ├── adapters/            # HTTP framework adapters
│   │   │   │   ├── express.ts
│   │   │   │   ├── fastify.ts
│   │   │   │   ├── hono.ts
│   │   │   │   └── node-http.ts
│   │   │   ├── defaults/            # Zero-config defaults
│   │   │   │   ├── memory-transport.ts
│   │   │   │   ├── memory-storage.ts
│   │   │   │   └── internal-auth.ts
│   │   │   └── testing/             # Test utilities for consumers
│   │   │       ├── mock-transport.ts
│   │   │       ├── mock-storage.ts
│   │   │       └── test-client.ts
│   │   ├── package.json
│   │   └── tsup.config.ts
│   │
│   ├── transport-redis/              # @mcp/transport-redis
│   ├── transport-upstash/            # @mcp/transport-upstash
│   ├── transport-aws/                # @mcp/transport-aws (SQS/SNS)
│   ├── transport-gcp/                # @mcp/transport-gcp (Pub/Sub)
│   ├── transport-azure/              # @mcp/transport-azure (Service Bus)
│   │
│   ├── storage-redis/                # @mcp/storage-redis
│   ├── storage-upstash/              # @mcp/storage-upstash
│   ├── storage-aws/                  # @mcp/storage-aws (DynamoDB)
│   ├── storage-gcp/                  # @mcp/storage-gcp (Firestore)
│   ├── storage-azure/                # @mcp/storage-azure (CosmosDB)
│   │
│   ├── auth-internal/                # @mcp/auth-internal
│   ├── auth-auth0/                   # @mcp/auth-auth0
│   ├── auth-cognito/                 # @mcp/auth-cognito
│   ├── auth-firebase/                # @mcp/auth-firebase
│   ├── auth-azure-ad/                # @mcp/auth-azure-ad
│   ├── auth-okta/                    # @mcp/auth-okta
│   │
│   └── conformance/                  # @mcp/conformance-utils
│       ├── src/
│       │   ├── index.ts
│       │   ├── runner.ts            # Wraps official conformance suite
│       │   ├── profiles.ts          # Test profiles per platform
│       │   └── reporters/           # Output formatters
│       │       ├── console.ts
│       │       ├── json.ts
│       │       └── github-actions.ts
│       └── package.json
│
├── platforms/                        # Platform-specific entry points
│   ├── vercel/                       # @mcp/platform-vercel
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── handler.ts          # Next.js route handler adapter
│   │   │   ├── edge.ts             # Edge Function support
│   │   │   └── middleware.ts        # Vercel middleware integration
│   │   └── package.json
│   │
│   ├── cloudflare/                   # @mcp/platform-cloudflare
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── worker.ts           # Worker entry point
│   │   │   ├── durable-object.ts   # MCP Session Durable Object
│   │   │   └── queues.ts           # Queues consumer handler
│   │   └── package.json
│   │
│   ├── netlify/                      # @mcp/platform-netlify
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── function.ts         # Netlify Function handler
│   │   │   └── edge.ts             # Edge Function handler
│   │   └── package.json
│   │
│   ├── aws-lambda/                   # @mcp/platform-aws-lambda
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── handler.ts          # Lambda handler
│   │   │   └── api-gateway.ts      # API Gateway integration
│   │   └── package.json
│   │
│   └── node/                         # @mcp/platform-node
│       ├── src/
│       │   ├── index.ts
│       │   └── standalone.ts        # Standalone Node.js server
│       └── package.json
│
├── skills/                           # Deployment & operations skills
│   ├── deploy/                       # @mcp/skill-deploy
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── vercel.ts
│   │   │   ├── cloudflare.ts
│   │   │   ├── netlify.ts
│   │   │   ├── aws.ts
│   │   │   └── docker.ts
│   │   └── package.json
│   │
│   ├── conformance/                  # @mcp/skill-conformance
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   └── run.ts
│   │   └── package.json
│   │
│   └── scaffold/                     # @mcp/skill-scaffold
│       ├── src/
│       │   └── index.ts
│       ├── templates/
│       │   ├── basic/
│       │   ├── vercel/
│       │   ├── cloudflare/
│       │   ├── netlify/
│       │   ├── aws/
│       │   ├── gcp/
│       │   └── azure/
│       └── package.json
│
├── examples/                         # Working example servers
│   ├── basic/                        # Simplest possible server
│   ├── vercel-nextjs/                # Vercel + Next.js
│   ├── cloudflare-workers/           # CF Workers + Durable Objects
│   ├── netlify-functions/            # Netlify Functions
│   ├── aws-lambda/                   # AWS Lambda + SQS + DynamoDB
│   ├── gcp-functions/                # GCP Cloud Functions
│   ├── docker-compose/               # Self-hosted with Docker
│   └── full-featured/                # All features demo
│
└── docs/                             # Documentation
    ├── getting-started.md
    ├── architecture.md
    ├── platform-guides/
    │   ├── vercel.md
    │   ├── cloudflare.md
    │   ├── netlify.md
    │   └── ...
    └── conformance.md
```

### 9.3 Turborepo Build Pipeline

```jsonc
// turbo.json
{
  "$schema": "https://turbo.build/schema.json",
  "globalDependencies": ["tsconfig.json"],
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "test": {
      "dependsOn": ["build"],
      "outputs": []
    },
    "test:integration": {
      "dependsOn": ["build"],
      "outputs": [],
      "env": ["REDIS_URL", "UPSTASH_*", "AWS_*", "CLOUDFLARE_*"]
    },
    "conformance": {
      "dependsOn": ["build"],
      "outputs": ["results/**"],
      "env": ["MCP_SERVER_URL"]
    },
    "lint": {
      "outputs": []
    },
    "typecheck": {
      "dependsOn": ["^build"],
      "outputs": []
    },
    "deploy": {
      "dependsOn": ["build", "test", "conformance"],
      "outputs": [],
      "cache": false
    }
  }
}
```

### 9.4 Package Dependencies Graph

```
@mcp/distributed-server (core)
├── @modelcontextprotocol/sdk (peer)
├── zod
└── [no HTTP framework dependency — adapters are optional]

@mcp/transport-redis
├── @mcp/distributed-server (peer)
└── redis

@mcp/transport-upstash
├── @mcp/distributed-server (peer)
└── @upstash/redis

@mcp/platform-cloudflare
├── @mcp/distributed-server (peer)
├── @cloudflare/workers-types (dev)
└── [uses CF bindings — no runtime deps]

@mcp/platform-vercel
├── @mcp/distributed-server (peer)
├── @mcp/transport-upstash (peer, optional)
└── @mcp/storage-upstash (peer, optional)

@mcp/platform-netlify
├── @mcp/distributed-server (peer)
└── @netlify/functions

@mcp/conformance-utils
├── @mcp/distributed-server (peer)
└── @modelcontextprotocol/conformance
```

### 9.5 Version Management with Changesets

```bash
# Developer workflow for releasing
pnpm changeset            # Create a changeset describing changes
pnpm changeset version    # Bump versions based on changesets
pnpm changeset publish    # Publish changed packages to npm

# CI publishes automatically on merge to main
```

```yaml
# .github/workflows/release.yml
name: Release
on:
  push:
    branches: [main]
jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - run: pnpm install
      - run: pnpm build
      - run: pnpm test
      - run: pnpm conformance
      - uses: changesets/action@v1
        with:
          publish: pnpm changeset publish
```

### 9.6 CLI Tool: create-mcp-server

```bash
# Create a new MCP server project
npx create-mcp-server my-server

# With specific platform
npx create-mcp-server my-server --platform cloudflare
npx create-mcp-server my-server --platform vercel
npx create-mcp-server my-server --platform netlify

# Interactive mode
npx create-mcp-server

? Project name: my-mcp-server
? Platform:
  ❯ Node.js (standalone)
    Vercel
    Cloudflare Workers
    Netlify
    AWS Lambda
    Google Cloud Functions
    Docker
? Transport:
  ❯ In-Memory (single instance)
    Redis
    Upstash (edge-compatible)
    AWS SQS
    Cloudflare Queues + Durable Objects
? Authentication:
  ❯ Built-in OAuth (development)
    Auth0
    AWS Cognito
    Firebase Auth
    Azure AD
? Include conformance tests? Yes
? TypeScript? Yes

Creating project in ./my-mcp-server...
✓ Created package.json with platform dependencies
✓ Created tsconfig.json
✓ Created src/index.ts with platform entry point
✓ Created src/tools/ with example tools
✓ Created .env.example
✓ Created conformance test setup
✓ Installed dependencies

Done! Run:
  cd my-mcp-server
  npm run dev          # Start dev server
  npm run conformance  # Run MCP conformance tests
```

---

## 10. Deployment Skills

Instead of traditional deployment scripts, the library provides **skills** — composable, intelligent deployment workflows that understand the target platform and can be invoked programmatically or via CLI.

### 10.1 Why Skills Over Scripts?

| Aspect | Scripts | Skills |
|--------|---------|--------|
| **Context Awareness** | Stateless, runs blindly | Inspects project config, adapts behavior |
| **Error Recovery** | Fails, user debugs | Diagnoses issues, suggests fixes |
| **Composability** | Shell pipes, brittle | Typed inputs/outputs, chainable |
| **Discoverability** | Read the docs | Self-documenting, interactive |
| **Platform Detection** | Manual flags | Auto-detects from package.json, config files |
| **Pre-flight Checks** | Manual | Validates env vars, credentials, quotas |

### 10.2 Skill Architecture

```typescript
// skills/deploy/src/index.ts

interface DeploySkill {
  /** Unique identifier */
  name: string;

  /** Which platform this deploys to */
  platform: string;

  /** Check if project is ready for deployment */
  preflight(context: ProjectContext): Promise<PreflightResult>;

  /** Execute the deployment */
  deploy(context: ProjectContext, options: DeployOptions): Promise<DeployResult>;

  /** Verify deployment is healthy */
  verify(context: ProjectContext, result: DeployResult): Promise<VerifyResult>;

  /** Tear down a deployment */
  teardown(context: ProjectContext, deploymentId: string): Promise<void>;
}

interface ProjectContext {
  /** Root directory of the project */
  rootDir: string;

  /** Detected platform from config files */
  detectedPlatform: string | null;

  /** Package.json contents */
  packageJson: Record<string, unknown>;

  /** Environment variables available */
  env: Record<string, string>;

  /** Platform-specific config files found */
  configFiles: {
    'vercel.json'?: unknown;
    'wrangler.toml'?: unknown;
    'netlify.toml'?: unknown;
    'Dockerfile'?: boolean;
  };
}

interface PreflightResult {
  ready: boolean;
  checks: Array<{
    name: string;
    passed: boolean;
    message: string;
    fix?: string;  // Suggested fix if failed
  }>;
}

interface DeployResult {
  deploymentId: string;
  url: string;
  platform: string;
  timestamp: string;
  metadata: Record<string, unknown>;
}
```

### 10.3 Vercel Deploy Skill

```typescript
// skills/deploy/src/vercel.ts

export class VercelDeploySkill implements DeploySkill {
  name = 'deploy:vercel';
  platform = 'vercel';

  async preflight(ctx: ProjectContext): Promise<PreflightResult> {
    const checks = [];

    // Check Vercel CLI
    checks.push(await this.checkCli());

    // Check vercel.json or Next.js config
    checks.push(this.checkConfig(ctx));

    // Check environment variables
    checks.push(this.checkEnvVars(ctx, [
      'UPSTASH_REDIS_REST_URL',
      'UPSTASH_REDIS_REST_TOKEN',
    ]));

    // Check build succeeds
    checks.push(await this.checkBuild(ctx));

    // Run conformance tests
    checks.push(await this.checkConformance(ctx));

    return {
      ready: checks.every(c => c.passed),
      checks,
    };
  }

  async deploy(ctx: ProjectContext, options: DeployOptions): Promise<DeployResult> {
    // 1. Run preflight
    const preflight = await this.preflight(ctx);
    if (!preflight.ready) {
      throw new DeployError('Preflight failed', preflight.checks);
    }

    // 2. Deploy
    const result = await exec('vercel', [
      '--yes',
      options.production ? '--prod' : '',
      '--token', ctx.env.VERCEL_TOKEN,
    ].filter(Boolean), { cwd: ctx.rootDir });

    const url = result.stdout.trim();

    return {
      deploymentId: url,
      url,
      platform: 'vercel',
      timestamp: new Date().toISOString(),
      metadata: { production: options.production },
    };
  }

  async verify(ctx: ProjectContext, result: DeployResult): Promise<VerifyResult> {
    // Run conformance tests against the deployed URL
    const conformance = await runConformance({
      serverUrl: `${result.url}/mcp`,
      scenarios: 'all',
      timeout: 30000,
    });

    return {
      healthy: conformance.passed,
      checks: conformance.results,
      conformanceScore: conformance.score,
    };
  }
}
```

### 10.4 Cloudflare Deploy Skill

```typescript
// skills/deploy/src/cloudflare.ts

export class CloudflareDeploySkill implements DeploySkill {
  name = 'deploy:cloudflare';
  platform = 'cloudflare';

  async preflight(ctx: ProjectContext): Promise<PreflightResult> {
    const checks = [];

    // Check wrangler CLI
    checks.push(await this.checkCli('wrangler'));

    // Check wrangler.toml
    checks.push(this.checkWranglerConfig(ctx));

    // Check Durable Object bindings
    checks.push(this.checkDurableObjectBindings(ctx));

    // Check KV namespace bindings
    checks.push(this.checkKvNamespaces(ctx));

    // Check Cloudflare API token
    checks.push(this.checkEnvVars(ctx, ['CLOUDFLARE_API_TOKEN']));

    // Check compatibility date
    checks.push(this.checkCompatibilityDate(ctx));

    // Run conformance tests locally
    checks.push(await this.checkConformance(ctx));

    return {
      ready: checks.every(c => c.passed),
      checks,
    };
  }

  async deploy(ctx: ProjectContext, options: DeployOptions): Promise<DeployResult> {
    const preflight = await this.preflight(ctx);
    if (!preflight.ready) {
      throw new DeployError('Preflight failed', preflight.checks);
    }

    // Create KV namespaces if needed
    await this.ensureKvNamespaces(ctx);

    // Deploy with wrangler
    const result = await exec('wrangler', [
      'deploy',
      '--env', options.production ? 'production' : 'staging',
    ], { cwd: ctx.rootDir });

    // Extract deployment URL from wrangler output
    const url = this.extractUrl(result.stdout);

    return {
      deploymentId: url,
      url,
      platform: 'cloudflare',
      timestamp: new Date().toISOString(),
      metadata: {
        durableObjects: true,
        routes: this.extractRoutes(result.stdout),
      },
    };
  }

  async verify(ctx: ProjectContext, result: DeployResult): Promise<VerifyResult> {
    // Verify Durable Objects are responsive
    const doCheck = await this.checkDurableObjectHealth(result.url);

    // Run conformance suite against deployed worker
    const conformance = await runConformance({
      serverUrl: `${result.url}/mcp`,
      scenarios: 'all',
      timeout: 30000,
    });

    return {
      healthy: doCheck.healthy && conformance.passed,
      checks: [doCheck, ...conformance.results],
      conformanceScore: conformance.score,
    };
  }
}
```

### 10.5 Netlify Deploy Skill

```typescript
// skills/deploy/src/netlify.ts

export class NetlifyDeploySkill implements DeploySkill {
  name = 'deploy:netlify';
  platform = 'netlify';

  async preflight(ctx: ProjectContext): Promise<PreflightResult> {
    const checks = [];

    checks.push(await this.checkCli('netlify'));
    checks.push(this.checkNetlifyToml(ctx));
    checks.push(this.checkFunctionsDir(ctx));
    checks.push(this.checkEnvVars(ctx, [
      'UPSTASH_REDIS_REST_URL',   // Netlify needs external transport
      'UPSTASH_REDIS_REST_TOKEN',
    ]));
    checks.push(this.checkStreamingSupport(ctx)); // Ensure Functions v2
    checks.push(await this.checkConformance(ctx));

    return {
      ready: checks.every(c => c.passed),
      checks,
    };
  }

  async deploy(ctx: ProjectContext, options: DeployOptions): Promise<DeployResult> {
    const result = await exec('netlify', [
      'deploy',
      options.production ? '--prod' : '',
      '--json',
    ].filter(Boolean), { cwd: ctx.rootDir });

    const output = JSON.parse(result.stdout);

    return {
      deploymentId: output.deploy_id,
      url: output.deploy_url,
      platform: 'netlify',
      timestamp: new Date().toISOString(),
      metadata: output,
    };
  }
}
```

### 10.6 Docker Deploy Skill

```typescript
// skills/deploy/src/docker.ts

export class DockerDeploySkill implements DeploySkill {
  name = 'deploy:docker';
  platform = 'docker';

  async preflight(ctx: ProjectContext): Promise<PreflightResult> {
    const checks = [];

    checks.push(await this.checkCli('docker'));
    checks.push(this.checkDockerfile(ctx));
    checks.push(this.checkDockerCompose(ctx));
    checks.push(await this.checkConformance(ctx));

    return {
      ready: checks.every(c => c.passed),
      checks,
    };
  }

  async deploy(ctx: ProjectContext, options: DeployOptions): Promise<DeployResult> {
    // Build image
    await exec('docker', ['compose', 'build'], { cwd: ctx.rootDir });

    // Start services
    await exec('docker', ['compose', 'up', '-d'], { cwd: ctx.rootDir });

    // Wait for health check
    await this.waitForHealthy('http://localhost:3000/mcp');

    return {
      deploymentId: 'local',
      url: 'http://localhost:3000',
      platform: 'docker',
      timestamp: new Date().toISOString(),
      metadata: {},
    };
  }
}
```

### 10.7 Skill CLI Interface

```bash
# Auto-detect platform and deploy
npx @mcp/skill-deploy

# Explicit platform
npx @mcp/skill-deploy --platform vercel
npx @mcp/skill-deploy --platform cloudflare
npx @mcp/skill-deploy --platform netlify

# Just run preflight checks
npx @mcp/skill-deploy preflight

# Deploy to production
npx @mcp/skill-deploy --production

# Verify an existing deployment
npx @mcp/skill-deploy verify --url https://my-mcp.vercel.app

# Tear down
npx @mcp/skill-deploy teardown --deployment-id dep_abc123
```

### 10.8 Skill Pipeline (Composable)

```typescript
// Compose skills into a full CI/CD pipeline
import { Pipeline } from '@mcp/skill-deploy';
import { ConformanceSkill } from '@mcp/skill-conformance';

const pipeline = new Pipeline()
  .step('build', async (ctx) => {
    await exec('pnpm', ['build'], { cwd: ctx.rootDir });
  })
  .step('test', async (ctx) => {
    await exec('pnpm', ['test'], { cwd: ctx.rootDir });
  })
  .step('conformance', new ConformanceSkill({
    scenarios: 'all',
    failOnWarning: false,
  }))
  .step('deploy', new VercelDeploySkill())
  .step('verify', async (ctx, prev) => {
    // prev.deploy contains DeployResult
    const conformance = new ConformanceSkill({
      serverUrl: prev.deploy.url,
      scenarios: 'all',
    });
    return conformance.run(ctx);
  })
  .onFailure(async (ctx, error, step) => {
    console.error(`Pipeline failed at ${step}:`, error);
    // Auto-rollback if deploy step failed
    if (step === 'verify') {
      await rollback(ctx, prev.deploy);
    }
  });

await pipeline.run({ rootDir: process.cwd() });
```

---

## 11. MCP Conformance Testing

### 11.1 Overview

The library integrates with the official [modelcontextprotocol/conformance](https://github.com/modelcontextprotocol/conformance) test suite to validate that every server built with the library correctly implements the MCP specification. This is built into every stage: development, CI, and post-deployment verification.

### 11.2 The Official Conformance Suite

The official `@modelcontextprotocol/conformance` package provides:

| Scenario | What It Tests |
|----------|---------------|
| `server-initialize` | Initialization handshake, capability negotiation |
| `tools-list` | Tool listing endpoint |
| `tools-call-*` | Tool invocation, argument validation, error handling |
| `resources-*` | Resource listing, reading, subscriptions |
| `prompts-*` | Prompt listing, argument completion |
| `auth` | OAuth 2.0 flow, PKCE, token validation |

**CLI Usage:**
```bash
npx @modelcontextprotocol/conformance server \
  --url http://localhost:3000/mcp

npx @modelcontextprotocol/conformance server \
  --url http://localhost:3000/mcp \
  --scenario server-initialize

npx @modelcontextprotocol/conformance list --server
```

### 11.3 Library Conformance Integration

The library wraps the official suite with platform-aware test profiles and integrates it into the development workflow.

```typescript
// packages/conformance/src/index.ts

export interface ConformanceConfig {
  /** Server URL to test against */
  serverUrl?: string;

  /** Start server automatically if no URL provided */
  autoStart?: {
    command: string;
    port: number;
    readyPattern?: string | RegExp;
    timeout?: number;
  };

  /** Which scenarios to run */
  scenarios?: string[] | 'all';

  /** Platform-specific test profile */
  profile?: ConformanceProfile;

  /** Fail on warnings (strict mode) */
  strict?: boolean;

  /** Output format */
  reporter?: 'console' | 'json' | 'github-actions' | 'junit';

  /** Timeout per scenario in ms */
  timeout?: number;
}

export type ConformanceProfile =
  | 'basic'          // Tools only
  | 'standard'       // Tools + Resources + Prompts
  | 'full'           // All features
  | 'edge'           // Edge-compatible subset (no long-running)
  | 'serverless'     // Serverless-compatible subset
  | 'auth'           // Auth-only scenarios
  | PlatformProfile;

interface PlatformProfile {
  platform: 'vercel' | 'cloudflare' | 'netlify' | 'aws-lambda';
  features: string[];
  excluded: string[];  // Scenarios known to not work on this platform
}
```

### 11.4 Platform-Specific Profiles

Different platforms have different capabilities. The conformance profiles encode what's testable where:

```typescript
// packages/conformance/src/profiles.ts

export const PROFILES: Record<string, PlatformProfile> = {
  vercel: {
    platform: 'vercel',
    features: ['tools', 'resources', 'prompts', 'auth', 'streaming'],
    excluded: [
      // Vercel Edge has 60s timeout — exclude long-running scenarios
      'tools-call-long-running',
      // No WebSocket support
      'transport-websocket',
    ],
  },

  cloudflare: {
    platform: 'cloudflare',
    features: ['tools', 'resources', 'prompts', 'auth', 'streaming', 'websocket'],
    excluded: [
      // Durable Objects have 30s subrequest limit
      'tools-call-external-timeout',
    ],
  },

  netlify: {
    platform: 'netlify',
    features: ['tools', 'resources', 'prompts', 'auth', 'streaming'],
    excluded: [
      // Netlify Functions have 26s timeout
      'tools-call-long-running',
      'transport-websocket',
    ],
  },

  'aws-lambda': {
    platform: 'aws-lambda',
    features: ['tools', 'resources', 'prompts', 'auth'],
    excluded: [
      // Lambda has response streaming but limited SSE
      'transport-sse-keepalive',
      'transport-websocket',
    ],
  },

  node: {
    platform: 'node' as any,
    features: ['tools', 'resources', 'prompts', 'auth', 'streaming', 'websocket', 'sampling'],
    excluded: [], // Full support
  },
};
```

### 11.5 Conformance Skill

```typescript
// skills/conformance/src/index.ts

export class ConformanceSkill {
  constructor(private config: ConformanceConfig = {}) {}

  async run(ctx: ProjectContext): Promise<ConformanceResult> {
    let serverUrl = this.config.serverUrl;
    let serverProcess: ChildProcess | null = null;

    // Auto-start server if needed
    if (!serverUrl && this.config.autoStart) {
      serverProcess = await this.startServer(this.config.autoStart);
      serverUrl = `http://localhost:${this.config.autoStart.port}/mcp`;
    }

    if (!serverUrl) {
      // Try to detect from project config
      serverUrl = await this.detectServerUrl(ctx);
    }

    try {
      // Detect platform profile
      const profile = this.config.profile
        ?? await this.detectProfile(ctx);

      // Get applicable scenarios
      const scenarios = this.getScenarios(profile);

      // Run official conformance suite
      const results = await this.runConformanceSuite(serverUrl, scenarios);

      // Generate report
      const report = this.generateReport(results, profile);

      return report;
    } finally {
      if (serverProcess) {
        serverProcess.kill();
      }
    }
  }

  private async runConformanceSuite(
    url: string,
    scenarios: string[]
  ): Promise<ScenarioResult[]> {
    const results: ScenarioResult[] = [];

    for (const scenario of scenarios) {
      try {
        // Shell out to official conformance CLI
        const result = await exec('npx', [
          '@modelcontextprotocol/conformance',
          'server',
          '--url', url,
          '--scenario', scenario,
          '--json',
        ], { timeout: this.config.timeout ?? 30000 });

        const checks = JSON.parse(
          await readFile(`results/${scenario}-*/checks.json`, 'utf-8')
        );

        results.push({
          scenario,
          passed: checks.every((c: any) => c.passed),
          checks,
          duration: Date.now(),
        });
      } catch (error) {
        results.push({
          scenario,
          passed: false,
          checks: [{ name: scenario, passed: false, message: String(error) }],
          duration: 0,
        });
      }
    }

    return results;
  }

  private generateReport(
    results: ScenarioResult[],
    profile: ConformanceProfile
  ): ConformanceResult {
    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;
    const total = results.length;

    return {
      passed: failed === 0,
      score: total > 0 ? Math.round((passed / total) * 100) : 0,
      summary: `${passed}/${total} scenarios passed`,
      profile: typeof profile === 'string' ? profile : profile.platform,
      results,
      timestamp: new Date().toISOString(),
    };
  }
}
```

### 11.6 In-Code Conformance Testing

```typescript
// In a vitest/jest test file
import { describe, it, expect } from 'vitest';
import { runConformance } from '@mcp/conformance-utils';
import { createMcpServer } from '@mcp/distributed-server';

describe('MCP Conformance', () => {
  it('passes all standard conformance scenarios', async () => {
    const server = createMcpServer({
      name: 'test-server',
      version: '1.0.0',
    });

    server.tool('echo', { message: 'string' }, async ({ message }) => ({
      content: [{ type: 'text', text: message }],
    }));

    const result = await runConformance({
      autoStart: {
        server,     // Pass server instance directly
        port: 0,    // Random available port
      },
      profile: 'standard',
      strict: true,
    });

    expect(result.passed).toBe(true);
    expect(result.score).toBe(100);
  }, 60000);
});
```

### 11.7 CI/CD Integration

#### GitHub Actions

```yaml
# .github/workflows/conformance.yml
name: MCP Conformance
on: [push, pull_request]

jobs:
  conformance:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        profile: [basic, standard, full, edge, serverless]
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - run: pnpm install && pnpm build

      - name: Run conformance tests
        run: |
          npx @mcp/skill-conformance \
            --profile ${{ matrix.profile }} \
            --reporter github-actions \
            --strict

      # Or use the community GitHub Action
      - uses: mcp-use/mcp-conformance-action@v1
        with:
          server-url: http://localhost:3000/mcp
          start-command: pnpm start
```

#### Post-Deploy Verification

```yaml
  verify-deployment:
    needs: [deploy]
    runs-on: ubuntu-latest
    steps:
      - name: Verify deployed server
        run: |
          npx @mcp/skill-conformance \
            --server-url ${{ needs.deploy.outputs.url }}/mcp \
            --profile ${{ needs.deploy.outputs.platform }} \
            --reporter github-actions
```

### 11.8 Conformance Badge

```markdown
<!-- In project README -->
[![MCP Conformance](https://img.shields.io/badge/MCP-conformant-green)](https://github.com/modelcontextprotocol/conformance)

<!-- Or with score -->
[![MCP Score](https://img.shields.io/badge/MCP_Score-100%25-brightgreen)]()
```

### 11.9 Additional Validation Tools

Beyond the official conformance suite, the library integrates with community tools:

| Tool | Purpose | Integration |
|------|---------|-------------|
| **MCP Inspector** | Interactive debugging | `npx @modelcontextprotocol/inspector --cli` for automated checks |
| **MCP Scan** | Security scanning | Pre-deploy security checks in skill pipeline |
| **mcp-validator** | Extended protocol validation | Additional scenarios beyond official suite |

---

## 12. Migration Path

### 12.1 Phase 1: Extract Core Interfaces

**Goal**: Define stable interfaces without breaking existing code

1. Create `src/lib/interfaces/` with all interface definitions
2. Refactor existing code to use interfaces internally
3. Keep all existing exports working
4. Add interface exports alongside existing exports

**Estimated Changes**: ~20 files, low risk

### 12.2 Phase 2: Implement Abstraction Layers

**Goal**: Create transport and storage abstractions

1. Create `InMemoryTransport` as default
2. Refactor `RedisTransport` to implement `ITransport`
3. Create `InMemoryStorage` as default
4. Refactor Redis storage to implement `IStorage`
5. Update handlers to use abstractions

**Estimated Changes**: ~15 files, medium risk

### 12.3 Phase 3: Create Builder API

**Goal**: Simple `createMcpServer()` API

1. Create `McpServerBuilder` class
2. Implement fluent API for configuration
3. Add `tool()`, `resource()`, `prompt()` helpers
4. Create HTTP framework adapters
5. Maintain backward compatibility with existing API

**Estimated Changes**: ~10 new files, low risk

### 12.4 Phase 4: Extract Packages into Workspace

**Goal**: Split into pnpm workspace monorepo

1. Set up pnpm workspaces + Turborepo
2. Move core to `packages/core/`
3. Move Redis implementations to `packages/transport-redis/` and `packages/storage-redis/`
4. Create platform packages in `platforms/`
5. Create skills in `skills/`
6. Set up Changesets for version management
7. Set up proper peer dependencies
8. Add package publishing workflow

**Estimated Changes**: Project restructure, medium risk

### 12.5 Phase 5: Cloud Provider Implementations

**Goal**: Native cloud provider support

1. Implement AWS packages (SQS, DynamoDB, Cognito)
2. Implement GCP packages (Pub/Sub, Firestore, Firebase Auth)
3. Implement Azure packages (Service Bus, CosmosDB, Azure AD)
4. Add integration tests for each provider
5. Create deployment guides

**Estimated Changes**: ~30 new files per provider, low risk (additive)

### 12.6 Phase 6: Edge & Serverless Platforms

**Goal**: First-class edge platform support

1. Implement Cloudflare Workers + Durable Objects platform
2. Implement Vercel + Upstash platform
3. Implement Netlify Functions platform
4. Create platform-specific conformance profiles
5. Add Upstash transport + storage packages

**Estimated Changes**: ~20 files per platform, low risk (additive)

### 12.7 Phase 7: Skills & Conformance

**Goal**: Deployment automation and validation

1. Create conformance-utils package wrapping official suite
2. Create deploy skill with per-platform implementations
3. Create scaffold skill with templates
4. Integrate conformance into CI/CD
5. Create GitHub Action for conformance

**Estimated Changes**: ~30 new files, low risk (additive)

---

## 13. Performance Considerations

### 13.1 Transport Latency Optimization

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

### 13.2 Storage Caching Layer

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

### 13.3 Horizontal Scaling

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

### 13.4 Edge Platform Considerations

| Platform | Constraint | Mitigation |
|----------|-----------|------------|
| Vercel Edge | 60s timeout, no TCP sockets | Upstash HTTP-based Redis, short-lived sessions |
| CF Workers | 128MB memory, 30s CPU time | Durable Objects for session state, Queues for overflow |
| Netlify Edge | 50ms CPU limit | Use Functions v2 (not Edge) for MCP |
| Lambda | Cold starts, 15min max | Provisioned concurrency, warm pools |

---

## 14. Security Considerations

### 14.1 Transport Security

- **Encryption in Transit**: All transports should support TLS
- **Message Signing**: Optional HMAC signing for message integrity
- **Access Control**: IAM roles for cloud transports
- **Edge**: Upstash REST API uses HTTPS; CF Workers use built-in TLS

### 14.2 Storage Security

- **Encryption at Rest**: All storage backends encrypt data
- **Key Management**: Integration with cloud KMS services (AWS KMS, GCP KMS, CF Secrets)
- **Access Control**: Least-privilege IAM policies
- **Edge**: Durable Object storage is encrypted at rest by Cloudflare

### 14.3 Authentication Security

- **Token Validation Caching**: Configurable cache duration
- **Rate Limiting**: Per-endpoint rate limits
- **PKCE Enforcement**: Required for public clients
- **Token Rotation**: Automatic refresh token rotation

### 14.4 Session Security

- **Session Isolation**: Users can only access their own sessions
- **Session Timeout**: Configurable inactivity timeout
- **Session Revocation**: Ability to invalidate all user sessions
- **Durable Objects**: Each session is its own isolated actor

### 14.5 Conformance as Security

- Run MCP conformance tests pre-deploy to catch protocol violations
- Use MCP Scan for security-specific vulnerability detection
- Conformance failures block deployment via skill pipeline

---

## 15. Implementation Roadmap

### Milestone 1: Core Library (v0.1.0)
- [ ] Define all core interfaces (ITransport, IStorage, IAuth)
- [ ] Implement InMemoryTransport
- [ ] Implement InMemoryStorage
- [ ] Create McpServerBuilder API
- [ ] Express adapter
- [ ] Basic documentation

### Milestone 2: Redis + Upstash Support (v0.2.0)
- [ ] RedisTransport (Pub/Sub + Streams)
- [ ] RedisStorage
- [ ] UpstashTransport (HTTP-based, edge-compatible)
- [ ] UpstashStorage
- [ ] Connection pooling and failover

### Milestone 3: Edge Platforms (v0.3.0)
- [ ] Cloudflare Workers + Durable Objects platform
- [ ] Vercel platform (Serverless + Edge adapters)
- [ ] Netlify platform (Functions v2 adapter)
- [ ] Platform-specific conformance profiles

### Milestone 4: Traditional Cloud Providers (v0.4.0)
- [ ] AWS: SQS + DynamoDB + Cognito + Lambda handler
- [ ] GCP: Pub/Sub + Firestore + Firebase Auth + Cloud Functions
- [ ] Azure: Service Bus + CosmosDB + Azure AD + Azure Functions

### Milestone 5: Skills & Conformance (v0.5.0)
- [ ] Conformance-utils package wrapping official suite
- [ ] Deploy skills (Vercel, Cloudflare, Netlify, Docker, AWS)
- [ ] Scaffold skill with platform templates
- [ ] GitHub Action for conformance testing
- [ ] MCP Scan integration for security checks

### Milestone 6: Workspace & DX (v0.6.0)
- [ ] pnpm workspace + Turborepo setup
- [ ] Changesets version management
- [ ] create-mcp-server CLI tool
- [ ] Platform-specific example projects

### Milestone 7: Production Ready (v1.0.0)
- [ ] Comprehensive test suite (unit + integration + e2e)
- [ ] Performance benchmarks per platform
- [ ] Security audit
- [ ] Full documentation site
- [ ] Conformance score 100% on all platforms

---

## Appendix A: Full API Reference

See separate API documentation (to be generated from TypeScript definitions).

## Appendix B: Platform Setup Guides

See separate deployment guides per platform in `docs/platform-guides/`.

## Appendix C: Performance Benchmarks

To be added after implementation.

## Appendix D: Conformance Scenario Reference

See [modelcontextprotocol/conformance](https://github.com/modelcontextprotocol/conformance) for the full list of available scenarios. Run `npx @modelcontextprotocol/conformance list --server` for the latest.

---

*Document Version: 2.0.0*
*Last Updated: 2026-03-13*
*Authors: Generated for MCP Feature Reference Server*
