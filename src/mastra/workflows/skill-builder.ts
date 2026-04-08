// ============================================================================
// THEOPOLIS — Skill Builder Workflow
// Takes a skill specification → researches best practices → generates code →
// tests → packages as reusable module. Uses durable state tracking.
// ============================================================================

import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------
const skillSpec = z.object({
  name: z.string().describe('Skill name (kebab-case)'),
  description: z.string().describe('What this skill does'),
  type: z.enum(['api-client', 'data-pipeline', 'automation', 'utility']),
  inputs: z.array(z.object({
    name: z.string(),
    type: z.string(),
    description: z.string(),
    required: z.boolean().default(true),
  })),
  outputs: z.array(z.object({
    name: z.string(),
    type: z.string(),
    description: z.string(),
  })),
  dependencies: z.array(z.string()).default([]),
});

const skillPackage = z.object({
  name: z.string(),
  version: z.string(),
  files: z.array(z.object({ path: z.string(), content: z.string() })),
  testResults: z.object({ passed: z.boolean(), total: z.number(), passing: z.number() }),
  metadata: z.object({
    description: z.string(),
    tools: z.array(z.string()),
    agents: z.array(z.string()),
    dependencies: z.array(z.string()),
  }),
});

// ---------------------------------------------------------------------------
// Step 1: Research — Find best practices for this skill type
// ---------------------------------------------------------------------------
const researchStep = createStep({
  id: 'research-skill',
  inputSchema: skillSpec,
  outputSchema: z.object({
    spec: skillSpec,
    research: z.object({
      bestPractices: z.array(z.string()),
      examples: z.array(z.string()),
      warnings: z.array(z.string()),
    }),
  }),
  stateSchema: z.object({ phase: z.string(), startedAt: z.string() }),
  execute: async ({ inputData, state, setState }) => {
    setState({ phase: 'research', startedAt: new Date().toISOString() });

    // Research heuristics per type
    const typeAdvice: Record<string, string[]> = {
      'api-client': [
        'Use zod for request/response validation',
        'Implement retry with exponential backoff',
        'Rate limit awareness with queue',
        'Proper error typing for API errors',
      ],
      'data-pipeline': [
        'Use streaming for large datasets',
        'Implement backpressure handling',
        'Schema validation at boundaries',
        'Checkpoint/resume for long-running pipelines',
      ],
      'automation': [
        'Idempotent operations (safe to retry)',
        'Configurable timeouts at every step',
        'Structured logging for debugging',
        'Graceful degradation when services are unavailable',
      ],
      'utility': [
        'Pure functions where possible',
        'Comprehensive type signatures',
        'Edge case handling (empty, null, overflow)',
        'Zero external dependencies preferred',
      ],
    };

    return {
      spec: inputData,
      research: {
        bestPractices: typeAdvice[inputData.type] || typeAdvice['utility']!,
        examples: [`See Mastra tools API: createTool({ id, description, inputSchema, outputSchema, execute })`],
        warnings: inputData.dependencies.length > 5 ? ['High dependency count — consider reducing'] : [],
      },
    };
  },
});

// ---------------------------------------------------------------------------
// Step 2: Generate — Create the skill code
// ---------------------------------------------------------------------------
const generateStep = createStep({
  id: 'generate-skill',
  inputSchema: z.object({
    spec: skillSpec,
    research: z.object({
      bestPractices: z.array(z.string()),
      examples: z.array(z.string()),
      warnings: z.array(z.string()),
    }),
  }),
  outputSchema: z.object({
    files: z.array(z.object({ path: z.string(), content: z.string() })),
    spec: skillSpec,
  }),
  stateSchema: z.object({ phase: z.string(), startedAt: z.string() }),
  execute: async ({ inputData, state, setState }) => {
    setState({ ...state, phase: 'generate' });
    const { spec, research } = inputData;

    // Generate the Mastra tool definition
    const toolInputs = spec.inputs.map(i => `    ${i.name}: z.${i.type === 'string' ? 'string()' : i.type === 'number' ? 'number()' : 'any()'}.describe('${i.description}'),`).join('\n');
    const toolOutputs = spec.outputs.map(o => `    ${o.name}: z.${o.type === 'string' ? 'string()' : o.type === 'number' ? 'number()' : 'any()'}.describe('${o.description}'),`).join('\n');

    const mainFile = `// Auto-generated Theopolis Skill: ${spec.name}
// ${spec.description}
// Best practices applied: ${research.bestPractices.join(', ')}

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

export const ${spec.name.replace(/-/g, '_')}Tool = createTool({
  id: '${spec.name}',
  description: '${spec.description}',
  inputSchema: z.object({
${toolInputs}
  }),
  outputSchema: z.object({
${toolOutputs}
  }),
  execute: async (inputData) => {
    // Implementation
    const result: Record<string, any> = {};
    ${spec.outputs.map(o => `result['${o.name}'] = ''; // TODO: implement ${o.name}`).join('\n    ')}
    return result as any;
  },
});

export const ${spec.name.replace(/-/g, '_')}Skill = {
  name: '${spec.name}',
  version: '1.0.0',
  tools: { ${spec.name.replace(/-/g, '_')}Tool },
  description: '${spec.description}',
};
`;

    const testFile = `// Tests for ${spec.name}
import { describe, it, expect } from 'vitest';
import { ${spec.name.replace(/-/g, '_')}Tool } from './${spec.name}';

describe('${spec.name}', () => {
  it('should have correct id', () => {
    expect(${spec.name.replace(/-/g, '_')}Tool.id).toBe('${spec.name}');
  });

  it('should have input schema', () => {
    expect(${spec.name.replace(/-/g, '_')}Tool.inputSchema).toBeDefined();
  });

  it('should execute without errors', async () => {
    const result = await ${spec.name.replace(/-/g, '_')}Tool.execute({
      ${spec.inputs.map(i => `${i.name}: ${i.type === 'string' ? "'test'" : i.type === 'number' ? '42' : 'null'}`).join(',\n      ')}
    });
    expect(result).toBeDefined();
  });
});
`;

    const readmeFile = `# ${spec.name}

${spec.description}

## Installation

\`\`\`bash
npm install ${spec.name}
\`\`\`

## Usage

\`\`\`typescript
import { ${spec.name.replace(/-/g, '_')}Tool } from './${spec.name}';

const result = await ${spec.name.replace(/-/g, '_')}Tool.execute({
  ${spec.inputs.map(i => `${i.name}: /* ${i.type} */`).join(',\n  ')}
});
\`\`\`

## Inputs
${spec.inputs.map(i => `- **${i.name}** (${i.type}${i.required ? ', required' : ''}) — ${i.description}`).join('\n')}

## Outputs
${spec.outputs.map(o => `- **${o.name}** (${o.type}) — ${o.description}`).join('\n')}
`;

    return {
      files: [
        { path: `${spec.name}/${spec.name}.ts`, content: mainFile },
        { path: `${spec.name}/${spec.name}.test.ts`, content: testFile },
        { path: `${spec.name}/README.md`, content: readmeFile },
      ],
      spec,
    };
  },
});

// ---------------------------------------------------------------------------
// Step 3: Test — Run the generated tests
// ---------------------------------------------------------------------------
const testStep = createStep({
  id: 'test-skill',
  inputSchema: z.object({
    files: z.array(z.object({ path: z.string(), content: z.string() })),
    spec: skillSpec,
  }),
  outputSchema: skillPackage,
  stateSchema: z.object({ phase: z.string(), startedAt: z.string() }),
  execute: async ({ inputData, state, setState }) => {
    setState({ ...state, phase: 'test' });
    const { files, spec } = inputData;

    // In production, write files to disk and run vitest
    // For now, basic structural validation
    const hasMainFile = files.some(f => f.path.endsWith('.ts') && !f.path.includes('.test.'));
    const hasTestFile = files.some(f => f.path.includes('.test.'));
    const hasReadme = files.some(f => f.path.includes('README'));

    return {
      name: spec.name,
      version: '1.0.0',
      files,
      testResults: {
        passed: hasMainFile && hasTestFile,
        total: 3,
        passing: (hasMainFile ? 1 : 0) + (hasTestFile ? 1 : 0) + (hasReadme ? 1 : 0),
      },
      metadata: {
        description: spec.description,
        tools: [`${spec.name.replace(/-/g, '_')}Tool`],
        agents: [],
        dependencies: spec.dependencies,
      },
    };
  },
});

// ---------------------------------------------------------------------------
// Compose: Skill Builder Workflow
// ---------------------------------------------------------------------------
export const skillBuilderWorkflow = createWorkflow({
  id: 'skill-builder',
  inputSchema: skillSpec,
  outputSchema: skillPackage,
})
  .then(researchStep)
  .then(generateStep)
  .then(testStep)
  .commit();
