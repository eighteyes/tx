/**
 * credentials.ts - Credential management utilities
 *
 * One-line description: Manages authentication credentials for tx-server
 *
 * Responsibilities:
 * - Load/save credentials to ~/.tx/credentials.json
 * - Secure file permissions (0600)
 * - Token expiry checking and refresh
 * - Environment variable overrides
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/**
 * Stored credentials structure
 */
export interface Credentials {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;  // Unix timestamp (seconds)
  user: {
    id: string;
    email: string;
    name?: string;
  };
  serverUrl: string;
}

/**
 * Returns the path to the credentials file.
 * Respects TX_CREDENTIALS_PATH env var or defaults to ~/.tx/credentials.json
 */
export function getCredentialsPath(): string {
  if (process.env.TX_CREDENTIALS_PATH) {
    return process.env.TX_CREDENTIALS_PATH;
  }
  return path.join(os.homedir(), '.tx', 'credentials.json');
}

/**
 * Returns the tx-server URL.
 * Respects TX_SERVER_URL env var or defaults to https://api.tx.dev
 */
export function getServerUrl(): string {
  return process.env.TX_SERVER_URL || 'https://api.tx.dev';
}

/**
 * Load credentials from disk.
 * Returns null if credentials file doesn't exist or is invalid.
 */
export async function loadCredentials(): Promise<Credentials | null> {
  const credPath = getCredentialsPath();

  try {
    if (!fs.existsSync(credPath)) {
      return null;
    }

    const content = fs.readFileSync(credPath, 'utf-8');
    const creds = JSON.parse(content) as Credentials;

    // Basic validation
    if (!creds.accessToken || !creds.refreshToken || !creds.user) {
      return null;
    }

    return creds;
  } catch {
    return null;
  }
}

/**
 * Save credentials to disk with secure permissions (0600).
 * Creates the ~/.tx directory if it doesn't exist.
 */
export async function saveCredentials(creds: Credentials): Promise<void> {
  const credPath = getCredentialsPath();
  const dir = path.dirname(credPath);

  // Ensure directory exists
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  // Write credentials with secure permissions
  const content = JSON.stringify(creds, null, 2);
  fs.writeFileSync(credPath, content, { mode: 0o600 });
}

/**
 * Delete credentials file.
 */
export async function clearCredentials(): Promise<void> {
  const credPath = getCredentialsPath();

  if (fs.existsSync(credPath)) {
    fs.unlinkSync(credPath);
  }
}

/**
 * Check if the access token is expired.
 * Returns true if expired or will expire within 60 seconds.
 */
export function isTokenExpired(creds: Credentials): boolean {
  const now = Math.floor(Date.now() / 1000);
  const buffer = 60; // 60 second buffer before expiry
  return creds.expiresAt <= now + buffer;
}

/**
 * Refresh the access token using the refresh token.
 * Returns updated credentials with new access token.
 * Throws if refresh fails.
 */
export async function refreshAccessToken(creds: Credentials): Promise<Credentials> {
  const serverUrl = creds.serverUrl || getServerUrl();

  const response = await fetch(`${serverUrl}/v1/auth/refresh`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      refreshToken: creds.refreshToken,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw new Error(`Token refresh failed: ${response.status} - ${errorText}`);
  }

  const data = await response.json() as {
    accessToken: string;
    refreshToken?: string;
    expiresAt: number | string;
  };

  // Server returns expiresAt as ISO string, convert to Unix timestamp
  const expiresAt = typeof data.expiresAt === 'string'
    ? Math.floor(new Date(data.expiresAt).getTime() / 1000)
    : data.expiresAt;

  const updatedCreds: Credentials = {
    ...creds,
    accessToken: data.accessToken,
    refreshToken: data.refreshToken || creds.refreshToken,
    expiresAt,
  };

  // Save updated credentials
  await saveCredentials(updatedCreds);

  return updatedCreds;
}

/**
 * Get valid credentials, refreshing if needed.
 * Returns null if not logged in.
 * Throws if refresh fails.
 */
export async function getValidCredentials(): Promise<Credentials | null> {
  const creds = await loadCredentials();

  if (!creds) {
    return null;
  }

  if (isTokenExpired(creds)) {
    return await refreshAccessToken(creds);
  }

  return creds;
}
