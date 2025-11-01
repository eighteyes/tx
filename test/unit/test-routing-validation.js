#!/usr/bin/env node

/**
 * Test script for status-based routing validation
 */

const { PromptBuilder } = require('./lib/prompt-builder');
const { Queue } = require('./lib/queue');
const { Message } = require('./lib/message');

console.log('=== Testing Status-Based Routing System ===\n');

// Test 1: Generate status instructions for green-phase
console.log('Test 1: Generate status instructions for green-phase agent');
console.log('---');
const instructions = PromptBuilder._getStatusRoutingInstructions('tdd-cycle', 'green-phase');
console.log(instructions);
console.log('');

// Test 2: Validate correct routing
console.log('Test 2: Validate correct routing (status:complete → refactor-phase)');
console.log('---');
const validMessage = {
  metadata: {
    from: 'tdd-cycle-abc/green-phase',
    to: 'tdd-cycle-abc/refactor-phase',
    status: 'complete',
    type: 'task-complete'
  }
};
const validResult = Queue.validateRouting(validMessage, 'tdd-cycle', 'green-phase');
console.log('Result:', validResult);
console.log('Expected: { valid: true }');
console.log('✅ PASS:', validResult.valid === true);
console.log('');

// Test 3: Validate incorrect routing (wrong target for status)
console.log('Test 3: Validate incorrect routing (status:complete → red-phase)');
console.log('---');
const invalidMessage1 = {
  metadata: {
    from: 'tdd-cycle-abc/green-phase',
    to: 'tdd-cycle-abc/red-phase',
    status: 'complete',
    type: 'task-complete'
  }
};
const invalidResult1 = Queue.validateRouting(invalidMessage1, 'tdd-cycle', 'green-phase');
console.log('Result:', invalidResult1);
console.log('Expected: { valid: false, error: ... }');
console.log('✅ PASS:', invalidResult1.valid === false);
console.log('');

// Test 4: Validate unknown status
console.log('Test 4: Validate unknown status');
console.log('---');
const invalidMessage2 = {
  metadata: {
    from: 'tdd-cycle-abc/green-phase',
    to: 'tdd-cycle-abc/refactor-phase',
    status: 'unknown-status',
    type: 'task-complete'
  }
};
const invalidResult2 = Queue.validateRouting(invalidMessage2, 'tdd-cycle', 'green-phase');
console.log('Result:', invalidResult2);
console.log('Expected: { valid: false, error: ... }');
console.log('✅ PASS:', invalidResult2.valid === false);
console.log('');

// Test 5: Validate branching route (refactor-phase with multiple options)
console.log('Test 5: Validate branching routes for refactor-phase');
console.log('---');
const refactorInstructions = PromptBuilder._getStatusRoutingInstructions('tdd-cycle', 'refactor-phase');
console.log(refactorInstructions);
console.log('');

// Test 6: Validate correct branch choice
console.log('Test 6: Validate refactor-phase complete → core (valid branch)');
console.log('---');
const branchMessage1 = {
  metadata: {
    from: 'tdd-cycle-abc/refactor-phase',
    to: 'tdd-cycle-abc/core',
    status: 'complete',
    type: 'task-complete'
  }
};
const branchResult1 = Queue.validateRouting(branchMessage1, 'tdd-cycle', 'refactor-phase');
console.log('Result:', branchResult1);
console.log('✅ PASS:', branchResult1.valid === true);
console.log('');

// Test 7: Validate another valid branch choice
console.log('Test 7: Validate refactor-phase ready-for-next-iteration → red-phase (valid branch)');
console.log('---');
const branchMessage2 = {
  metadata: {
    from: 'tdd-cycle-abc/refactor-phase',
    to: 'tdd-cycle-abc/red-phase',
    status: 'ready-for-next-iteration',
    type: 'task'
  }
};
const branchResult2 = Queue.validateRouting(branchMessage2, 'tdd-cycle', 'refactor-phase');
console.log('Result:', branchResult2);
console.log('✅ PASS:', branchResult2.valid === true);
console.log('');

// Test 8: Test fan-out routing (code-review coordinator)
console.log('Test 8: Generate status instructions for code-review coordinator');
console.log('---');
const reviewInstructions = PromptBuilder._getStatusRoutingInstructions('code-review', 'coordinator');
console.log(reviewInstructions);
console.log('');

console.log('=== All Tests Complete ===');
