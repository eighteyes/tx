#!/usr/bin/env node

/**
 * E2E Test Suite Runner
 *
 * Runs all E2E tests sequentially to avoid session conflicts.
 * Provides detailed reporting and summary statistics.
 */

const { execSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// Configuration
const E2E_TIMEOUT = 180000; // 3 minutes per test
const CLEANUP_DELAY = 2000; // 2 seconds between tests for cleanup

// ANSI colors
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

// Test results
const results = {
  passed: [],
  failed: [],
  skipped: [],
  duration: {}
};

/**
 * Find all E2E test files
 */
function findE2ETests() {
  const testDir = path.join(__dirname);
  const files = fs.readdirSync(testDir);

  return files
    .filter(file => file.startsWith('test-e2e-') && file.endsWith('.js'))
    .filter(file => file !== 'test-e2e-template.js') // Skip template
    .sort() // Run in alphabetical order
    .map(file => path.join(testDir, file));
}

/**
 * Run a single E2E test
 */
async function runTest(testPath, testNumber, totalTests) {
  const testName = path.basename(testPath, '.js');
  const startTime = Date.now();

  console.log(`\n${colors.bright}${'='.repeat(80)}${colors.reset}`);
  console.log(`${colors.cyan}Test ${testNumber}/${totalTests}: ${testName}${colors.reset}`);
  console.log(`${colors.bright}${'='.repeat(80)}${colors.reset}\n`);

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      console.log(`\n${colors.red}⏱️  Test timeout after ${E2E_TIMEOUT}ms${colors.reset}`);
      testProcess.kill();
      const duration = Date.now() - startTime;
      results.failed.push(testName);
      results.duration[testName] = duration;
      resolve(false);
    }, E2E_TIMEOUT);

    const testProcess = spawn('node', [testPath], {
      cwd: process.cwd(),
      stdio: 'inherit',
      env: { ...process.env, NODE_ENV: 'test' }
    });

    testProcess.on('close', (code) => {
      clearTimeout(timeout);
      const duration = Date.now() - startTime;
      results.duration[testName] = duration;

      if (code === 0) {
        console.log(`\n${colors.green}✅ ${testName} PASSED (${duration}ms)${colors.reset}`);
        results.passed.push(testName);
        resolve(true);
      } else {
        console.log(`\n${colors.red}❌ ${testName} FAILED (${duration}ms)${colors.reset}`);
        results.failed.push(testName);
        resolve(false);
      }
    });

    testProcess.on('error', (error) => {
      clearTimeout(timeout);
      const duration = Date.now() - startTime;
      results.duration[testName] = duration;
      console.error(`\n${colors.red}❌ ${testName} ERROR: ${error.message}${colors.reset}`);
      results.failed.push(testName);
      resolve(false);
    });
  });
}

/**
 * Cleanup between tests
 */
async function cleanupBetweenTests() {
  console.log(`\n${colors.yellow}🧹 Cleaning up between tests...${colors.reset}`);

  // Stop any running tx instances
  try {
    execSync('tx stop', { stdio: 'pipe' });
  } catch (e) {
    // Ignore - may not be running
  }

  // Kill any remaining tmux sessions with test prefixes
  try {
    const sessions = execSync('tmux ls -F "#{session_name}" 2>/dev/null || true', {
      encoding: 'utf8'
    }).trim().split('\n').filter(Boolean);

    const testSessions = sessions.filter(s =>
      s.startsWith('test-') ||
      s.startsWith('core') ||
      s.includes('-test-')
    );

    for (const session of testSessions) {
      try {
        execSync(`tmux kill-session -t "${session}"`, { stdio: 'pipe' });
        console.log(`   Killed session: ${session}`);
      } catch (e) {
        // Ignore
      }
    }
  } catch (e) {
    // Ignore
  }

  // Wait for cleanup to settle
  await new Promise(resolve => setTimeout(resolve, CLEANUP_DELAY));
  console.log(`${colors.green}✅ Cleanup complete${colors.reset}\n`);
}

/**
 * Print summary report
 */
function printSummary(totalDuration) {
  console.log(`\n\n${colors.bright}${'='.repeat(80)}${colors.reset}`);
  console.log(`${colors.bright}${colors.cyan}E2E Test Suite Summary${colors.reset}`);
  console.log(`${colors.bright}${'='.repeat(80)}${colors.reset}\n`);

  const total = results.passed.length + results.failed.length + results.skipped.length;

  console.log(`${colors.green}✅ Passed: ${results.passed.length}/${total}${colors.reset}`);
  console.log(`${colors.red}❌ Failed: ${results.failed.length}/${total}${colors.reset}`);
  console.log(`${colors.yellow}⊘  Skipped: ${results.skipped.length}/${total}${colors.reset}`);
  console.log(`⏱️  Total Duration: ${formatDuration(totalDuration)}\n`);

  if (results.passed.length > 0) {
    console.log(`${colors.green}Passed Tests:${colors.reset}`);
    results.passed.forEach(test => {
      console.log(`  ✅ ${test} (${formatDuration(results.duration[test])})`);
    });
    console.log();
  }

  if (results.failed.length > 0) {
    console.log(`${colors.red}Failed Tests:${colors.reset}`);
    results.failed.forEach(test => {
      console.log(`  ❌ ${test} (${formatDuration(results.duration[test])})`);
    });
    console.log();
  }

  if (results.skipped.length > 0) {
    console.log(`${colors.yellow}Skipped Tests:${colors.reset}`);
    results.skipped.forEach(test => {
      console.log(`  ⊘  ${test}`);
    });
    console.log();
  }

  console.log(`${colors.bright}${'='.repeat(80)}${colors.reset}\n`);

  // Overall result
  if (results.failed.length === 0 && results.passed.length > 0) {
    console.log(`${colors.bright}${colors.green}🎉 ALL TESTS PASSED! 🎉${colors.reset}\n`);
    return 0;
  } else if (results.failed.length > 0) {
    console.log(`${colors.bright}${colors.red}💥 SOME TESTS FAILED 💥${colors.reset}\n`);
    return 1;
  } else {
    console.log(`${colors.yellow}⚠️  NO TESTS RUN${colors.reset}\n`);
    return 1;
  }
}

/**
 * Format duration in human-readable format
 */
function formatDuration(ms) {
  if (ms < 1000) {
    return `${ms}ms`;
  } else if (ms < 60000) {
    return `${(ms / 1000).toFixed(2)}s`;
  } else {
    const minutes = Math.floor(ms / 60000);
    const seconds = ((ms % 60000) / 1000).toFixed(0);
    return `${minutes}m ${seconds}s`;
  }
}

/**
 * Main test runner
 */
async function runAllTests() {
  const suiteStartTime = Date.now();

  console.log(`${colors.bright}${colors.blue}
╔════════════════════════════════════════════════════════════════════════════╗
║                         TX E2E Test Suite Runner                           ║
╚════════════════════════════════════════════════════════════════════════════╝
${colors.reset}`);

  // Find all tests
  const tests = findE2ETests();
  console.log(`${colors.cyan}Found ${tests.length} E2E tests${colors.reset}\n`);

  if (tests.length === 0) {
    console.log(`${colors.yellow}⚠️  No E2E tests found${colors.reset}\n`);
    return 1;
  }

  // List all tests
  console.log(`${colors.cyan}Tests to run:${colors.reset}`);
  tests.forEach((test, i) => {
    console.log(`  ${i + 1}. ${path.basename(test, '.js')}`);
  });
  console.log();

  // Run each test sequentially
  for (let i = 0; i < tests.length; i++) {
    const testPath = tests[i];
    const success = await runTest(testPath, i + 1, tests.length);

    // Cleanup between tests (except after last test)
    if (i < tests.length - 1) {
      await cleanupBetweenTests();
    }
  }

  // Final cleanup
  console.log(`\n${colors.yellow}🧹 Final cleanup...${colors.reset}`);
  await cleanupBetweenTests();

  // Print summary
  const totalDuration = Date.now() - suiteStartTime;
  const exitCode = printSummary(totalDuration);

  return exitCode;
}

// Handle uncaught errors
process.on('unhandledRejection', (error) => {
  console.error(`\n${colors.red}Unhandled rejection:${colors.reset}`, error);
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  console.error(`\n${colors.red}Uncaught exception:${colors.reset}`, error);
  process.exit(1);
});

// Run tests
runAllTests()
  .then(exitCode => {
    process.exit(exitCode);
  })
  .catch(error => {
    console.error(`\n${colors.red}Test runner error:${colors.reset}`, error);
    process.exit(1);
  });
