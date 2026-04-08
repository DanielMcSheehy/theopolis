// ============================================================================
// THEOPOLIS — Task Decomposition Workflow
// Takes a high-level task, decomposes it into a dependency-aware subtask tree,
// validates the decomposition, and returns a structured execution plan.
// ============================================================================

import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------
const subtaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  agent: z.enum(['coder', 'researcher', 'planner', 'reviewer']),
  estimatedHours: z.number(),
  dependencies: z.array(z.string()),
  acceptanceCriteria: z.string(),
  priority: z.enum(['critical', 'high', 'medium', 'low']),
  parallelizable: z.boolean(),
});

const taskPlanSchema = z.object({
  title: z.string(),
  objective: z.string(),
  complexity: z.enum(['low', 'medium', 'high', 'critical']),
  totalEstimatedHours: z.number(),
  subtasks: z.array(subtaskSchema),
  phases: z.array(z.object({
    name: z.string(),
    parallel: z.boolean(),
    taskIds: z.array(z.string()),
  })),
  criticalPath: z.array(z.string()),
  risks: z.array(z.object({
    description: z.string(),
    severity: z.enum(['low', 'medium', 'high']),
    mitigation: z.string(),
  })),
});

// ---------------------------------------------------------------------------
// Step 1: Analyze — Understand the task scope
// ---------------------------------------------------------------------------
const analyzeStep = createStep({
  id: 'analyze-task',
  inputSchema: z.object({
    task: z.string(),
    context: z.string().optional(),
    constraints: z.array(z.string()).optional(),
  }),
  outputSchema: z.object({
    task: z.string(),
    analysis: z.object({
      domain: z.string(),
      scope: z.enum(['small', 'medium', 'large', 'epic']),
      knownRequirements: z.array(z.string()),
      unknowns: z.array(z.string()),
      suggestedApproach: z.string(),
    }),
  }),
  execute: async ({ inputData }) => {
    const { task, context, constraints } = inputData;

    // Heuristic analysis of task complexity
    const words = task.split(/\s+/).length;
    const scope = words < 20 ? 'small' : words < 50 ? 'medium' : words < 100 ? 'large' : 'epic';

    const knownRequirements = constraints || [];
    const unknowns: string[] = [];

    if (!task.includes('test')) unknowns.push('Test requirements not specified');
    if (!task.includes('deploy')) unknowns.push('Deployment target unclear');

    return {
      task,
      analysis: {
        domain: context || 'general software development',
        scope,
        knownRequirements,
        unknowns,
        suggestedApproach: scope === 'small'
          ? 'Direct implementation — single agent can handle this'
          : 'Multi-phase implementation — decompose and delegate',
      },
    };
  },
});

// ---------------------------------------------------------------------------
// Step 2: Decompose — Break into subtasks (this is where the LLM/agent does the work)
// ---------------------------------------------------------------------------
const decomposeStep = createStep({
  id: 'decompose-task',
  inputSchema: z.object({
    task: z.string(),
    analysis: z.object({
      domain: z.string(),
      scope: z.enum(['small', 'medium', 'large', 'epic']),
      knownRequirements: z.array(z.string()),
      unknowns: z.array(z.string()),
      suggestedApproach: z.string(),
    }),
  }),
  outputSchema: taskPlanSchema,
  execute: async ({ inputData }) => {
    const { task, analysis } = inputData;

    // Generate a basic decomposition based on scope
    // In production, this step would delegate to the Planner agent
    const subtasks: z.infer<typeof subtaskSchema>[] = [];
    let taskId = 0;

    // Phase 1: Research (if unknowns exist)
    if (analysis.unknowns.length > 0) {
      subtasks.push({
        id: `task-${++taskId}`,
        title: 'Research & Requirements Gathering',
        description: `Investigate: ${analysis.unknowns.join(', ')}`,
        agent: 'researcher',
        estimatedHours: analysis.scope === 'epic' ? 4 : 2,
        dependencies: [],
        acceptanceCriteria: 'All unknowns resolved with documented findings',
        priority: 'high',
        parallelizable: true,
      });
    }

    // Phase 2: Planning
    subtasks.push({
      id: `task-${++taskId}`,
      title: 'Architecture & Design',
      description: `Design the implementation for: ${task}`,
      agent: 'planner',
      estimatedHours: analysis.scope === 'small' ? 0.5 : 2,
      dependencies: analysis.unknowns.length > 0 ? ['task-1'] : [],
      acceptanceCriteria: 'Complete architecture document with component breakdown',
      priority: 'critical',
      parallelizable: false,
    });

    // Phase 3: Implementation
    const implTaskId = `task-${++taskId}`;
    subtasks.push({
      id: implTaskId,
      title: 'Core Implementation',
      description: `Write the primary code for: ${task}`,
      agent: 'coder',
      estimatedHours: analysis.scope === 'small' ? 1 : analysis.scope === 'medium' ? 4 : 8,
      dependencies: [`task-${taskId - 1}`],
      acceptanceCriteria: 'All code complete, types correct, no linting errors',
      priority: 'critical',
      parallelizable: false,
    });

    // Phase 4: Testing
    subtasks.push({
      id: `task-${++taskId}`,
      title: 'Test Generation & Execution',
      description: 'Generate unit and integration tests for the implementation',
      agent: 'coder',
      estimatedHours: analysis.scope === 'small' ? 0.5 : 2,
      dependencies: [implTaskId],
      acceptanceCriteria: 'Test coverage >80%, all tests passing',
      priority: 'high',
      parallelizable: true,
    });

    // Phase 5: Review
    subtasks.push({
      id: `task-${++taskId}`,
      title: 'Code Review & Quality Check',
      description: 'Review all generated code for quality, security, and correctness',
      agent: 'reviewer',
      estimatedHours: 1,
      dependencies: [implTaskId, `task-${taskId - 1}`],
      acceptanceCriteria: 'Reviewer verdict: APPROVE with no Critical/High findings',
      priority: 'high',
      parallelizable: false,
    });

    const totalHours = subtasks.reduce((sum, t) => sum + t.estimatedHours, 0);

    return {
      title: task.slice(0, 100),
      objective: task,
      complexity: analysis.scope === 'small' ? 'low' : analysis.scope === 'medium' ? 'medium' : 'high',
      totalEstimatedHours: totalHours,
      subtasks,
      phases: [
        { name: 'Research', parallel: true, taskIds: subtasks.filter(t => t.agent === 'researcher').map(t => t.id) },
        { name: 'Design', parallel: false, taskIds: subtasks.filter(t => t.agent === 'planner').map(t => t.id) },
        { name: 'Implement', parallel: false, taskIds: subtasks.filter(t => t.title.includes('Implementation')).map(t => t.id) },
        { name: 'Test & Review', parallel: true, taskIds: subtasks.filter(t => t.agent === 'reviewer' || t.title.includes('Test')).map(t => t.id) },
      ],
      criticalPath: subtasks.filter(t => t.priority === 'critical').map(t => t.id),
      risks: [
        { description: 'Requirements may be incomplete', severity: 'medium' as const, mitigation: 'Early research phase covers unknowns' },
        { description: 'Implementation complexity underestimated', severity: 'high' as const, mitigation: '30% buffer included in estimates' },
      ],
    };
  },
});

// ---------------------------------------------------------------------------
// Step 3: Validate — Check the decomposition makes sense
// ---------------------------------------------------------------------------
const validateStep = createStep({
  id: 'validate-decomposition',
  inputSchema: taskPlanSchema,
  outputSchema: z.object({
    plan: taskPlanSchema,
    valid: z.boolean(),
    issues: z.array(z.string()),
  }),
  execute: async ({ inputData }) => {
    const plan = inputData;
    const issues: string[] = [];

    // Check for dependency cycles
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    function hasCycle(taskId: string): boolean {
      visited.add(taskId);
      recursionStack.add(taskId);
      const task = plan.subtasks.find(t => t.id === taskId);
      if (!task) return false;
      for (const dep of task.dependencies) {
        if (!visited.has(dep) && hasCycle(dep)) return true;
        if (recursionStack.has(dep)) return true;
      }
      recursionStack.delete(taskId);
      return false;
    }

    for (const task of plan.subtasks) {
      if (!visited.has(task.id) && hasCycle(task.id)) {
        issues.push(`Dependency cycle detected involving task ${task.id}`);
      }
    }

    // Check all dependencies exist
    const taskIds = new Set(plan.subtasks.map(t => t.id));
    for (const task of plan.subtasks) {
      for (const dep of task.dependencies) {
        if (!taskIds.has(dep)) {
          issues.push(`Task ${task.id} depends on non-existent task ${dep}`);
        }
      }
    }

    // Check for orphaned tasks in phases
    const phasedTasks = new Set(plan.phases.flatMap(p => p.taskIds));
    for (const task of plan.subtasks) {
      if (!phasedTasks.has(task.id)) {
        issues.push(`Task ${task.id} is not assigned to any phase`);
      }
    }

    // Check task sizes
    for (const task of plan.subtasks) {
      if (task.estimatedHours > 8) {
        issues.push(`Task ${task.id} exceeds 8 hours — should be decomposed further`);
      }
    }

    return { plan, valid: issues.length === 0, issues };
  },
});

// ---------------------------------------------------------------------------
// Compose: Task Decomposition Workflow
// ---------------------------------------------------------------------------
export const taskDecompositionWorkflow = createWorkflow({
  id: 'task-decomposition',
  inputSchema: z.object({
    task: z.string(),
    context: z.string().optional(),
    constraints: z.array(z.string()).optional(),
  }),
  outputSchema: z.object({
    plan: taskPlanSchema,
    valid: z.boolean(),
    issues: z.array(z.string()),
  }),
})
  .then(analyzeStep)
  .then(decomposeStep)
  .then(validateStep)
  .commit();
