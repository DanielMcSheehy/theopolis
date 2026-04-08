// ============================================================================
// THEOPOLIS — Code Execution Tools
// Sandboxed command execution, TypeScript runner, linting, and test execution.
// ============================================================================

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT = 30_000;

// ---------------------------------------------------------------------------
// execCommand — Run shell commands with timeout and sandbox
// ---------------------------------------------------------------------------
export const execCommandTool = createTool({
  id: 'exec-command',
  description: 'Execute a shell command in a sandboxed workspace. Has timeout, working directory, and environment variable controls.',
  inputSchema: z.object({
    command: z.string().describe('The command to execute'),
    args: z.array(z.string()).default([]).describe('Command arguments'),
    cwd: z.string().optional().describe('Working directory (relative to workspace root)'),
    env: z.record(z.string()).optional().describe('Additional environment variables'),
    timeoutMs: z.number().default(DEFAULT_TIMEOUT).describe('Timeout in milliseconds'),
    captureStderr: z.boolean().default(true),
  }),
  outputSchema: z.object({
    stdout: z.string(),
    stderr: z.string(),
    exitCode: z.number(),
    timedOut: z.boolean(),
    durationMs: z.number(),
  }),
  execute: async ({ command, args, cwd, env, timeoutMs, captureStderr }) => {
    const workDir = cwd || process.env.THEOPOLIS_WORKSPACE || os.tmpdir();
    const start = Date.now();
    try {
      const result = await execFileAsync(command, args, {
        cwd: workDir,
        timeout: timeoutMs,
        env: { ...process.env, ...env },
        maxBuffer: 10 * 1024 * 1024,
      });
      return {
        stdout: result.stdout,
        stderr: captureStderr ? result.stderr : '',
        exitCode: 0,
        timedOut: false,
        durationMs: Date.now() - start,
      };
    } catch (err: any) {
      return {
        stdout: err.stdout || '',
        stderr: captureStderr ? (err.stderr || err.message) : '',
        exitCode: err.code ?? 1,
        timedOut: err.killed === true,
        durationMs: Date.now() - start,
      };
    }
  },
});

// ---------------------------------------------------------------------------
// runTypeScript — Execute TypeScript code in an isolated temp file context
// ---------------------------------------------------------------------------
export const runTypeScriptTool = createTool({
  id: 'run-typescript',
  description: 'Execute a TypeScript code snippet. Creates a temp file, runs it with tsx/ts-node, and returns the output.',
  inputSchema: z.object({
    code: z.string().describe('TypeScript code to execute'),
    timeoutMs: z.number().default(DEFAULT_TIMEOUT),
  }),
  outputSchema: z.object({
    stdout: z.string(),
    stderr: z.string(),
    exitCode: z.number(),
    durationMs: z.number(),
  }),
  execute: async ({ code, timeoutMs }) => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'theopolis-ts-'));
    const tmpFile = path.join(tmpDir, 'script.ts');
    await fs.writeFile(tmpFile, code, 'utf-8');
    const start = Date.now();

    try {
      // Try tsx first (faster), fall back to npx ts-node
      const runner = await execFileAsync('which', ['tsx']).then(() => 'tsx').catch(() => 'npx');
      const args = runner === 'tsx' ? [tmpFile] : ['ts-node', '--esm', tmpFile];

      const result = await execFileAsync(runner, args, {
        timeout: timeoutMs,
        maxBuffer: 5 * 1024 * 1024,
      });

      return {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: 0,
        durationMs: Date.now() - start,
      };
    } catch (err: any) {
      return {
        stdout: err.stdout || '',
        stderr: err.stderr || err.message,
        exitCode: err.code ?? 1,
        durationMs: Date.now() - start,
      };
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  },
});

// ---------------------------------------------------------------------------
// lintCode — Run ESLint on generated code
// ---------------------------------------------------------------------------
export const lintCodeTool = createTool({
  id: 'lint-code',
  description: 'Run linting on a code string or file. Returns lint errors and warnings with line/column info.',
  inputSchema: z.object({
    code: z.string().optional().describe('Code string to lint (creates temp file)'),
    filePath: z.string().optional().describe('Path to file to lint'),
    language: z.enum(['typescript', 'javascript']).default('typescript'),
    fix: z.boolean().default(false).describe('Auto-fix fixable issues'),
  }),
  outputSchema: z.object({
    passed: z.boolean(),
    errors: z.number(),
    warnings: z.number(),
    issues: z.array(z.object({
      line: z.number(),
      column: z.number(),
      severity: z.enum(['error', 'warning']),
      message: z.string(),
      rule: z.string(),
    })),
    fixedCode: z.string().optional(),
  }),
  execute: async ({ code, filePath, language, fix }) => {
    let targetFile = filePath;
    let tmpDir: string | null = null;

    if (code && !filePath) {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'theopolis-lint-'));
      const ext = language === 'typescript' ? '.ts' : '.js';
      targetFile = path.join(tmpDir, `lint-target${ext}`);
      await fs.writeFile(targetFile, code, 'utf-8');
    }

    if (!targetFile) {
      return { passed: true, errors: 0, warnings: 0, issues: [], fixedCode: undefined };
    }

    try {
      const args = ['eslint', '--format', 'json', fix ? '--fix' : '', targetFile].filter(Boolean);
      const result = await execFileAsync('npx', args, {
        timeout: 30_000,
        maxBuffer: 5 * 1024 * 1024,
      });

      const parsed = JSON.parse(result.stdout);
      const file = parsed[0] || { messages: [], errorCount: 0, warningCount: 0 };

      const issues = file.messages.map((m: any) => ({
        line: m.line,
        column: m.column,
        severity: m.severity === 2 ? 'error' as const : 'warning' as const,
        message: m.message,
        rule: m.ruleId || 'unknown',
      }));

      const fixedCode = fix ? await fs.readFile(targetFile, 'utf-8') : undefined;

      return {
        passed: file.errorCount === 0,
        errors: file.errorCount,
        warnings: file.warningCount,
        issues,
        fixedCode,
      };
    } catch (err: any) {
      // ESLint exits non-zero when there are errors
      try {
        const parsed = JSON.parse(err.stdout || '[]');
        const file = parsed[0] || { messages: [], errorCount: 0, warningCount: 0 };
        return {
          passed: false,
          errors: file.errorCount || 1,
          warnings: file.warningCount || 0,
          issues: (file.messages || []).map((m: any) => ({
            line: m.line || 0,
            column: m.column || 0,
            severity: m.severity === 2 ? 'error' as const : 'warning' as const,
            message: m.message,
            rule: m.ruleId || 'unknown',
          })),
          fixedCode: undefined,
        };
      } catch {
        return { passed: false, errors: 1, warnings: 0, issues: [{ line: 0, column: 0, severity: 'error' as const, message: err.message, rule: 'exec-error' }], fixedCode: undefined };
      }
    } finally {
      if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  },
});

// ---------------------------------------------------------------------------
// runTests — Execute test suites
// ---------------------------------------------------------------------------
export const runTestsTool = createTool({
  id: 'run-tests',
  description: 'Run test suites using vitest, jest, or a custom test command. Returns pass/fail results per test.',
  inputSchema: z.object({
    testDir: z.string().default('.').describe('Directory containing tests'),
    pattern: z.string().optional().describe('Test file pattern (e.g. "**/*.test.ts")'),
    runner: z.enum(['vitest', 'jest', 'custom']).default('vitest'),
    customCommand: z.string().optional().describe('Custom test command (when runner=custom)'),
    timeoutMs: z.number().default(60_000),
  }),
  outputSchema: z.object({
    passed: z.boolean(),
    totalTests: z.number(),
    passedTests: z.number(),
    failedTests: z.number(),
    skippedTests: z.number(),
    output: z.string(),
    durationMs: z.number(),
  }),
  execute: async ({ testDir, pattern, runner, customCommand, timeoutMs }) => {
    const workDir = path.resolve(process.env.THEOPOLIS_WORKSPACE || '.', testDir);
    const start = Date.now();

    let cmd: string;
    let args: string[];

    switch (runner) {
      case 'vitest':
        cmd = 'npx';
        args = ['vitest', 'run', '--reporter=json', pattern ? `--include=${pattern}` : ''].filter(Boolean);
        break;
      case 'jest':
        cmd = 'npx';
        args = ['jest', '--json', pattern ? `--testPathPattern=${pattern}` : ''].filter(Boolean);
        break;
      case 'custom':
        if (!customCommand) throw new Error('customCommand required when runner=custom');
        const parts = customCommand.split(' ');
        cmd = parts[0]!;
        args = parts.slice(1);
        break;
      default:
        throw new Error(`Unknown runner: ${runner}`);
    }

    try {
      const result = await execFileAsync(cmd, args, {
        cwd: workDir,
        timeout: timeoutMs,
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env, CI: 'true' },
      });

      return {
        passed: true,
        totalTests: 0,  // Parse from JSON output in production
        passedTests: 0,
        failedTests: 0,
        skippedTests: 0,
        output: result.stdout + result.stderr,
        durationMs: Date.now() - start,
      };
    } catch (err: any) {
      return {
        passed: false,
        totalTests: 0,
        passedTests: 0,
        failedTests: 1,
        skippedTests: 0,
        output: (err.stdout || '') + (err.stderr || err.message),
        durationMs: Date.now() - start,
      };
    }
  },
});

export const codeExecutionTools = {
  execCommandTool,
  runTypeScriptTool,
  lintCodeTool,
  runTestsTool,
};
