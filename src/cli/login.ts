/**
 * login.ts - Login command
 *
 * One-line description: Authenticate with tx-server and save credentials
 *
 * Responsibilities:
 * - Prompt for email/password (or accept flags)
 * - POST to tx-server /v1/auth/login
 * - Save tokens via credentials.ts
 * - Display success/failure message
 */

import * as readline from 'node:readline';
import { saveCredentials, getServerUrl, loadCredentials, type Credentials } from './credentials.ts';

export interface LoginOptions {
  email?: string;
  password?: string;
  server?: string;
}

interface LoginResponse {
  tokens: {
    accessToken: string;
    refreshToken: string;
    expiresAt: string;  // Server returns ISO string
  };
  user: {
    id: string;
    email: string;
    name?: string;
  };
  organization?: {
    id: string;
    name: string;
    slug: string;
  };
}

/**
 * Prompt for input with optional hidden mode for passwords
 */
async function promptInput(prompt: string, hidden = false): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    // For hidden input (password), we need to handle it specially
    if (hidden && process.stdin.isTTY) {
      process.stdout.write(prompt);

      // Disable echo for password input
      const stdin = process.stdin;
      if (stdin.setRawMode) {
        stdin.setRawMode(true);
      }

      let password = '';

      const restoreTerminal = () => {
        stdin.removeListener('data', onData);
        if (stdin.setRawMode) {
          stdin.setRawMode(false);
        }
      };

      const onData = (char: Buffer) => {
        try {
          const c = char.toString();

          if (c === '\n' || c === '\r') {
            // Enter pressed
            restoreTerminal();
            process.stdout.write('\n');
            rl.close();
            resolve(password);
          } else if (c === '\u0003') {
            // Ctrl+C
            restoreTerminal();
            process.exit(1);
          } else if (c === '\u007F' || c === '\b') {
            // Backspace
            if (password.length > 0) {
              password = password.slice(0, -1);
            }
          } else {
            password += c;
          }
        } catch {
          restoreTerminal();
        }
      };

      stdin.on('data', onData);
    } else {
      // Non-TTY or non-hidden: use normal readline
      rl.question(prompt, (answer) => {
        rl.close();
        resolve(answer);
      });
    }
  });
}

/**
 * Login to tx-server
 */
export async function login(options: LoginOptions = {}): Promise<void> {
  const serverUrl = options.server || getServerUrl();

  // Check if already logged in
  const existing = await loadCredentials();
  if (existing) {
    console.log(`Already logged in as ${existing.user.email}`);
    console.log('Use "tx logout" first to switch accounts.');
    return;
  }

  // Get email
  let email = options.email;
  if (!email) {
    email = await promptInput('Email: ');
    if (!email.trim()) {
      console.error('Error: Email is required');
      process.exit(1);
    }
  }

  // Get password
  let password = options.password;
  if (!password) {
    password = await promptInput('Password: ', true);
    if (!password) {
      console.error('Error: Password is required');
      process.exit(1);
    }
  }

  // Call login API
  console.log('\nAuthenticating...');

  try {
    const response = await fetch(`${serverUrl}/v1/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, password }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({})) as { error?: string };
      const errorMsg = errorData.error || `HTTP ${response.status}`;
      console.error(`\nLogin failed: ${errorMsg}`);
      process.exit(1);
    }

    const data = await response.json() as LoginResponse;

    // Save credentials
    // Server returns expiresAt as ISO string, convert to Unix timestamp
    const expiresAt = Math.floor(new Date(data.tokens.expiresAt).getTime() / 1000);

    const creds: Credentials = {
      accessToken: data.tokens.accessToken,
      refreshToken: data.tokens.refreshToken,
      expiresAt,
      user: data.user,
      serverUrl,
    };

    await saveCredentials(creds);

    // Print success
    printLoginResult(true, data.user);
  } catch (error) {
    if (error instanceof Error && error.message.includes('fetch')) {
      console.error(`\nLogin failed: Unable to connect to ${serverUrl}`);
      console.error('Check your network connection and TX_SERVER_URL setting.');
    } else {
      console.error(`\nLogin failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    process.exit(1);
  }
}

/**
 * Print login result
 */
export function printLoginResult(success: boolean, user?: { email: string; name?: string }): void {
  if (success && user) {
    console.log('\n✓ Login successful!');
    if (user.name) {
      console.log(`  Welcome, ${user.name} (${user.email})`);
    } else {
      console.log(`  Welcome, ${user.email}`);
    }
    console.log('\nCredentials saved. You can now use "tx deploy" to deploy meshes.');
  } else {
    console.log('\n✗ Login failed');
  }
}
