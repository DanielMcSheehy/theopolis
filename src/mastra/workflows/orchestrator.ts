// ============================================================================
// THEOPOLIS — Master Orchestration Workflow
// Top-level entry point that routes requests to sub-workflows,
// handles suspend/resume, and manages cross-workflow state.
// ============================================================================

import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { taskDecompositionWorkflow } from './task-decomposition';
import { codeGenerationWorkflow } from './code-generation';
import { councilReviewWorkflow } from './council-review';
import { skillBuilderWorkflow } from './skill-builder';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------
const requestSchema = z.object({
  request: z.string().describe('The user request in natural language'),
  context: z.string().optional().describe('Additional context'),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
  dryRun: z.boolean().default(false).describe('If true, plan but do not execute'),
});

const resultSchema = z.object({
  requestId: z.string(),
  status: z.enum(['completed', 'suspended', 'failed', 'dry-run']),
  route: z.string(),
  summary: z.string(),
  artifacts: z.array(z.object({
    name: z.string(),
    type: z.string(),
    path: z.string().optional(),
  })),
  metrics: z.object({
    totalSteps: z.number(),
    durationMs: z.number(),
    agentsUsed: z.array(z.string()),
  }),
});

// ---------------------------------------------------------------------------
// Step 1: Route — Classify the request and determine which workflow to use
// ---------------------------------------------------------------------------
const routeStep = createStep({
  id: 'route-request',
  inputSchema: requestSchema,
  outputSchema: z.object({
    request: z.string(),
    route: z.enum(['code-generation', 'research', 'planning', 'skill-build', 'review', 'direct']),
    reasoning: z.string(),
    priority: z.string(),
    dryRun: z.boolean(),
    requestId: z.string(),
    startTime: z.number(),
  }),
  execute: async ({ inputData }) => {
    const { request, priority, dryRun } = inputData;
    const lower = request.toLowerCase();

    // Simple keyword-based routing — in production, the supervisor LLM does this
    let route: 'code-generation' | 'research' | 'planning' | 'skill-build' | 'review' | 'direct';
    let reasoning: string;

    if (lower.includes('build') || lower.includes('create') || lower.includes('implement') || lower.includes('write code')) {
      route = 'code-generation';
      reasoning = 'Request involves code generation/implementation';
    } else if (lower.includes('research') || lower.includes('find') || lower.includes('search') || lower.includes('compare')) {
      route = 'research';
      reasoning = 'Request involves information gathering';
    } else if (lower.includes('plan') || lower.includes('decompose') || lower.includes('break down') || lower.includes('architecture')) {
      route = 'planning';
      reasoning = 'Request involves planning/decomposition';
    } else if (lower.includes('skill') || lower.includes('plugin') || lower.includes('tool') || lower.includes('reusable')) {
      route = 'skill-build';
      reasoning = 'Request involves building a reusable skill';
    } else if (lower.includes('review') || lower.includes('audit') || lower.includes('check') || lower.includes('quality')) {
      route = 'review';
      reasoning = 'Request involves code review/quality check';
    } else {
      route = 'direct';
      reasoning = 'Simple request — handle directly without sub-workflow';
    }

    return {
      request,
      route,
      reasoning,
      priority,
      dryRun,
      requestId: `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      startTime: Date.now(),
    };
  },
});

// ---------------------------------------------------------------------------
// Step 2: Execute — Branch to the appropriate sub-workflow
// ---------------------------------------------------------------------------
const executeCodeGenStep = createStep({
  id: 'execute-code-gen',
  inputSchema: z.object({
    request: z.string(),
    route: z.string(),
    reasoning: z.string(),
    priority: z.string(),
    dryRun: z.boolean(),
    requestId: z.string(),
    startTime: z.number(),
  }),
  outputSchema: resultSchema,
  execute: async ({ inputData }) => {
    return {
      requestId: inputData.requestId,
      status: inputData.dryRun ? 'dry-run' as const : 'completed' as const,
      route: inputData.route,
      summary: `Routed to ${inputData.route}: ${inputData.reasoning}. [In production, this delegates to the ${inputData.route} sub-workflow]`,
      artifacts: [],
      metrics: {
        totalSteps: 1,
        durationMs: Date.now() - inputData.startTime,
        agentsUsed: inputData.route === 'code-generation' ? ['planner', 'coder', 'reviewer'] :
                     inputData.route === 'research' ? ['researcher'] :
                     inputData.route === 'planning' ? ['planner'] :
                     inputData.route === 'skill-build' ? ['researcher', 'coder', 'reviewer'] :
                     inputData.route === 'review' ? ['reviewer'] : ['supervisor'],
      },
    };
  },
});

const executePlanningStep = createStep({
  id: 'execute-planning',
  inputSchema: z.object({
    request: z.string(),
    route: z.string(),
    reasoning: z.string(),
    priority: z.string(),
    dryRun: z.boolean(),
    requestId: z.string(),
    startTime: z.number(),
  }),
  outputSchema: resultSchema,
  execute: async ({ inputData }) => {
    return {
      requestId: inputData.requestId,
      status: inputData.dryRun ? 'dry-run' as const : 'completed' as const,
      route: 'planning',
      summary: `Task decomposition initiated for: ${inputData.request.slice(0, 100)}`,
      artifacts: [],
      metrics: {
        totalSteps: 3,
        durationMs: Date.now() - inputData.startTime,
        agentsUsed: ['planner'],
      },
    };
  },
});

const executeDirectStep = createStep({
  id: 'execute-direct',
  inputSchema: z.object({
    request: z.string(),
    route: z.string(),
    reasoning: z.string(),
    priority: z.string(),
    dryRun: z.boolean(),
    requestId: z.string(),
    startTime: z.number(),
  }),
  outputSchema: resultSchema,
  execute: async ({ inputData }) => {
    return {
      requestId: inputData.requestId,
      status: 'completed' as const,
      route: 'direct',
      summary: `Direct response for: ${inputData.request.slice(0, 100)}`,
      artifacts: [],
      metrics: {
        totalSteps: 1,
        durationMs: Date.now() - inputData.startTime,
        agentsUsed: ['supervisor'],
      },
    };
  },
});

// ---------------------------------------------------------------------------
// Compose: Master Orchestrator Workflow
// ---------------------------------------------------------------------------
export const orchestratorWorkflow = createWorkflow({
  id: 'theopolis-orchestrator',
  inputSchema: requestSchema,
  outputSchema: resultSchema,
})
  .then(routeStep)
  .branch([
    [async ({ inputData }) => ['code-generation', 'skill-build', 'review'].includes(inputData.route), executeCodeGenStep],
    [async ({ inputData }) => ['planning', 'research'].includes(inputData.route), executePlanningStep],
    [async ({ inputData }) => inputData.route === 'direct', executeDirectStep],
  ])
  .map(async ({ inputData }) => {
    // Merge branch outputs (only one branch executes)
    return (inputData as any)['execute-code-gen'] ||
           (inputData as any)['execute-planning'] ||
           (inputData as any)['execute-direct'];
  })
  .commit();
