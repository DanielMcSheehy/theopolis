// ============================================================================
// THEOPOLIS — Supervisor Agent (The Brain)
// Coordinates all specialist agents with delegation hooks, steering,
// task completion scoring, and full memory isolation.
// ============================================================================

import { Agent } from '@mastra/core/agent';
import { createScorer } from '@mastra/core/evals';
import {
  ModerationProcessor,
  PromptInjectionDetector,
  PIIDetector,
  UnicodeNormalizer,
} from '@mastra/core/processors';
import { supervisorMemory } from '../memory/config';
import { coderAgent } from './specialists/coder';
import { researcherAgent } from './specialists/researcher';
import { plannerAgent } from './specialists/planner';
import { reviewerAgent } from './specialists/reviewer';

// ---------------------------------------------------------------------------
// Task Completion Scorer — validates the supervisor's output quality
// ---------------------------------------------------------------------------
const taskCompleteScorer = createScorer({
  id: 'theopolis-task-complete',
  name: 'Task Completeness',
}).generateScore(async (context) => {
  const text = (context.run.output || '').toString();
  const hasStructuredOutput = text.includes('##') || text.includes('```');
  const hasActionableContent = text.length > 200;
  const hasConclusion =
    text.includes('complete') ||
    text.includes('done') ||
    text.includes('ready') ||
    text.includes('result');
  const score =
    (hasStructuredOutput ? 0.3 : 0) +
    (hasActionableContent ? 0.4 : 0) +
    (hasConclusion ? 0.3 : 0);
  return score;
});

// ---------------------------------------------------------------------------
// Supervisor Agent Definition
// ---------------------------------------------------------------------------
export const supervisorAgent = new Agent({
  id: 'theopolis-supervisor',
  name: 'Theopolis',
  model: 'openai/gpt-5.4',
  memory: supervisorMemory,

  // --- Specialist Sub-Agents (auto-converted to tools as agent-<key>) ---
  agents: {
    coder: coderAgent,
    researcher: researcherAgent,
    planner: plannerAgent,
    reviewer: reviewerAgent,
  },

  // --- Guardrails: Input Processors ---
  inputProcessors: [
    new UnicodeNormalizer({ stripControlChars: true, collapseWhitespace: true }),
    new PromptInjectionDetector({
      model: 'openai/gpt-5-mini',
      threshold: 0.8,
      strategy: 'rewrite',
      detectionTypes: ['injection', 'jailbreak', 'system-override'],
    }),
    new ModerationProcessor({
      model: 'openai/gpt-5-mini',
      threshold: 0.7,
      strategy: 'block',
      categories: ['hate', 'harassment', 'violence'],
    }),
  ],

  // --- Guardrails: Output Processors ---
  outputProcessors: [
    new PIIDetector({
      model: 'openai/gpt-5-mini',
      threshold: 0.6,
      strategy: 'redact',
      redactionMethod: 'mask',
      detectionTypes: ['email', 'phone', 'credit-card'],
    }),
  ],

  // --- Live Evaluations ---
  scorers: {
    taskComplete: {
      scorer: taskCompleteScorer,
      sampling: { type: 'ratio', rate: 0.5 },
    },
  },

  // --- Default Call Options (delegation hooks, steering) ---
  defaultOptions: {
    maxSteps: 15,

    // --- Delegation Hooks: Control how work flows to sub-agents ---
    delegation: {
      // Before delegating to a sub-agent
      onDelegationStart: async (context) => {
        const { primitiveId, prompt, iteration } = context;

        console.log(
          `[Theopolis] Delegating to ${primitiveId} (iteration ${iteration})`
        );

        // Safety: stop infinite delegation loops
        if (iteration > 12) {
          return {
            proceed: false,
            rejectionReason:
              'Maximum iterations reached. Synthesize current findings into a final response.',
          };
        }

        // Context enrichment per agent type
        const enrichments: Record<string, string> = {
          coder:
            '\n\nIMPORTANT: Write complete, runnable code. No stubs or placeholders. Verify with tools.',
          researcher:
            '\n\nIMPORTANT: Cite all sources with URLs. Distinguish confirmed facts from inference.',
          planner:
            '\n\nIMPORTANT: Every subtask must have acceptance criteria and effort estimate.',
          reviewer:
            '\n\nIMPORTANT: Rate every finding by severity. Include fix suggestions.',
        };

        const suffix = enrichments[primitiveId] || '';

        return {
          proceed: true,
          modifiedPrompt: prompt + suffix,
          modifiedMaxSteps: primitiveId === 'coder' ? 10 : 8,
        };
      },

      // After delegation completes
      onDelegationComplete: async (context) => {
        const { primitiveId, result, error, bail } = context;

        console.log(`[Theopolis] ${primitiveId} completed`);

        if (error) {
          console.error(`[Theopolis] ${primitiveId} failed:`, error);
          return {
            feedback: `Delegation to ${primitiveId} failed: ${error}. Try an alternative approach or handle this yourself.`,
          };
        }

        // Quality gate: check if result seems substantial
        const resultText =
          typeof result === 'string' ? result : JSON.stringify(result);
        if (resultText.length < 50) {
          return {
            feedback: `The ${primitiveId} agent returned a very short response. Consider re-delegating with more specific instructions.`,
          };
        }

        return {};
      },

      // Control what messages sub-agents see
      messageFilter: ({ messages, primitiveId, prompt }) => {
        // Remove sensitive messages, keep last 15 for context
        return messages
          .filter((msg) => {
            const content =
              typeof msg.content === 'string'
                ? msg.content
                : JSON.stringify(msg.content);
            return !content.includes('[REDACTED]') && !content.includes('API_KEY');
          })
          .slice(-15);
      },
    },

    // --- Iteration Monitoring: Inject feedback each loop ---
    onIterationComplete: async (context) => {
      const { iteration, text, finishReason } = context;

      console.log(
        `[Theopolis] Iteration ${iteration} complete (reason: ${finishReason})`
      );

      // Force conclusion if we've been going too long
      if (iteration >= 10 && text.length > 500) {
        return {
          continue: false,
          feedback:
            'You have enough information. Synthesize everything into a final, comprehensive response now.',
        };
      }

      // Guide toward completeness if response is thin
      if (iteration >= 5 && text.length < 200) {
        return {
          continue: true,
          feedback:
            'Your response is too brief. Include more detail, examples, and actionable specifics.',
        };
      }

      return { continue: true };
    },
  },

  // --- System Instructions ---
  instructions: `You are **Theopolis** — an advanced AI taskflow supervisor that coordinates specialist agents to deliver production-quality work.

## Your Role
You are the orchestrator. You decompose complex requests, delegate to the right specialists, 
quality-check their output, and synthesize everything into polished deliverables.

## Available Specialists
- **Coder** — Writes, modifies, and debugs code. Use for all code generation tasks.
- **Researcher** — Gathers web info, analyzes docs, synthesizes findings. Use when you need facts.
- **Planner** — Decomposes tasks, identifies dependencies, estimates effort. Use for complex multi-step work.
- **Reviewer** — Reviews code quality, security, performance. Use after code generation.

## Delegation Strategy
1. **Simple questions** → Answer directly. Don't delegate trivial queries.
2. **Research needed** → Researcher first, then action.
3. **Code tasks** → Planner first (for complex work), then Coder, then Reviewer.
4. **Complex projects** → Planner → Researcher (if needed) → Coder (parallel files) → Reviewer.

## Quality Protocol
- After the Coder generates code, ALWAYS send it to the Reviewer.
- If the Reviewer finds Critical/High issues, send back to the Coder with the findings.
- Iterate until the Reviewer gives APPROVE or you've done 3 revision cycles.

## Output Standards
- Always provide structured, actionable responses
- Include code in fenced blocks with language tags
- Summarize what was done, what was generated, and what's needed next
- If anything failed, explain why and what alternatives exist

## Rules
- Never claim you can't do something without trying
- Never produce placeholder/stub code — it must be complete
- Always verify code by running it when possible
- Cite sources for factual claims
- Track progress in your working memory
`,
});
