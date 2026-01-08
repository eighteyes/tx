/**
 * Storage Module
 *
 * Exports storage providers and factory function for tx-server.
 *
 * Responsibilities:
 * - Export StorageProvider interface and types
 * - Export LocalStorageProvider and RedisStorageProvider
 * - Provide factory function for provider instantiation
 */

export type {
  StorageProvider,
  StorageConfig,
  AgentMessage,
  QueueEntry,
  SessionState,
  MessageFilter,
  MessageEvent,
} from './interface.ts';

export { LocalStorageProvider } from './local-provider.ts';
export { RedisStorageProvider } from './redis-provider.ts';

import type { StorageProvider, StorageConfig } from './interface.ts';
import { LocalStorageProvider } from './local-provider.ts';
import { RedisStorageProvider } from './redis-provider.ts';

/**
 * Create a storage provider based on configuration
 */
export function createStorageProvider(config: StorageConfig): StorageProvider {
  switch (config.type) {
    case 'redis':
      return new RedisStorageProvider(config);
    case 'local':
    default:
      return new LocalStorageProvider(config);
  }
}

/**
 * Create storage provider from environment variables
 *
 * TX_STORAGE_TYPE: 'local' | 'redis' (default: 'local')
 * TX_REDIS_URL: Redis connection URL (default: 'redis://localhost:6379')
 * TX_REDIS_PREFIX: Key prefix (default: 'tx')
 * TX_BASE_DIR: Base directory for local storage (default: cwd)
 */
export function createStorageProviderFromEnv(): StorageProvider {
  const type = (process.env.TX_STORAGE_TYPE || 'local') as 'local' | 'redis';

  const config: StorageConfig = {
    type,
    baseDir: process.env.TX_BASE_DIR || process.cwd(),
    redisUrl: process.env.TX_REDIS_URL || 'redis://localhost:6379',
    redisPrefix: process.env.TX_REDIS_PREFIX || 'tx',
  };

  return createStorageProvider(config);
}
