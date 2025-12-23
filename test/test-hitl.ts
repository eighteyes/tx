#!/usr/bin/env npx tsx
/**
 * Manual HITL Test Script
 *
 * Run this to test HITL flow:
 * 1. Start core: npm run start
 * 2. In another terminal: npx tsx scripts/test-hitl.ts
 */

import fs from 'node:fs';
import path from 'node:path';

const msgsDir = path.join(process.cwd(), '.ai/tx/msgs');

// Ensure directory exists
fs.mkdirSync(msgsDir, { recursive: true });

// Create an ask-human message
const timestamp = new Date().toISOString();
const msgId = `test-${Date.now()}`;
const filename = `${Date.now()}-ask-human-test-worker--core-${msgId}.md`;

const content = `---
to: core/core
from: test/worker
type: ask-human
status: pending
msg-id: ${msgId}
headline: Test question from worker
timestamp: ${timestamp}
---

Hello! This is a test question from the worker.

**What would you like me to do?**

Please type your response and press Enter.

---
grade: A
confidence: 0.95
`;

const filepath = path.join(msgsDir, filename);
fs.writeFileSync(filepath, content);

console.log(`\n✓ Created ask-human message: ${filename}`);
console.log('\nIf core is running, you should see the question and be prompted for input.\n');
