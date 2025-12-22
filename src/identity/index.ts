/**
 * Identity Management for TX
 *
 * Provides ed25519 keypair generation with BIP39 seed phrase recovery.
 * Keys are stored in ~/.tx/ directory.
 */

import { ed25519 } from '@noble/curves/ed25519.js';
import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { log } from '../shared/logger.ts';

// ============================================================================
// Types
// ============================================================================

export interface Identity {
  pubkey: string;         // Hex-encoded public key (32 bytes = 64 hex chars)
  address: string;        // Short identifier: txid_{first8chars}
  created: string;        // ISO timestamp
}

export interface IdentityWithKey extends Identity {
  privateKey: Buffer;     // 32-byte private key
}

export interface GeneratedIdentity extends IdentityWithKey {
  seed: string;           // 24-word mnemonic seed phrase
}

// ============================================================================
// Constants
// ============================================================================

const TX_DIR = path.join(os.homedir(), '.tx');
const IDENTITY_FILE = path.join(TX_DIR, 'identity.json');
const KEY_FILE = path.join(TX_DIR, 'identity.key');

// ============================================================================
// Key Generation
// ============================================================================

/**
 * Generate a new identity with a 24-word seed phrase
 */
export function generateIdentity(): GeneratedIdentity {
  // Generate 24-word mnemonic (256 bits of entropy)
  const mnemonic = generateMnemonic(wordlist, 256);

  // Derive keypair from seed
  const seed = mnemonicToSeedSync(mnemonic);
  const privateKey = seed.slice(0, 32);
  const publicKey = ed25519.getPublicKey(privateKey);

  const pubkeyHex = Buffer.from(publicKey).toString('hex');
  const address = `txid_${pubkeyHex.slice(0, 8)}`;

  return {
    pubkey: pubkeyHex,
    address,
    privateKey: Buffer.from(privateKey),
    seed: mnemonic,
    created: new Date().toISOString()
  };
}

/**
 * Recover identity from a seed phrase
 */
export function recoverFromSeed(seedPhrase: string): IdentityWithKey {
  const trimmed = seedPhrase.trim();

  if (!validateMnemonic(trimmed, wordlist)) {
    throw new Error('Invalid seed phrase. Must be 24 valid BIP39 words.');
  }

  const seed = mnemonicToSeedSync(trimmed);
  const privateKey = seed.slice(0, 32);
  const publicKey = ed25519.getPublicKey(privateKey);

  const pubkeyHex = Buffer.from(publicKey).toString('hex');
  const address = `txid_${pubkeyHex.slice(0, 8)}`;

  return {
    pubkey: pubkeyHex,
    address,
    privateKey: Buffer.from(privateKey),
    created: new Date().toISOString()
  };
}

// ============================================================================
// Storage
// ============================================================================

/**
 * Check if identity already exists
 */
export function hasIdentity(): boolean {
  return fs.existsSync(IDENTITY_FILE) && fs.existsSync(KEY_FILE);
}

/**
 * Save identity to ~/.tx/
 */
export function saveIdentity(identity: IdentityWithKey): void {
  // Create directory if needed
  if (!fs.existsSync(TX_DIR)) {
    fs.mkdirSync(TX_DIR, { recursive: true, mode: 0o700 });
  }

  // Save public identity info
  const publicIdentity: Identity = {
    pubkey: identity.pubkey,
    address: identity.address,
    created: identity.created
  };
  fs.writeFileSync(IDENTITY_FILE, JSON.stringify(publicIdentity, null, 2), { mode: 0o644 });

  // Save private key with restricted permissions
  fs.writeFileSync(KEY_FILE, identity.privateKey.toString('hex'), { mode: 0o600 });

  log.info('identity', 'Saved identity', { address: identity.address });
}

/**
 * Load identity from ~/.tx/
 * Returns null if no identity exists
 */
export function loadIdentity(): IdentityWithKey | null {
  if (!hasIdentity()) {
    return null;
  }

  try {
    // Check key file permissions
    const keyStats = fs.statSync(KEY_FILE);
    const permissions = keyStats.mode & 0o777;
    if (permissions !== 0o600) {
      log.warn('identity', 'Key file has insecure permissions', {
        path: KEY_FILE,
        permissions: permissions.toString(8),
        expected: '600'
      });
      // Continue anyway but warn
    }

    // Load public identity
    const publicData = JSON.parse(fs.readFileSync(IDENTITY_FILE, 'utf-8'));

    // Load private key
    const privateKeyHex = fs.readFileSync(KEY_FILE, 'utf-8').trim();
    const privateKey = Buffer.from(privateKeyHex, 'hex');

    return {
      pubkey: publicData.pubkey,
      address: publicData.address,
      created: publicData.created,
      privateKey
    };
  } catch (err) {
    log.error('identity', 'Failed to load identity', { error: (err as Error).message });
    return null;
  }
}

/**
 * Delete identity (for recovery purposes)
 */
export function deleteIdentity(): void {
  if (fs.existsSync(KEY_FILE)) {
    // Securely overwrite key file before deletion
    const size = fs.statSync(KEY_FILE).size;
    fs.writeFileSync(KEY_FILE, Buffer.alloc(size, 0));
    fs.unlinkSync(KEY_FILE);
  }

  if (fs.existsSync(IDENTITY_FILE)) {
    fs.unlinkSync(IDENTITY_FILE);
  }

  log.info('identity', 'Deleted identity');
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Get TX directory path
 */
export function getTxDir(): string {
  return TX_DIR;
}

/**
 * Sign data with private key
 */
export function sign(data: Uint8Array, privateKey: Buffer): Uint8Array {
  return ed25519.sign(data, privateKey);
}

/**
 * Verify signature
 */
export function verify(data: Uint8Array, signature: Uint8Array, pubkey: string): boolean {
  const pubkeyBytes = Buffer.from(pubkey, 'hex');
  return ed25519.verify(signature, data, pubkeyBytes);
}
