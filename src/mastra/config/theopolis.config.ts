// ============================================================================
// THEOPOLIS — System Configuration
// Central configuration for models, agents, workflows, tools, and resources.
// ============================================================================

export const theopolisConfig = {
  // --- Model Routing ---
  models: {
    supervisor: 'openai/gpt-5.4',
    specialist: 'openai/gpt-5.4',
    fast: 'openai/gpt-5-mini',
    guardrail: 'openai/gpt-5-mini',
    embedding: 'openai/text-embedding-3-small',
  },

  // --- Agent Registry ---
  agents: {
    supervisor: {
      id: 'theopolis-supervisor',
      description: 'Main orchestrator — routes, delegates, synthesizes',
      maxSteps: 15,
    },
    coder: {
      id: 'theopolis-coder',
      description: 'Code generation, modification, debugging, execution',
      maxSteps: 10,
    },
    researcher: {
      id: 'theopolis-researcher',
      description: 'Web research, document analysis, knowledge synthesis',
      maxSteps: 8,
    },
    planner: {
      id: 'theopolis-planner',
      description: 'Task decomposition, dependency analysis, estimation',
      maxSteps: 8,
    },
    reviewer: {
      id: 'theopolis-reviewer',
      description: 'Code review, security audit, test generation',
      maxSteps: 8,
    },
  },

  // --- Workflow Registry ---
  workflows: {
    orchestrator: { id: 'theopolis-orchestrator', description: 'Master routing workflow' },
    taskDecomposition: { id: 'task-decomposition', description: 'Break tasks into subtask trees' },
    codeGeneration: { id: 'code-generation-pipeline', description: 'Spec → plan → code → review' },
    councilReview: { id: 'council-review', description: 'Parallel multi-reviewer quality check' },
    skillBuilder: { id: 'skill-builder', description: 'Generate reusable skill packages' },
  },

  // --- Tool Permissions ---
  toolPermissions: {
    coder: ['read-file', 'write-file', 'list-directory', 'search-files', 'exec-command', 'run-typescript', 'lint-code', 'run-tests', 'save-artifact', 'load-artifact'],
    researcher: ['web-search', 'fetch-page', 'summarize-document', 'embed-and-store'],
    reviewer: ['read-file', 'search-files', 'lint-code', 'run-tests', 'run-typescript'],
    planner: [],  // Planner uses LLM reasoning only
  },

  // --- Resource Limits ---
  limits: {
    maxConcurrentAgents: 5,
    maxConcurrentWorkflows: 3,
    maxTokensPerExecution: 100_000,
    maxFileSize: 10 * 1024 * 1024,  // 10MB
    maxWorkspaceSize: 500 * 1024 * 1024,  // 500MB
    sandboxTimeoutMs: 60_000,
    workflowTimeoutMs: 300_000,
    maxSnapshots: 20,
  },

  // --- Storage ---
  storage: {
    url: process.env.DATABASE_URL || 'file:theopolis.db',
    workspacePath: process.env.THEOPOLIS_WORKSPACE || '/tmp/theopolis-workspaces',
    artifactPath: process.env.THEOPOLIS_ARTIFACTS || '/tmp/theopolis-artifacts',
    sandboxPath: process.env.THEOPOLIS_SANDBOXES || '/tmp/theopolis-sandboxes',
  },

  // --- Channels ---
  channels: {
    slack: { enabled: !!process.env.SLACK_BOT_TOKEN },
    discord: { enabled: !!process.env.DISCORD_TOKEN },
    telegram: { enabled: !!process.env.TELEGRAM_BOT_TOKEN },
  },

  // --- Observability ---
  observability: {
    tracing: true,
    logLevel: (process.env.LOG_LEVEL || 'info') as 'debug' | 'info' | 'warn' | 'error',
    metricsEnabled: true,
  },

  // --- Guardrails ---
  guardrails: {
    moderationThreshold: 0.7,
    injectionDetectionThreshold: 0.8,
    piiRedactionEnabled: true,
    maxInputLength: 50_000,
  },
};
