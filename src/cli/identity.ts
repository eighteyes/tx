/**
 * TX Identity CLI Commands
 *
 * tx init       - Create new identity (shows seed phrase)
 * tx identity   - Show current identity
 */

import {
  generateIdentity,
  recoverFromSeed,
  saveIdentity,
  loadIdentity,
  hasIdentity,
  deleteIdentity,
  getTxDir
} from '../identity/index.ts';

export interface InitOptions {
  recover?: boolean;
  force?: boolean;
}

/**
 * Initialize a new TX identity
 */
export async function init(options: InitOptions = {}): Promise<void> {
  // Check if identity already exists
  if (hasIdentity() && !options.force) {
    console.log('\n  Identity already exists!\n');
    console.log('  Use --force to overwrite (this will require re-entering seed phrase)');
    console.log('  Or use: tx identity to view current identity\n');
    return;
  }

  if (options.recover) {
    await recoverIdentity();
  } else {
    await createNewIdentity(options.force);
  }
}

/**
 * Create a new identity with seed phrase
 */
async function createNewIdentity(force: boolean = false): Promise<void> {
  if (force) {
    console.log('\n  Overwriting existing identity...\n');
    deleteIdentity();
  }

  console.log('\n  Generating new TX identity...\n');

  const identity = generateIdentity();
  saveIdentity(identity);

  console.log('  Your TX Identity');
  console.log('  ================\n');
  console.log(`  Address:  ${identity.address}`);
  console.log(`  Pubkey:   ${identity.pubkey}`);
  console.log(`  Storage:  ${getTxDir()}/\n`);

  console.log('  Recovery Seed Phrase (24 words)');
  console.log('  ================================\n');

  // Display seed phrase in a clear, copyable format
  const words = identity.seed.split(' ');
  for (let i = 0; i < words.length; i += 6) {
    const line = words.slice(i, i + 6)
      .map((w, j) => `${(i + j + 1).toString().padStart(2)} ${w}`)
      .join('  ');
    console.log(`  ${line}`);
  }

  console.log('\n  IMPORTANT: Write this down and store it securely!');
  console.log('  This is the ONLY way to recover your identity.\n');
}

/**
 * Recover identity from seed phrase
 */
async function recoverIdentity(): Promise<void> {
  console.log('\n  Recovering identity from seed phrase...\n');
  console.log('  Enter your 24-word seed phrase (all on one line):');

  // Read seed phrase from stdin
  const seedPhrase = await readLine();

  try {
    const identity = recoverFromSeed(seedPhrase);

    // Check if this overwrites an existing identity
    if (hasIdentity()) {
      const existing = loadIdentity();
      if (existing && existing.pubkey !== identity.pubkey) {
        console.log('\n  WARNING: This will replace your current identity!\n');
        console.log(`  Current: ${existing.address}`);
        console.log(`  New:     ${identity.address}\n`);
        console.log('  Continue? [y/N] ');
        const confirm = await readLine();
        if (confirm.toLowerCase() !== 'y') {
          console.log('\n  Aborted.\n');
          return;
        }
        deleteIdentity();
      }
    }

    saveIdentity(identity);

    console.log('\n  Identity recovered successfully!\n');
    console.log(`  Address:  ${identity.address}`);
    console.log(`  Pubkey:   ${identity.pubkey}\n`);
  } catch (err) {
    console.error(`\n  Error: ${(err as Error).message}\n`);
    process.exit(1);
  }
}

/**
 * Show current identity
 */
export async function identity(): Promise<void> {
  const id = loadIdentity();

  if (!id) {
    console.log('\n  No identity found.\n');
    console.log('  Run: tx init\n');
    return;
  }

  console.log('\n  Your TX Identity');
  console.log('  ================\n');
  console.log(`  Address:  ${id.address}`);
  console.log(`  Pubkey:   ${id.pubkey}`);
  console.log(`  Created:  ${id.created}`);
  console.log(`  Storage:  ${getTxDir()}/\n`);
}

/**
 * Read a line from stdin
 */
function readLine(): Promise<string> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const stdout = process.stdout;

    stdin.setEncoding('utf8');
    stdin.once('data', (data: string) => {
      resolve(data.trim());
    });

    // In case stdin is already closed
    stdin.once('end', () => {
      resolve('');
    });

    stdout.write('  > ');
    stdin.resume();
  });
}
