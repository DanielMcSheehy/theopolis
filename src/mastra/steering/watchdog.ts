// ============================================================================
// THEOPOLIS — Watchdog System
// Monitors active executions for stalls, loops, and resource exhaustion.
// Auto-steers or kills stuck processes.
// ============================================================================

import { steeringController } from './steering-controller';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface WatchedExecution {
  id: string;
  agentId: string;
  startedAt: number;
  lastActivityAt: number;
  toolCalls: string[];
  tokenBudget: number;
  tokensUsed: number;
  iterationCount: number;
  status: 'running' | 'stalled' | 'looping' | 'exhausted' | 'killed';
}

interface WatchdogConfig {
  stallTimeoutMs: number;         // No progress for this long → stalled
  maxIterations: number;          // Too many iterations → possible loop
  maxRepeatedToolCalls: number;   // Same tool called N times → loop
  tokenBudget: number;            // Max tokens per execution
  checkIntervalMs: number;        // How often to check
  autoKillOnExhaustion: boolean;  // Kill when budget exceeded
  escalationCallback?: (execution: WatchedExecution, reason: string) => void;
}

const DEFAULT_CONFIG: WatchdogConfig = {
  stallTimeoutMs: 60_000,       // 1 minute
  maxIterations: 20,
  maxRepeatedToolCalls: 5,
  tokenBudget: 100_000,
  checkIntervalMs: 10_000,     // Check every 10 seconds
  autoKillOnExhaustion: true,
};

// ---------------------------------------------------------------------------
// Watchdog — Monitors and intervenes in agent executions
// ---------------------------------------------------------------------------
export class Watchdog {
  private executions = new Map<string, WatchedExecution>();
  private config: WatchdogConfig;
  private interval: ReturnType<typeof setInterval> | null = null;

  constructor(config: Partial<WatchdogConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Start monitoring */
  start(): void {
    if (this.interval) return;
    this.interval = setInterval(() => this.check(), this.config.checkIntervalMs);
    console.log('[Watchdog] Started monitoring');
  }

  /** Stop monitoring */
  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    console.log('[Watchdog] Stopped');
  }

  /** Register a new execution to watch */
  watch(id: string, agentId: string, tokenBudget?: number): void {
    this.executions.set(id, {
      id,
      agentId,
      startedAt: Date.now(),
      lastActivityAt: Date.now(),
      toolCalls: [],
      tokenBudget: tokenBudget || this.config.tokenBudget,
      tokensUsed: 0,
      iterationCount: 0,
      status: 'running',
    });
  }

  /** Record activity (tool call, iteration, etc.) */
  recordActivity(id: string, toolName?: string, tokensUsed?: number): void {
    const exec = this.executions.get(id);
    if (!exec) return;

    exec.lastActivityAt = Date.now();
    exec.iterationCount++;

    if (toolName) exec.toolCalls.push(toolName);
    if (tokensUsed) exec.tokensUsed += tokensUsed;
  }

  /** Mark execution as complete */
  complete(id: string): void {
    this.executions.delete(id);
  }

  /** Run watchdog checks */
  private check(): void {
    const now = Date.now();

    for (const [id, exec] of this.executions) {
      if (exec.status === 'killed') continue;

      // Check for stalls
      if (now - exec.lastActivityAt > this.config.stallTimeoutMs) {
        exec.status = 'stalled';
        this.escalate(exec, `Stalled: no activity for ${Math.round((now - exec.lastActivityAt) / 1000)}s`);
        steeringController.injectFeedback(
          exec.agentId,
          'WATCHDOG: You appear stalled. Summarize what you have and respond immediately.'
        );
        continue;
      }

      // Check for iteration loops
      if (exec.iterationCount > this.config.maxIterations) {
        exec.status = 'looping';
        this.escalate(exec, `Loop detected: ${exec.iterationCount} iterations`);
        steeringController.stop(exec.agentId, 'Watchdog: Exceeded maximum iteration count. Produce a final answer now.');
        continue;
      }

      // Check for repeated tool calls (same tool called N times in a row)
      const recentTools = exec.toolCalls.slice(-this.config.maxRepeatedToolCalls);
      if (recentTools.length >= this.config.maxRepeatedToolCalls &&
          new Set(recentTools).size === 1) {
        exec.status = 'looping';
        this.escalate(exec, `Tool loop: ${recentTools[0]} called ${recentTools.length} times consecutively`);
        steeringController.injectFeedback(
          exec.agentId,
          `WATCHDOG: You've called ${recentTools[0]} ${recentTools.length} times. Try a different approach.`
        );
        continue;
      }

      // Check for token exhaustion
      if (exec.tokensUsed > exec.tokenBudget) {
        exec.status = 'exhausted';
        this.escalate(exec, `Token budget exceeded: ${exec.tokensUsed}/${exec.tokenBudget}`);
        if (this.config.autoKillOnExhaustion) {
          steeringController.stop(exec.agentId, 'Watchdog: Token budget exhausted. Respond with what you have.');
          exec.status = 'killed';
        }
        continue;
      }
    }
  }

  /** Escalate an issue */
  private escalate(exec: WatchedExecution, reason: string): void {
    console.warn(`[Watchdog] ALERT ${exec.id} (${exec.agentId}): ${reason}`);
    if (this.config.escalationCallback) {
      this.config.escalationCallback(exec, reason);
    }
  }

  /** Get status of all watched executions */
  getStatus(): WatchedExecution[] {
    return Array.from(this.executions.values());
  }
}

// Singleton instance
export const watchdog = new Watchdog();
