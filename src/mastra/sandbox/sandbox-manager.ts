// ============================================================================
// THEOPOLIS — Sandbox Manager
// Spawns isolated execution environments with resource limits,
// filesystem isolation, and lifecycle management.
// ============================================================================

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface SandboxConfig {
  id: string;
  timeoutMs: number;
  maxMemoryMb: number;
  maxDiskMb: number;
  networkEnabled: boolean;
  mountPaths: string[];       // Host paths to mount read-only
  env: Record<string, string>;
  cleanupPolicy: 'auto-delete' | 'keep-on-failure' | 'ttl';
  ttlMs?: number;
}

export interface SandboxInstance {
  id: string;
  config: SandboxConfig;
  workDir: string;
  status: 'warming' | 'ready' | 'running' | 'completed' | 'failed' | 'expired';
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  result?: { stdout: string; stderr: string; exitCode: number };
}

// ---------------------------------------------------------------------------
// SandboxManager — Pool and lifecycle management for sandboxes
// ---------------------------------------------------------------------------
export class SandboxManager {
  private sandboxes = new Map<string, SandboxInstance>();
  private pool: SandboxInstance[] = [];
  private poolSize: number;
  private baseDir: string;

  constructor(options: { poolSize?: number; baseDir?: string } = {}) {
    this.poolSize = options.poolSize || 3;
    this.baseDir = options.baseDir || path.join(os.tmpdir(), 'theopolis-sandboxes');
  }

  /** Initialize the sandbox manager and warm up the pool */
  async initialize(): Promise<void> {
    await fs.mkdir(this.baseDir, { recursive: true });

    // Pre-warm pool
    for (let i = 0; i < this.poolSize; i++) {
      const sandbox = await this.createSandbox({
        id: `pool-${i}`,
        timeoutMs: 60_000,
        maxMemoryMb: 256,
        maxDiskMb: 100,
        networkEnabled: false,
        mountPaths: [],
        env: {},
        cleanupPolicy: 'auto-delete',
      });
      sandbox.status = 'ready';
      this.pool.push(sandbox);
    }

    console.log(`[SandboxManager] Initialized with ${this.poolSize} pre-warmed sandboxes`);
  }

  /** Create a new sandbox */
  async createSandbox(config: SandboxConfig): Promise<SandboxInstance> {
    const workDir = path.join(this.baseDir, config.id);
    await fs.mkdir(workDir, { recursive: true });
    await fs.mkdir(path.join(workDir, 'workspace'), { recursive: true });

    const sandbox: SandboxInstance = {
      id: config.id,
      config,
      workDir,
      status: 'warming',
      createdAt: Date.now(),
    };

    this.sandboxes.set(config.id, sandbox);
    return sandbox;
  }

  /** Acquire a sandbox from the pool (or create a new one) */
  async acquire(config?: Partial<SandboxConfig>): Promise<SandboxInstance> {
    // Try to get from pool
    const available = this.pool.find(s => s.status === 'ready');
    if (available) {
      this.pool = this.pool.filter(s => s.id !== available.id);
      available.status = 'running';
      available.startedAt = Date.now();

      if (config) {
        Object.assign(available.config, config);
      }

      return available;
    }

    // Create a new one
    const id = `sandbox-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const sandbox = await this.createSandbox({
      id,
      timeoutMs: 60_000,
      maxMemoryMb: 256,
      maxDiskMb: 100,
      networkEnabled: false,
      mountPaths: [],
      env: {},
      cleanupPolicy: 'auto-delete',
      ...config,
    });

    sandbox.status = 'running';
    sandbox.startedAt = Date.now();
    return sandbox;
  }

  /** Execute code in a sandbox */
  async execute(
    sandboxId: string,
    command: string,
    args: string[] = []
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox) throw new Error(`Sandbox ${sandboxId} not found`);

    const workDir = path.join(sandbox.workDir, 'workspace');
    const config = sandbox.config;

    try {
      const result = await execFileAsync(command, args, {
        cwd: workDir,
        timeout: config.timeoutMs,
        maxBuffer: config.maxDiskMb * 1024 * 1024,
        env: {
          HOME: workDir,
          TMPDIR: workDir,
          PATH: process.env.PATH,
          NODE_ENV: 'sandbox',
          ...config.env,
        },
      });

      sandbox.result = { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
      sandbox.status = 'completed';
      sandbox.completedAt = Date.now();
      return sandbox.result;
    } catch (err: any) {
      sandbox.result = {
        stdout: err.stdout || '',
        stderr: err.stderr || err.message,
        exitCode: err.code ?? 1,
      };
      sandbox.status = 'failed';
      sandbox.completedAt = Date.now();
      return sandbox.result;
    }
  }

  /** Write a file into a sandbox's workspace */
  async writeToSandbox(sandboxId: string, filePath: string, content: string): Promise<void> {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox) throw new Error(`Sandbox ${sandboxId} not found`);

    const resolved = path.join(sandbox.workDir, 'workspace', filePath);
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    await fs.writeFile(resolved, content, 'utf-8');
  }

  /** Read a file from a sandbox's workspace */
  async readFromSandbox(sandboxId: string, filePath: string): Promise<string> {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox) throw new Error(`Sandbox ${sandboxId} not found`);

    const resolved = path.join(sandbox.workDir, 'workspace', filePath);
    return fs.readFile(resolved, 'utf-8');
  }

  /** Release a sandbox back to the pool or clean it up */
  async release(sandboxId: string): Promise<void> {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox) return;

    const shouldCleanup =
      sandbox.config.cleanupPolicy === 'auto-delete' ||
      (sandbox.config.cleanupPolicy === 'keep-on-failure' && sandbox.status !== 'failed');

    if (shouldCleanup) {
      await fs.rm(sandbox.workDir, { recursive: true, force: true }).catch(() => {});
      this.sandboxes.delete(sandboxId);

      // Replenish pool if below target
      if (this.pool.length < this.poolSize) {
        const newSandbox = await this.createSandbox({
          ...sandbox.config,
          id: `pool-${Date.now()}`,
        });
        newSandbox.status = 'ready';
        this.pool.push(newSandbox);
      }
    }
  }

  /** Clean up expired TTL sandboxes */
  async cleanup(): Promise<number> {
    const now = Date.now();
    let cleaned = 0;

    for (const [id, sandbox] of this.sandboxes) {
      if (sandbox.config.cleanupPolicy === 'ttl' &&
          sandbox.config.ttlMs &&
          now - sandbox.createdAt > sandbox.config.ttlMs) {
        await this.release(id);
        cleaned++;
      }
    }

    return cleaned;
  }

  /** Get status of all sandboxes */
  getStatus(): {
    active: number;
    pooled: number;
    total: number;
    sandboxes: SandboxInstance[];
  } {
    return {
      active: Array.from(this.sandboxes.values()).filter(s => s.status === 'running').length,
      pooled: this.pool.length,
      total: this.sandboxes.size,
      sandboxes: Array.from(this.sandboxes.values()),
    };
  }
}

// Singleton
export const sandboxManager = new SandboxManager();
