// ============================================================================
// THEOPOLIS — Main Mastra Instance
// Registers all agents, workflows, storage, and memory.
// This is the entry point for the entire Theopolis system.
// ============================================================================

import { Mastra } from '@mastra/core';
import { LibSQLStore } from '@mastra/libsql';
import { theopolisConfig } from './config/theopolis.config';

// Agents
import { supervisorAgent } from './agents/supervisor';
import { coderAgent } from './agents/specialists/coder';
import { researcherAgent } from './agents/specialists/researcher';
import { plannerAgent } from './agents/specialists/planner';
import { reviewerAgent } from './agents/specialists/reviewer';

// Workflows
import { orchestratorWorkflow } from './workflows/orchestrator';
import { taskDecompositionWorkflow } from './workflows/task-decomposition';
import { codeGenerationWorkflow } from './workflows/code-generation';
import { councilReviewWorkflow } from './workflows/council-review';
import { skillBuilderWorkflow } from './workflows/skill-builder';

// Infrastructure
import { watchdog } from './steering/watchdog';
import { sandboxManager } from './sandbox/sandbox-manager';
import { executionHarness } from './harness/execution-harness';
import { steeringController } from './steering/steering-controller';
import { feedbackLoop } from './steering/feedback-loop';
import { skillRegistry } from './skills/skill-registry';

// ---------------------------------------------------------------------------
// Storage Provider — LibSQL (durable, file-based or remote Turso)
// ---------------------------------------------------------------------------
const storage = new LibSQLStore({
  url: theopolisConfig.storage.url,
});

// ---------------------------------------------------------------------------
// Mastra Instance — The core runtime
// ---------------------------------------------------------------------------
export const mastra = new Mastra({
  // All agents registered for access via mastra.getAgentById()
  agents: {
    supervisor: supervisorAgent,
    coder: coderAgent,
    researcher: researcherAgent,
    planner: plannerAgent,
    reviewer: reviewerAgent,
  },

  // All workflows registered for access via mastra.getWorkflow()
  workflows: {
    orchestrator: orchestratorWorkflow,
    taskDecomposition: taskDecompositionWorkflow,
    codeGeneration: codeGenerationWorkflow,
    councilReview: councilReviewWorkflow,
    skillBuilder: skillBuilderWorkflow,
  },

  // Durable storage for memory, workflow state, and channel state
  storage,
});

// ---------------------------------------------------------------------------
// System Initialization
// ---------------------------------------------------------------------------
async function initializeTheopolis(): Promise<void> {
  console.log('🏛️  Theopolis initializing...');

  // Start watchdog monitoring
  watchdog.start();
  console.log('  ✓ Watchdog started');

  // Initialize sandbox pool
  await sandboxManager.initialize();
  console.log('  ✓ Sandbox pool warmed');

  // Log system state
  const health = executionHarness.healthCheck();
  console.log(`  ✓ Execution harness: ${health.healthy ? 'healthy' : 'degraded'}`);

  const skills = skillRegistry.list();
  console.log(`  ✓ Skill registry: ${skills.length} skills registered`);

  const steeringLog = steeringController.getLog();
  console.log(`  ✓ Steering controller: ${steeringLog.length} logged actions`);

  const stats = feedbackLoop.getStats();
  console.log(`  ✓ Feedback loop: ${stats.total} outcomes recorded`);

  console.log('🏛️  Theopolis ready.\n');
  console.log('  Agents:');
  Object.entries(theopolisConfig.agents).forEach(([key, agent]) => {
    console.log(`    • ${key}: ${agent.description}`);
  });
  console.log('\n  Workflows:');
  Object.entries(theopolisConfig.workflows).forEach(([key, wf]) => {
    console.log(`    • ${key}: ${wf.description}`);
  });
  console.log('\n  Channels:');
  Object.entries(theopolisConfig.channels).forEach(([key, ch]) => {
    console.log(`    • ${key}: ${ch.enabled ? '✓ enabled' : '✗ disabled'}`);
  });
}

// ---------------------------------------------------------------------------
// Convenience Exports
// ---------------------------------------------------------------------------
export {
  // Agents
  supervisorAgent,
  coderAgent,
  researcherAgent,
  plannerAgent,
  reviewerAgent,

  // Workflows
  orchestratorWorkflow,
  taskDecompositionWorkflow,
  codeGenerationWorkflow,
  councilReviewWorkflow,
  skillBuilderWorkflow,

  // Infrastructure
  watchdog,
  sandboxManager,
  executionHarness,
  steeringController,
  feedbackLoop,
  skillRegistry,

  // Config
  theopolisConfig,

  // Init
  initializeTheopolis,
};

// ---------------------------------------------------------------------------
// Usage Examples
// ---------------------------------------------------------------------------
/*
// 1. Chat with the supervisor (routes to specialists automatically)
const supervisor = mastra.getAgentById('theopolis-supervisor');
const response = await supervisor.generate('Build a REST API for user management', {
  memory: { resource: 'user-123', thread: 'project-api' },
  maxSteps: 15,
  delegation: steeringController.createDelegationHooks(),
});

// 2. Run a workflow directly
const workflow = mastra.getWorkflow('taskDecomposition');
const run = await workflow.createRun();
const result = await run.start({
  inputData: {
    task: 'Build a real-time chat application',
    constraints: ['Must use WebSockets', 'TypeScript only'],
  },
});

// 3. Use the execution harness for production calls
const result = await executionHarness.executeGenerate(
  supervisor,
  'Research the latest Mastra AI features and generate a summary',
  { memory: { resource: 'user-123', thread: 'research-1' } }
);

// 4. Council review of generated code
const review = mastra.getWorkflow('councilReview');
const reviewRun = await review.createRun();
const verdict = await reviewRun.start({
  inputData: {
    code: '... generated code ...',
    specification: 'Must handle errors and validate inputs',
  },
});

// 5. Steer a running agent
steeringController.injectFeedback('theopolis-coder', 'Focus on error handling — the happy path is done.');
steeringController.overrideTools('theopolis-coder', ['write-file', 'run-tests']);  // restrict tool access

// 6. Build a reusable skill
const skillWorkflow = mastra.getWorkflow('skillBuilder');
const skillRun = await skillWorkflow.createRun();
const skill = await skillRun.start({
  inputData: {
    name: 'github-api',
    description: 'GitHub API integration for repo management',
    type: 'api-client',
    inputs: [
      { name: 'owner', type: 'string', description: 'Repo owner', required: true },
      { name: 'repo', type: 'string', description: 'Repo name', required: true },
    ],
    outputs: [
      { name: 'data', type: 'string', description: 'API response data' },
    ],
  },
});
*/
