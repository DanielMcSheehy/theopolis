# 🏛️ Theopolis

**A modern AI taskflow system built on [Mastra AI](https://mastra.ai)** — the spiritual successor to Container-Theopolis, reimagined with Mastra's latest primitives: supervisor agents, durable workflows, channels, steering, and reusable skills.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│              THEOPOLIS SUPERVISOR                    │
│  (Mastra Supervisor Agent + Delegation Hooks)       │
│  • Steering Controller  • Watchdog  • Feedback Loop │
├───────┬────────┬────────────┬──────────┬────────────┤
│ Coder │Planner │ Researcher │ Reviewer │  Council   │
│ Agent │ Agent  │   Agent    │  Agent   │ (Parallel) │
├───────┴────────┴────────────┴──────────┴────────────┤
│            WORKFLOW ENGINE (Durable)                 │
│  .then() → .parallel() → .branch() → .dountil()    │
│  suspend/resume • sleep • workflow-as-steps         │
├─────────────────────────────────────────────────────┤
│     TOOLS         │  SKILLS       │  CHANNELS       │
│  filesystem       │  registry     │  Slack          │
│  code-execution   │  templates    │  Discord        │
│  knowledge        │  versioning   │  Telegram       │
│  workspace        │  sharing      │  webhooks       │
├─────────────────────────────────────────────────────┤
│  DURABLE SANDBOX  │  HARNESS      │  ARTIFACTS      │
│  workspace mgmt   │  test env     │  versioned      │
│  isolation        │  execution    │  addressable    │
│  snapshots        │  replay       │  searchable     │
├─────────────────────────────────────────────────────┤
│  MEMORY (LibSQL + Observational + Semantic)         │
│  Resource-scoped sharing • Working memory           │
└─────────────────────────────────────────────────────┘
```

## Quick Start

```bash
npm install
npm run dev        # Start Mastra dev server
npm run studio     # Open Mastra Studio (visual workflow debugger)
```

## Project Structure

```
src/mastra/
├── index.ts                          # Main Mastra instance — registers everything
├── config/
│   └── theopolis.config.ts           # Central configuration
├── agents/
│   ├── supervisor.ts                 # Supervisor agent (the brain)
│   └── specialists/
│       ├── coder.ts                  # Code generation & debugging
│       ├── researcher.ts             # Web research & synthesis
│       ├── planner.ts                # Task decomposition & planning
│       └── reviewer.ts              # Code review & quality assurance
├── workflows/
│   ├── orchestrator.ts               # Master router → sub-workflows
│   ├── task-decomposition.ts         # Task → subtask tree with dependencies
│   ├── code-generation.ts            # Spec → plan → code → review (durable)
│   ├── council-review.ts             # 3 parallel reviewers → synthesized verdict
│   └── skill-builder.ts             # Generate reusable skill packages
├── tools/
│   ├── filesystem.ts                 # readFile, writeFile, listDir, search
│   ├── code-execution.ts            # exec, runTS, lint, runTests
│   ├── knowledge.ts                 # webSearch, fetchPage, summarize, embed
│   └── workspace.ts                 # createProject, status, artifacts
├── steering/
│   ├── steering-controller.ts        # Real-time agent steering via delegation hooks
│   ├── watchdog.ts                   # Stall/loop/exhaustion detection
│   └── feedback-loop.ts             # Outcome tracking, A/B testing, improvements
├── sandbox/
│   ├── durable-workspace.ts          # Isolated workspaces with snapshots & rollback
│   └── sandbox-manager.ts           # Sandbox pool with resource limits
├── harness/
│   └── execution-harness.ts          # Retries, circuit breaker, concurrency limits
├── skills/
│   └── skill-registry.ts            # Dynamic skill loading & dependency resolution
├── channels/
│   └── config.ts                     # Slack/Discord/Telegram adapters
└── memory/
    └── config.ts                     # Observational + semantic + working memory
```

## Key Mastra Features Used

| Feature | Version | Usage |
|---------|---------|-------|
| **Supervisor Agents** | `@mastra/core@1.8.0+` | Delegation hooks, message filtering, memory isolation |
| **Channels** | `@mastra/core@1.22.0+` | Slack/Discord/Telegram with multimodal & thread context |
| **Durable Workflows** | `@mastra/core` | suspend/resume, snapshots, sleep, parallel/branch/loop |
| **Processors & Guardrails** | `@mastra/core` | Moderation, PII detection, prompt injection |
| **Observational Memory** | `@mastra/memory` | Background compression, working memory, semantic recall |
| **Scorers/Evals** | `@mastra/evals` | Task completion scoring, live evaluations |

## Usage Examples

### Chat with the Supervisor
```typescript
import { mastra, steeringController } from './src/mastra';

const supervisor = mastra.getAgentById('theopolis-supervisor');
const response = await supervisor.generate('Build a REST API for user management', {
  memory: { resource: 'user-123', thread: 'project-api' },
  maxSteps: 15,
  delegation: steeringController.createDelegationHooks(),
});
```

### Run the Code Generation Pipeline
```typescript
const workflow = mastra.getWorkflow('codeGeneration');
const run = await workflow.createRun();
const result = await run.start({
  inputData: {
    specification: 'Build a JWT auth middleware for Express',
    language: 'typescript',
  },
});

// Human approval checkpoint (workflow suspends here)
if (result.status === 'suspended') {
  const final = await run.resume({
    step: 'human-approval',
    resumeData: { approved: true, feedback: 'Looks good!' },
  });
}
```

### Council Review (3 Parallel Reviewers)
```typescript
const review = mastra.getWorkflow('councilReview');
const run = await review.createRun();
const verdict = await run.start({
  inputData: {
    code: generatedCode,
    specification: 'Must handle errors and validate inputs',
  },
});
// verdict.result.finalVerdict → 'approve' | 'revise' | 'reject'
```

### Steer a Running Agent
```typescript
import { steeringController } from './src/mastra';

// Inject feedback mid-execution
steeringController.injectFeedback('theopolis-coder', 'Focus on error handling');

// Restrict tools
steeringController.overrideTools('theopolis-coder', ['write-file', 'run-tests']);

// Pause/resume
steeringController.pause('theopolis-researcher');
steeringController.resume('theopolis-researcher');
```

## Environment Variables

```bash
# Required
DATABASE_URL=file:theopolis.db          # LibSQL database URL

# Optional — Channels
SLACK_BOT_TOKEN=xoxb-...
DISCORD_TOKEN=...
TELEGRAM_BOT_TOKEN=...

# Optional — Tools
BRAVE_API_KEY=...                        # Web search
THEOPOLIS_WORKSPACE=/tmp/theopolis-workspaces
THEOPOLIS_ARTIFACTS=/tmp/theopolis-artifacts
```

## License

MIT
