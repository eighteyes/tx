const { PromptBuilder } = require('../prompt-builder');

function prompt(mesh, agent = null) {
  try {
    const agentName = agent || mesh;

    const builtPrompt = PromptBuilder.build(mesh, agentName);

    console.log('━'.repeat(80));
    console.log(`PROMPT: ${mesh}/${agentName}`);
    console.log('━'.repeat(80));
    console.log();
    console.log(builtPrompt);
    console.log();
    console.log('━'.repeat(80));
  } catch (error) {
    console.error('❌ Failed to generate prompt:', error.message);
    process.exit(1);
  }
}

module.exports = { prompt };
