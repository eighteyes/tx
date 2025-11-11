const fs = require('fs-extra');
const path = require('path');

const INDEX_FILE = 'meshes/patterns/index.json';

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  white: '\x1b[37m'
};

const c = (color, text) => `${colors[color]}${text}${colors.reset}`;

/**
 * Load pattern index
 */
function loadIndex() {
  if (!fs.existsSync(INDEX_FILE)) {
    throw new Error('Pattern index not found. Run: node scripts/build-pattern-index.js');
  }
  return fs.readJsonSync(INDEX_FILE);
}

/**
 * Get a specific pattern by ID
 */
async function getPattern(patternId) {
  const index = loadIndex();
  const pattern = index.patterns[patternId];

  if (!pattern) {
    console.error(c('red', `❌ Pattern not found: ${patternId}\n`));
    console.log('Available patterns:');
    Object.keys(index.patterns).forEach(id => {
      console.log(`  - ${id}`);
    });
    process.exit(1);
  }

  // Read pattern file
  const content = await fs.readFile(pattern.file, 'utf-8');

  // Strip frontmatter for display
  const withoutFrontmatter = content.replace(/^---\n[\s\S]*?\n---\n/, '');

  return {
    ...pattern,
    content: withoutFrontmatter
  };
}

/**
 * List all patterns
 */
async function listPatterns(options = {}) {
  const index = loadIndex();

  console.log(c('bold', '\n📚 Available Patterns\n'));
  console.log(`Total: ${index.totalPatterns} patterns\n`);

  // Group by category
  Object.entries(index.categories).forEach(([category, patternIds]) => {
    console.log(c('bold', `${category.toUpperCase()}`));

    patternIds.forEach(id => {
      const pattern = index.patterns[id];
      const complexityColor = {
        basic: 'green',
        intermediate: 'yellow',
        advanced: 'red'
      }[pattern.complexity] || 'white';

      console.log(`  ${c(complexityColor, '●')} ${c('cyan', id)}`);
      console.log(`    ${c('dim', pattern.title)}`);
      if (pattern.when) {
        console.log(`    ${c('dim', pattern.when)}`);
      }
      console.log();
    });
  });
}

/**
 * Search patterns by keyword
 */
async function searchPatterns(keyword) {
  const index = loadIndex();
  const results = [];

  Object.values(index.patterns).forEach(pattern => {
    const searchText = [
      pattern.id,
      pattern.title,
      pattern.when,
      ...pattern.tags
    ].join(' ').toLowerCase();

    if (searchText.includes(keyword.toLowerCase())) {
      results.push(pattern);
    }
  });

  if (results.length === 0) {
    console.log(c('yellow', `\n⚠️  No patterns found matching: ${keyword}\n`));
    return;
  }

  console.log(c('bold', `\n🔍 Found ${results.length} pattern(s) matching: "${keyword}"\n`));

  results.forEach(pattern => {
    const complexityColor = {
      basic: 'green',
      intermediate: 'yellow',
      advanced: 'red'
    }[pattern.complexity] || 'white';

    console.log(`${c(complexityColor, '●')} ${c('cyan', pattern.id)}`);
    console.log(`  ${c('dim', pattern.title)}`);
    console.log(`  ${c('dim', pattern.when)}`);
    console.log(`  Tags: ${pattern.tags.join(', ')}`);
    console.log();
  });
}

/**
 * Show patterns in a specific category
 */
async function showCategory(category) {
  const index = loadIndex();

  if (!index.categories[category]) {
    console.error(c('red', `❌ Category not found: ${category}\n`));
    console.log('Available categories:');
    Object.keys(index.categories).forEach(cat => {
      console.log(`  - ${cat}`);
    });
    process.exit(1);
  }

  console.log(c('bold', `\n📂 Patterns in category: ${category}\n`));

  index.categories[category].forEach(id => {
    const pattern = index.patterns[id];
    const complexityColor = {
      basic: 'green',
      intermediate: 'yellow',
      advanced: 'red'
    }[pattern.complexity] || 'white';

    console.log(`${c(complexityColor, '●')} ${c('cyan', id)}`);
    console.log(`  ${c('dim', pattern.title)}`);
    console.log(`  ${c('dim', pattern.when)}`);
    console.log();
  });
}

/**
 * Main pattern command handler
 */
async function pattern(args) {
  try {
    // No args: list all patterns
    if (args.length === 0) {
      return await listPatterns();
    }

    const command = args[0];

    // pattern list
    if (command === 'list') {
      return await listPatterns();
    }

    // pattern search <keyword>
    if (command === 'search') {
      if (args.length < 2) {
        console.error(c('red', '❌ Usage: tx pattern search <keyword>'));
        process.exit(1);
      }
      return await searchPatterns(args[1]);
    }

    // pattern category <name>
    if (command === 'category') {
      if (args.length < 2) {
        console.error(c('red', '❌ Usage: tx pattern category <name>'));
        process.exit(1);
      }
      return await showCategory(args[1]);
    }

    // pattern <id> - Show specific pattern
    const patternData = await getPattern(command);

    console.log(c('bold', c('cyan', `\n📄 ${patternData.title}\n`)));
    console.log(c('dim', `Category: ${patternData.category}`));
    console.log(c('dim', `Complexity: ${patternData.complexity}`));
    console.log(c('dim', `Tags: ${patternData.tags.join(', ')}`));

    if (patternData.related.length > 0) {
      console.log(c('dim', `Related: ${patternData.related.join(', ')}`));
    }

    console.log('\n' + c('dim', '─'.repeat(80)) + '\n');
    console.log(patternData.content);

  } catch (error) {
    console.error(c('red', `❌ Error: ${error.message}`));
    process.exit(1);
  }
}

module.exports = { pattern };
