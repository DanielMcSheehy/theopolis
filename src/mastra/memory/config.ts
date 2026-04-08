// ============================================================================
// THEOPOLIS — Memory Configuration
// Durable, shared memory layer with observational memory, semantic recall,
// and working memory for structured agent state.
// ============================================================================

import { Memory } from '@mastra/memory';
import { LibSQLStore } from '@mastra/libsql';

// ---------------------------------------------------------------------------
// Storage Provider — LibSQL for durable persistence
// ---------------------------------------------------------------------------

export const storage = new LibSQLStore({
  id: 'theopolis-storage',
  url: process.env.DATABASE_URL || 'file:theopolis.db',
});

// ---------------------------------------------------------------------------
// Memory Configurations — each agent tier gets appropriate memory
// ---------------------------------------------------------------------------

/** Supervisor memory: full observational memory + semantic recall */
export const supervisorMemory = new Memory({
  storage,
  options: {
    lastMessages: 50,
    observationalMemory: true,
    semanticRecall: {
      topK: 10,
      messageRange: { before: 5, after: 2 },
    },
    workingMemory: {
      enabled: true,
      template: `
## Active Project
- name: ""
- status: ""
- currentPhase: ""

## Task Queue
- pending: []
- inProgress: []
- completed: []

## User Preferences
- codeStyle: ""
- language: ""
- verbosity: ""

## Session Context
- lastDecision: ""
- blockers: []
- delegationHistory: []
`,
    },
  },
});

/** Specialist memory: lighter weight, resource-scoped for cross-agent sharing */
export const specialistMemory = new Memory({
  storage,
  options: {
    lastMessages: 30,
    observationalMemory: true,
    semanticRecall: {
      topK: 5,
      messageRange: { before: 3, after: 1 },
    },
    workingMemory: {
      enabled: true,
      template: `
## Specialist State
- currentTask: ""
- artifacts: []
- quality: ""
`,
    },
  },
});

/** Lightweight memory for short-lived workflow agents */
export const ephemeralMemory = new Memory({
  storage,
  options: {
    lastMessages: 10,
  },
});
