// ============================================================================
// THEOPOLIS — Council Review Workflow
// Runs 3 independent reviewers in parallel, synthesizes findings,
// and routes to approve/revise/reject branches.
// ============================================================================

import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------
const reviewInput = z.object({
  code: z.string(),
  specification: z.string(),
  filePath: z.string().optional(),
});

const individualReview = z.object({
  verdict: z.enum(['approve', 'request-changes', 'block']),
  score: z.number(),
  findings: z.array(z.object({
    severity: z.enum(['critical', 'high', 'medium', 'low', 'nit']),
    message: z.string(),
    line: z.number().optional(),
    suggestion: z.string().optional(),
  })),
  summary: z.string(),
});

// ---------------------------------------------------------------------------
// Reviewer A — Focus: Correctness & Logic
// ---------------------------------------------------------------------------
const reviewerA = createStep({
  id: 'reviewer-correctness',
  inputSchema: reviewInput,
  outputSchema: individualReview,
  execute: async ({ inputData }) => {
    const { code, specification } = inputData;
    const findings: z.infer<typeof individualReview>['findings'] = [];

    // Check for common correctness issues
    if (code.includes('as any')) {
      findings.push({ severity: 'medium', message: 'Unsafe type cast (as any) detected', suggestion: 'Use proper type narrowing or generics' });
    }
    if (!code.includes('try') && code.includes('await')) {
      findings.push({ severity: 'high', message: 'Async operations without error handling', suggestion: 'Wrap async calls in try/catch' });
    }
    if (code.includes('console.log') && !code.includes('// debug')) {
      findings.push({ severity: 'low', message: 'Console.log statements in production code', suggestion: 'Use structured logging or remove' });
    }

    const criticals = findings.filter(f => f.severity === 'critical').length;
    const highs = findings.filter(f => f.severity === 'high').length;
    const score = Math.max(0, 1 - criticals * 0.3 - highs * 0.15 - findings.length * 0.05);

    return {
      verdict: criticals > 0 ? 'block' : highs > 1 ? 'request-changes' : 'approve',
      score,
      findings,
      summary: `Correctness review: ${findings.length} findings, score ${(score * 100).toFixed(0)}%`,
    };
  },
});

// ---------------------------------------------------------------------------
// Reviewer B — Focus: Security & Safety
// ---------------------------------------------------------------------------
const reviewerB = createStep({
  id: 'reviewer-security',
  inputSchema: reviewInput,
  outputSchema: individualReview,
  execute: async ({ inputData }) => {
    const { code } = inputData;
    const findings: z.infer<typeof individualReview>['findings'] = [];

    // Security checks
    if (code.includes('eval(')) {
      findings.push({ severity: 'critical', message: 'eval() usage detected — code injection risk', suggestion: 'Remove eval() and use safe alternatives' });
    }
    if (/process\.env\.\w+/.test(code) && !code.includes('z.string()')) {
      findings.push({ severity: 'medium', message: 'Environment variables accessed without validation', suggestion: 'Validate env vars with zod schema' });
    }
    if (code.includes('innerHTML')) {
      findings.push({ severity: 'high', message: 'innerHTML usage — XSS vulnerability risk', suggestion: 'Use textContent or DOMPurify' });
    }
    if (/password|secret|api.?key/i.test(code) && code.includes("'") && !/process\.env/.test(code)) {
      findings.push({ severity: 'critical', message: 'Hardcoded secrets detected', suggestion: 'Use environment variables' });
    }
    if (code.includes('SELECT') && code.includes("'")) {
      findings.push({ severity: 'critical', message: 'Potential SQL injection (string concatenation in query)', suggestion: 'Use parameterized queries' });
    }

    const criticals = findings.filter(f => f.severity === 'critical').length;
    const highs = findings.filter(f => f.severity === 'high').length;
    const score = Math.max(0, 1 - criticals * 0.4 - highs * 0.2 - findings.length * 0.05);

    return {
      verdict: criticals > 0 ? 'block' : highs > 0 ? 'request-changes' : 'approve',
      score,
      findings,
      summary: `Security review: ${findings.length} findings, score ${(score * 100).toFixed(0)}%`,
    };
  },
});

// ---------------------------------------------------------------------------
// Reviewer C — Focus: Performance & Style
// ---------------------------------------------------------------------------
const reviewerC = createStep({
  id: 'reviewer-performance',
  inputSchema: reviewInput,
  outputSchema: individualReview,
  execute: async ({ inputData }) => {
    const { code } = inputData;
    const findings: z.infer<typeof individualReview>['findings'] = [];

    // Performance checks
    const nestedLoops = (code.match(/for\s*\(/g) || []).length;
    if (nestedLoops > 2) {
      findings.push({ severity: 'medium', message: `${nestedLoops} loop constructs detected — possible O(n²)+ complexity`, suggestion: 'Consider using maps/sets for lookups' });
    }
    if (code.includes('JSON.parse(JSON.stringify')) {
      findings.push({ severity: 'medium', message: 'Deep clone via JSON — slow for large objects', suggestion: 'Use structuredClone() or a targeted copy' });
    }

    // Style checks
    const lines = code.split('\n');
    const longLines = lines.filter(l => l.length > 120).length;
    if (longLines > 5) {
      findings.push({ severity: 'nit', message: `${longLines} lines exceed 120 chars`, suggestion: 'Break long lines for readability' });
    }

    const longFunctions = code.split(/function\s|=>/).filter(block => block.split('\n').length > 50).length;
    if (longFunctions > 0) {
      findings.push({ severity: 'low', message: `${longFunctions} functions exceed 50 lines`, suggestion: 'Extract helper functions' });
    }

    const score = Math.max(0, 1 - findings.filter(f => ['critical', 'high'].includes(f.severity)).length * 0.2 - findings.length * 0.03);

    return {
      verdict: score < 0.5 ? 'request-changes' : 'approve',
      score,
      findings,
      summary: `Performance/style review: ${findings.length} findings, score ${(score * 100).toFixed(0)}%`,
    };
  },
});

// ---------------------------------------------------------------------------
// Synthesis Step — Combine all reviews into a final verdict
// ---------------------------------------------------------------------------
const synthesizeStep = createStep({
  id: 'synthesize-reviews',
  inputSchema: z.object({
    'reviewer-correctness': individualReview,
    'reviewer-security': individualReview,
    'reviewer-performance': individualReview,
  }),
  outputSchema: z.object({
    finalVerdict: z.enum(['approve', 'revise', 'reject']),
    overallScore: z.number(),
    reviews: z.array(z.object({
      reviewer: z.string(),
      verdict: z.string(),
      score: z.number(),
      findingsCount: z.number(),
      summary: z.string(),
    })),
    allFindings: z.array(z.object({
      reviewer: z.string(),
      severity: z.string(),
      message: z.string(),
      suggestion: z.string().optional(),
    })),
    recommendation: z.string(),
  }),
  execute: async ({ inputData }) => {
    const reviewers = [
      { name: 'correctness', data: inputData['reviewer-correctness'] },
      { name: 'security', data: inputData['reviewer-security'] },
      { name: 'performance', data: inputData['reviewer-performance'] },
    ];

    const reviews = reviewers.map(r => ({
      reviewer: r.name,
      verdict: r.data.verdict,
      score: r.data.score,
      findingsCount: r.data.findings.length,
      summary: r.data.summary,
    }));

    const allFindings = reviewers.flatMap(r =>
      r.data.findings.map(f => ({ reviewer: r.name, severity: f.severity, message: f.message, suggestion: f.suggestion }))
    );

    const overallScore = reviewers.reduce((sum, r) => sum + r.data.score, 0) / reviewers.length;
    const hasBlock = reviewers.some(r => r.data.verdict === 'block');
    const hasChanges = reviewers.some(r => r.data.verdict === 'request-changes');

    const finalVerdict: 'approve' | 'revise' | 'reject' = hasBlock
      ? 'reject'
      : hasChanges
        ? 'revise'
        : 'approve';

    const recommendation = finalVerdict === 'approve'
      ? 'Code passes all review criteria. Ready for deployment.'
      : finalVerdict === 'revise'
        ? `Code needs revisions. Address ${allFindings.filter(f => ['critical', 'high'].includes(f.severity)).length} critical/high findings.`
        : `Code is blocked. Critical security or correctness issues must be resolved before proceeding.`;

    return { finalVerdict, overallScore, reviews, allFindings, recommendation };
  },
});

// ---------------------------------------------------------------------------
// Compose: Council Review Workflow
// ---------------------------------------------------------------------------
export const councilReviewWorkflow = createWorkflow({
  id: 'council-review',
  inputSchema: reviewInput,
  outputSchema: z.object({
    finalVerdict: z.enum(['approve', 'revise', 'reject']),
    overallScore: z.number(),
    reviews: z.array(z.object({
      reviewer: z.string(),
      verdict: z.string(),
      score: z.number(),
      findingsCount: z.number(),
      summary: z.string(),
    })),
    allFindings: z.array(z.object({
      reviewer: z.string(),
      severity: z.string(),
      message: z.string(),
      suggestion: z.string().optional(),
    })),
    recommendation: z.string(),
  }),
})
  .parallel([reviewerA, reviewerB, reviewerC])
  .then(synthesizeStep)
  .commit();
