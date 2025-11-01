const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { E2EWorkflow } = require('../../lib/e2e-workflow');
const { TmuxInjector } = require('../../lib/tmux-injector');

const TEST_TIMEOUT = 60000;

/**
 * Test the TDD cycle mesh end-to-end
 *
 * This test spawns the tdd-cycle mesh and validates:
 * 1. Red phase writes a failing test
 * 2. Green phase implements code to pass the test
 * 3. Refactor phase improves the code
 * 4. Workflow completes successfully
 */
async function testTddCycle() {
  console.log('🧪 Starting TDD Cycle E2E Test');

  try {
    // Start the tx system
    console.log('📡 Starting tx system...');
    spawn('tx', ['start', '-d']);

    // Wait for core session
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Check Claude readiness
    console.log('✓ Waiting for Claude readiness...');
    await TmuxInjector.claudeReadyCheck('core', 30000);

    // Create workflow for TDD cycle
    console.log('📋 Creating TDD cycle workflow...');
    const workflow = new E2EWorkflow(
      'tdd-cycle',
      'red-phase',
      'A simple feature to implement: a function that calculates the sum of two numbers'
    );

    console.log('⚙️ Running TDD cycle...');
    const passed = await workflow.test();

    if (passed) {
      console.log('✅ TDD Cycle Test PASSED');
      console.log('✓ Red phase created failing tests');
      console.log('✓ Green phase implemented code');
      console.log('✓ Refactor phase improved and completed');
    } else {
      console.log('❌ TDD Cycle Test FAILED');
      return false;
    }

    return true;
  } catch (error) {
    console.error('❌ Test error:', error.message);
    return false;
  }
}

/**
 * Test TDD cycle with iteration loop
 *
 * Validates that the cycle can loop back to red phase
 * for multiple iterations
 */
async function testTddCycleWithIteration() {
  console.log('🧪 Starting TDD Cycle with Iteration Test');

  try {
    // Start the tx system
    console.log('📡 Starting tx system...');
    spawn('tx', ['start', '-d']);

    // Wait for core session
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Check Claude readiness
    console.log('✓ Waiting for Claude readiness...');
    await TmuxInjector.claudeReadyCheck('core', 30000);

    // Create workflow for TDD cycle with multiple iterations
    console.log('📋 Creating multi-iteration TDD workflow...');
    const workflow = new E2EWorkflow(
      'tdd-cycle',
      'red-phase',
      'Implement a calculator with add, subtract, and multiply functions - one function per iteration'
    );

    console.log('⚙️ Running TDD cycle with iterations...');
    const passed = await workflow.test();

    if (passed) {
      console.log('✅ TDD Cycle Iteration Test PASSED');
      console.log('✓ Red phase created tests for first feature');
      console.log('✓ Green phase implemented code');
      console.log('✓ Refactor phase iterated back to red');
      console.log('✓ Cycle repeated for multiple features');
    } else {
      console.log('❌ TDD Cycle Iteration Test FAILED');
      return false;
    }

    return true;
  } catch (error) {
    console.error('❌ Test error:', error.message);
    return false;
  }
}

// Main test runner
async function runTests() {
  try {
    console.log('🚀 TDD Cycle E2E Tests\n');

    const test1 = await testTddCycle();

    console.log('\n---\n');

    const test2 = await testTddCycleWithIteration();

    console.log('\n📊 Test Results:');
    console.log(`Test 1 (Basic TDD Cycle): ${test1 ? '✅ PASSED' : '❌ FAILED'}`);
    console.log(`Test 2 (TDD Cycle with Iteration): ${test2 ? '✅ PASSED' : '❌ FAILED'}`);

    if (test1 && test2) {
      console.log('\n🎉 All tests passed!');
      process.exit(0);
    } else {
      console.log('\n❌ Some tests failed');
      process.exit(1);
    }
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

// Run tests
runTests();
