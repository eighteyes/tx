/**
 * logout.ts - Logout command
 *
 * One-line description: Clear stored credentials and optionally invalidate server-side tokens
 *
 * Responsibilities:
 * - Load existing credentials
 * - POST to tx-server /v1/auth/logout (if refresh token exists)
 * - Delete credentials file via credentials.ts
 * - Display confirmation message
 */

import { loadCredentials, clearCredentials, getServerUrl } from './credentials.ts';

/**
 * Logout from tx-server
 */
export async function logout(): Promise<void> {
  const creds = await loadCredentials();

  if (!creds) {
    console.log('Not logged in.');
    return;
  }

  const userEmail = creds.user.email;
  const serverUrl = creds.serverUrl || getServerUrl();

  // Attempt to invalidate refresh token on server
  // This is best-effort - we clear local credentials regardless
  if (creds.refreshToken) {
    try {
      await fetch(`${serverUrl}/v1/auth/logout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${creds.accessToken}`,
        },
        body: JSON.stringify({
          refreshToken: creds.refreshToken,
        }),
      });
      // Ignore response - we're logging out regardless
    } catch {
      // Ignore errors - network may be unavailable
      // Local credentials will still be cleared
    }
  }

  // Clear local credentials
  await clearCredentials();

  console.log(`✓ Logged out successfully.`);
  console.log(`  Credentials for ${userEmail} have been cleared.`);
}
