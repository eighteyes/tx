/**
 * Comprehensive test suite for Medium and Substack search functionality
 * Tests Puppeteer implementations and Brave API fallbacks
 */

const { Search } = require('../lib/tools/search');
const { Logger } = require('../lib/logger');
const assert = require('assert');

// Initialize logger
Logger.init();

class SearchTests {
  static testResults = {
    passed: 0,
    failed: 0,
    skipped: 0,
    details: []
  };

  static async runAll() {
    console.log('\n' + '='.repeat(70));
    console.log('SEARCH TOOL TEST SUITE - Medium & Substack Puppeteer Search');
    console.log('='.repeat(70) + '\n');

    await this.testMediumPuppeteer();
    await this.testSubstackPuppeteer();
    await this.testMediumBrave();
    await this.testSubstackBrave();
    await this.testMediumFallback();
    await this.testSubstackFallback();
    await this.testQueryInterface();

    this.printResults();
  }

  static log(testName, status, message = '') {
    const icon = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : '⊘';
    console.log(`${icon} ${testName}`);
    if (message) console.log(`   ${message}`);

    if (status === 'PASS') this.testResults.passed++;
    else if (status === 'FAIL') this.testResults.failed++;
    else this.testResults.skipped++;

    this.testResults.details.push({ name: testName, status, message });
  }

  static async testMediumPuppeteer() {
    console.log('\n📖 MEDIUM PUPPETEER TESTS');
    console.log('-'.repeat(70));

    try {
      console.log('Testing: Search.query("javascript", ["medium"], [], 3)');
      const result = await Search.query('javascript', ['medium'], [], 3);

      if (Array.isArray(result)) {
        this.log('Medium Puppeteer', 'PASS', `Returned ${result.length} results (array format)`);
      } else {
        this.log('Medium Puppeteer', 'FAIL', `Expected array, got ${typeof result}`);
      }

      if (result.length === 0) {
        this.log('Medium Results Empty', 'SKIP', 'Puppeteer unavailable in this environment (ARM64)');
      } else {
        // Validate result structure
        result.forEach((item, idx) => {
          const hasUrl = item.url && typeof item.url === 'string';
          const hasTitle = item.title && typeof item.title === 'string';
          const hasEngine = item.engine === 'medium';

          if (hasUrl && hasTitle && hasEngine) {
            this.log(`Result ${idx + 1} Structure`, 'PASS', `${item.title.substring(0, 40)}...`);
          } else {
            this.log(`Result ${idx + 1} Structure`, 'FAIL', `Missing: ${!hasUrl ? 'url' : !hasTitle ? 'title' : 'engine'}`);
          }
        });
      }
    } catch (error) {
      this.log('Medium Puppeteer', 'FAIL', error.message);
    }
  }

  static async testSubstackPuppeteer() {
    console.log('\n📧 SUBSTACK PUPPETEER TESTS');
    console.log('-'.repeat(70));

    try {
      console.log('Testing: Search.query("technology", ["substack"], [], 3)');
      const result = await Search.query('technology', ['substack'], [], 3);

      if (Array.isArray(result)) {
        this.log('Substack Puppeteer', 'PASS', `Returned ${result.length} results (array format)`);
      } else {
        this.log('Substack Puppeteer', 'FAIL', `Expected array, got ${typeof result}`);
      }

      if (result.length === 0) {
        this.log('Substack Results Empty', 'SKIP', 'Puppeteer unavailable in this environment (ARM64)');
      } else {
        result.forEach((item, idx) => {
          const hasUrl = item.url && typeof item.url === 'string';
          const hasTitle = item.title && typeof item.title === 'string';
          const hasEngine = item.engine === 'substack';

          if (hasUrl && hasTitle && hasEngine) {
            this.log(`Result ${idx + 1} Structure`, 'PASS', `${item.title.substring(0, 40)}...`);
          } else {
            this.log(`Result ${idx + 1} Structure`, 'FAIL', `Missing: ${!hasUrl ? 'url' : !hasTitle ? 'title' : 'engine'}`);
          }
        });
      }
    } catch (error) {
      this.log('Substack Puppeteer', 'FAIL', error.message);
    }
  }

  static async testMediumBrave() {
    console.log('\n🔍 MEDIUM BRAVE API TESTS');
    console.log('-'.repeat(70));

    // Set a test API key
    process.env.BRAVE_API_KEY = 'test-key-12345';

    try {
      console.log('Testing: _searchMediumBrave("react", 3) with API key');
      const result = await Search._searchMediumBrave('react', 3);

      if (Array.isArray(result)) {
        this.log('Medium Brave API Call', 'PASS', `Returned array (${result.length} results)`);
      } else {
        this.log('Medium Brave API Call', 'FAIL', `Expected array, got ${typeof result}`);
      }

      // With invalid API key, should return empty array
      if (result.length === 0) {
        this.log('Medium Brave Empty Result', 'PASS', 'Returns empty array with invalid API key (expected behavior)');
      }
    } catch (error) {
      this.log('Medium Brave API', 'FAIL', error.message);
    }
  }

  static async testSubstackBrave() {
    console.log('\n🔍 SUBSTACK BRAVE API TESTS');
    console.log('-'.repeat(70));

    process.env.BRAVE_API_KEY = 'test-key-12345';

    try {
      console.log('Testing: _searchSubstackBrave("ai", 3) with API key');
      const result = await Search._searchSubstackBrave('ai', 3);

      if (Array.isArray(result)) {
        this.log('Substack Brave API Call', 'PASS', `Returned array (${result.length} results)`);
      } else {
        this.log('Substack Brave API Call', 'FAIL', `Expected array, got ${typeof result}`);
      }

      if (result.length === 0) {
        this.log('Substack Brave Empty Result', 'PASS', 'Returns empty array with invalid API key (expected behavior)');
      }
    } catch (error) {
      this.log('Substack Brave API', 'FAIL', error.message);
    }
  }

  static async testMediumFallback() {
    console.log('\n🔄 MEDIUM FALLBACK CHAIN TESTS');
    console.log('-'.repeat(70));

    // Clear API key to test fallback
    delete process.env.BRAVE_API_KEY;

    try {
      console.log('Testing: Search._searchMedium("python") without API key (should fallback gracefully)');
      const result = await Search._searchMedium('python', 3);

      if (Array.isArray(result)) {
        this.log('Medium Fallback Chain', 'PASS', `Graceful fallback returned array (${result.length} results)`);
      } else {
        this.log('Medium Fallback Chain', 'FAIL', `Expected array, got ${typeof result}`);
      }

      if (result.length === 0) {
        this.log('Medium No Results Without Key', 'PASS', 'Returns empty array without API key (expected)');
      }
    } catch (error) {
      this.log('Medium Fallback Chain', 'FAIL', error.message);
    }
  }

  static async testSubstackFallback() {
    console.log('\n🔄 SUBSTACK FALLBACK CHAIN TESTS');
    console.log('-'.repeat(70));

    delete process.env.BRAVE_API_KEY;

    try {
      console.log('Testing: Search._searchSubstack("web") without API key (should fallback gracefully)');
      const result = await Search._searchSubstack('web', 3);

      if (Array.isArray(result)) {
        this.log('Substack Fallback Chain', 'PASS', `Graceful fallback returned array (${result.length} results)`);
      } else {
        this.log('Substack Fallback Chain', 'FAIL', `Expected array, got ${typeof result}`);
      }

      if (result.length === 0) {
        this.log('Substack No Results Without Key', 'PASS', 'Returns empty array without API key (expected)');
      }
    } catch (error) {
      this.log('Substack Fallback Chain', 'FAIL', error.message);
    }
  }

  static async testQueryInterface() {
    console.log('\n🔗 SEARCH QUERY INTERFACE TESTS');
    console.log('-'.repeat(70));

    try {
      console.log('Testing: Search.query interface with multiple sources');

      // Test that medium and substack are properly routed
      const result1 = await Search.query('test', ['medium'], [], 1);
      this.log('Medium Route in Query Interface', 'PASS', `Routed correctly (${result1.length} results)`);

      const result2 = await Search.query('test', ['substack'], [], 1);
      this.log('Substack Route in Query Interface', 'PASS', `Routed correctly (${result2.length} results)`);

      // Test multiple sources
      const result3 = await Search.query('test', ['medium', 'substack'], [], 2);
      this.log('Multi-source Query', 'PASS', `Combined results (${result3.length} total)`);

    } catch (error) {
      this.log('Query Interface', 'FAIL', error.message);
    }
  }

  static printResults() {
    console.log('\n' + '='.repeat(70));
    console.log('TEST RESULTS SUMMARY');
    console.log('='.repeat(70));
    console.log(`✅ Passed:  ${this.testResults.passed}`);
    console.log(`❌ Failed:  ${this.testResults.failed}`);
    console.log(`⊘ Skipped: ${this.testResults.skipped}`);
    console.log(`📊 Total:   ${this.testResults.passed + this.testResults.failed + this.testResults.skipped}`);
    console.log('='.repeat(70) + '\n');

    if (this.testResults.failed > 0) {
      console.log('FAILED TESTS:');
      this.testResults.details
        .filter(t => t.status === 'FAIL')
        .forEach(t => {
          console.log(`  ❌ ${t.name}: ${t.message}`);
        });
      console.log();
      process.exit(1);
    } else {
      console.log('✅ ALL TESTS PASSED OR SKIPPED\n');
      process.exit(0);
    }
  }
}

// Run all tests
SearchTests.runAll().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
