#!/usr/bin/env node

/**
 * Sara Assistant Evaluation CLI
 * 
 * Run: yarn eval:assistant --live (for live model evaluation)
 * Default: uses canned model responses for deterministic assertions
 * 
 * Note: This script uses dynamic imports to avoid ES module path resolution issues.
 */

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const LIVE_MODE = process.argv.includes('--live');

async function main() {
  console.log(`Running Sara Assistant Evaluation (${LIVE_MODE ? 'LIVE' : 'canned'} mode)...\n`);

  // Dynamically import the evaluation module and cases
  // Use relative paths from the project root
  try {
    // Import evaluation functions
    const { evaluateCases } = await import('../src/backend/services/assistant/evaluation.js');
    const { EVALUATION_CASES } = await import('../evals/assistant/cases.js');

    const results = await evaluateCases(EVALUATION_CASES);

    // Print summary
    console.log(`\n=== Evaluation Summary ===`);
    console.log(`Total cases: ${EVALUATION_CASES.length}`);
    console.log(`Passed: ${results.passed}`);
    console.log(`Failed: ${results.failed.length}`);
    
    if (results.failed.length > 0) {
      console.log(`\n=== Failed Cases ===`);
      for (const failure of results.failed) {
        console.log(`  ${failure.id}: ${failure.reason}`);
      }
    }

    if (results.timingsMs.length > 0) {
      const totalTime = results.timingsMs.reduce((a, b) => a + b, 0);
      const avgTime = totalTime / results.timingsMs.length;
      console.log(`\n=== Timings ===`);
      console.log(`Total: ${totalTime}ms`);
      console.log(`Average: ${avgTime.toFixed(2)}ms per case`);
      console.log(`Min: ${Math.min(...results.timingsMs)}ms`);
      console.log(`Max: ${Math.max(...results.timingsMs)}ms`);
    }

    if (results.estimatedCostUsd) {
      console.log(`\n=== Cost Estimate ===`);
      console.log(`Estimated: ${results.estimatedCostUsd}`);
    }

    // Exit with appropriate code
    const exitCode = results.failed.length > 0 ? 1 : 0;
    process.exit(exitCode);
  } catch (error) {
    console.error('Error loading evaluation modules:', error);
    console.log('\nNote: This script requires ES modules. Make sure you are running it with Node.js 16+.');
    console.log('The imports use .js extensions which may need to be .ts if running from source.');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Evaluation error:', error);
  process.exit(1);
});
