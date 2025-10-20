#!/usr/bin/env node

/**
 * Example Script
 *
 * Demonstrates a skill script that can be executed by agents.
 * Scripts are useful for deterministic, repeatable tasks.
 *
 * Usage: node scripts/example-script.js --input "value"
 */

const fs = require('fs');
const path = require('path');

function main() {
  const args = process.argv.slice(2);
  const inputIndex = args.indexOf('--input');

  if (inputIndex === -1) {
    console.error('Error: --input flag required');
    process.exit(1);
  }

  const input = args[inputIndex + 1];

  if (!input) {
    console.error('Error: --input value required');
    process.exit(1);
  }

  // Example: Process the input
  const result = {
    input,
    processed: input.toUpperCase(),
    timestamp: new Date().toISOString(),
    status: 'success'
  };

  console.log(JSON.stringify(result, null, 2));
}

main();
