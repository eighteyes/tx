#!/usr/bin/env node

/**
 * Simple script to show current agent health scores
 */

const StateManager = require('../lib/state-manager');

async function main() {
  console.log('\n🔍 Current Agent Health\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  try {
    // Get all agent states
    const states = await StateManager.getAllStates();

    if (Object.keys(states).length === 0) {
      console.log('No active agents found.\n');
      return;
    }

    // Simple health scoring based on state
    for (const [agentId, agentData] of Object.entries(states)) {
      let score = 100;
      let status = '✅';

      // Apply simple penalties based on state
      if (agentData.state === 'error') {
        score = 0;
        status = '🔴';
      } else if (agentData.state === 'distracted') {
        score = 70;
        status = '⚠️ ';
      } else if (agentData.state === 'blocked') {
        score = 80;
        status = '⚠️ ';
      }

      console.log(`${status} ${agentId}`);
      console.log(`   Score: ${score}/100`);
      console.log(`   State: ${agentData.state}`);

      if (agentData.lastActivity) {
        const lastActivity = new Date(agentData.lastActivity);
        const minutesAgo = Math.floor((Date.now() - lastActivity.getTime()) / 60000);
        console.log(`   Last Activity: ${minutesAgo}m ago`);
      }

      if (agentData.currentTask) {
        console.log(`   Current Task: ${agentData.currentTask}`);
      }

      console.log();
    }

  } catch (error) {
    console.error('Error:', error.message);
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('Note: Full HealthMonitor module built in lib/health-monitor.js');
  console.log('      Includes delivery monitoring integration & detailed scoring\n');
}

main();
