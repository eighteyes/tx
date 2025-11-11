#!/usr/bin/env node
/**
 * Build Pattern Index
 *
 * Scans meshes/patterns/ directory and builds an index.json file
 * with metadata from each pattern's frontmatter.
 */

const fs = require('fs-extra');
const path = require('path');

const PATTERNS_DIR = 'meshes/patterns';
const INDEX_FILE = path.join(PATTERNS_DIR, 'index.json');

/**
 * Parse frontmatter from markdown file
 * @param {string} content - File content
 * @returns {object} Parsed frontmatter
 */
function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) {
    return null;
  }

  const yaml = match[1];
  const frontmatter = {};

  yaml.split('\n').forEach(line => {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) return;

    const key = line.substring(0, colonIndex).trim();
    let value = line.substring(colonIndex + 1).trim();

    // Parse arrays: [item1, item2]
    if (value.startsWith('[') && value.endsWith(']')) {
      value = value
        .substring(1, value.length - 1)
        .split(',')
        .map(v => v.trim())
        .filter(v => v.length > 0);
    }

    frontmatter[key] = value;
  });

  return frontmatter;
}

/**
 * Recursively find all .md files in a directory
 */
function findMarkdownFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);

  files.forEach(file => {
    const filepath = path.join(dir, file);
    const stat = fs.statSync(filepath);

    if (stat.isDirectory()) {
      findMarkdownFiles(filepath, fileList);
    } else if (file.endsWith('.md')) {
      fileList.push(filepath);
    }
  });

  return fileList;
}

/**
 * Build pattern index from all .md files in patterns directory
 */
function buildIndex() {
  console.log('🔨 Building pattern index...\n');

  const patterns = {};
  const patternFiles = findMarkdownFiles(PATTERNS_DIR);

  let count = 0;
  let errors = 0;

  patternFiles.forEach(filepath => {
    // Skip index.md or README.md
    if (filepath.endsWith('index.md') || filepath.endsWith('README.md')) {
      return;
    }

    try {
      const content = fs.readFileSync(filepath, 'utf-8');
      const frontmatter = parseFrontmatter(content);

      if (!frontmatter) {
        console.warn(`⚠️  No frontmatter: ${filepath}`);
        errors++;
        return;
      }

      // Generate pattern ID from filepath
      // meshes/patterns/messaging/write-tool.md -> messaging/write-tool
      const relativePath = path.relative(PATTERNS_DIR, filepath);
      const patternId = relativePath.replace('.md', '');

      // Validate required fields
      const required = ['title', 'category', 'complexity'];
      const missing = required.filter(field => !frontmatter[field]);
      if (missing.length > 0) {
        console.warn(`⚠️  Missing fields in ${filepath}: ${missing.join(', ')}`);
        errors++;
        return;
      }

      patterns[patternId] = {
        id: patternId,
        title: frontmatter.title,
        category: frontmatter.category,
        complexity: frontmatter.complexity,
        tags: frontmatter.tags || [],
        when: frontmatter.when || '',
        related: frontmatter.related || [],
        file: filepath
      };

      console.log(`✅ ${patternId}`);
      count++;

    } catch (error) {
      console.error(`❌ Error processing ${filepath}: ${error.message}`);
      errors++;
    }
  });

  // Build category index
  const categories = {};
  Object.values(patterns).forEach(pattern => {
    if (!categories[pattern.category]) {
      categories[pattern.category] = [];
    }
    categories[pattern.category].push(pattern.id);
  });

  // Build tag index
  const tags = {};
  Object.values(patterns).forEach(pattern => {
    pattern.tags.forEach(tag => {
      if (!tags[tag]) {
        tags[tag] = [];
      }
      tags[tag].push(pattern.id);
    });
  });

  const index = {
    generated: new Date().toISOString(),
    totalPatterns: count,
    patterns,
    categories,
    tags
  };

  // Write index file
  fs.writeJsonSync(INDEX_FILE, index, { spaces: 2 });

  console.log(`\n📦 Pattern index built: ${INDEX_FILE}`);
  console.log(`   Patterns: ${count}`);
  console.log(`   Categories: ${Object.keys(categories).length}`);
  console.log(`   Tags: ${Object.keys(tags).length}`);

  if (errors > 0) {
    console.log(`\n⚠️  ${errors} error(s) encountered`);
  }

  return index;
}

// Run if called directly
if (require.main === module) {
  buildIndex();
}

module.exports = { buildIndex, parseFrontmatter };
