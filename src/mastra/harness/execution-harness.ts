// ============================================================================
// THEOPOLIS — Execution Harness
// Wraps agent/workflow execution with observability, retries, circuit breaking,
// concurrency limits, and health checks.
// ============================================================================

import { Agent } from '@mastra/core/agent';
import { watchdog } from '../steering/watchdog';
import { feedbackLoop, type TaskOutcome } from '../steering/feedback-loop';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface ExecutionOptions {
  maxRetries: number;
  retryDelayMs: number;
  timeoutMs: number;
  maxConcurrent: number;
  circuitBreakerThreshold: number;  // Consecutive failures before opening circuit
  circuitBreakerResetMs: number;
}

interface ExecutionResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  retries: number;
  durationMs: number;
  executionId: string;
}

interface CircuitBreakerState {
  failures: number;
  lastFailure: number;
  state: 'closed' | 'open' | 'half-open';
}

// ---------------------------------------------------------------------------
// ExecutionHarness — Production-grade agent execution wrapper
// ---------------------------------------------------------------------------
export class ExecutionHarness {
  private options: ExecutionOptions;
  private activeCount = 0;
  private queue: Array<() => void> = [];
  private circuitBreakers = new Map<string, CircuitBreakerState>();

  constructor(options: Partial<ExecutionOptions> = {}) {
    this.options = {
      maxRetries: 3,
      retryDelayMs: 1000,
      timeoutMs: 120_000,
      maxConcurrent: 5,
      circuitBreakerThreshold: 5,
      circuitBreakerResetMs: 60_000,
      ...options,
    };
  }

  /**
   * Execute an agent.generate() call with full harness protection:
   * - Retries with exponential backoff
   * - Concurrency limiting
   * - Circuit breaker
   * - Timeout
   * - Watchdog monitoring
   * - Feedback loop recording
   */
  async executeGenerate(
    agent: Agent,
    prompt: string,
    options?: { memory?: any; maxSteps?: number }
  ): Promise<ExecutionResult<string>> {
    const executionId = `exec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const start = Date.now();

    // Circuit breaker check
    const cb = this.getCircuitBreaker(agent.id);
    if (cb.state === 'open') {
      if (Date.now() - cb.lastFailure > this.options.circuitBreakerResetMs) {
        cb.state = 'half-open';
      } else {
        return {
          success: false,
          error: `Circuit breaker OPEN for ${agent.id}. Too many failures.`,
          retries: 0,
          durationMs: Date.now() - start,
          executionId,
        };
      }
    }

    // Concurrency gate
    await this.acquireConcurrencySlot();

    // Register with watchdog
    watchdog.watch(executionId, agent.id);

    let lastError: string = '';
    let retries = 0;

    try {
      for (let attempt = 0; attempt <= this.options.maxRetries; attempt++) {
        try {
          const response = await Promise.race([
            agent.generate(prompt, options),
            this.createTimeout(this.options.timeoutMs),
          ]) as any;

          // Record activity
          watchdog.recordActivity(executionId);

          // Success — reset circuit breaker
          cb.failures = 0;
          cb.state = 'closed';

          const result: ExecutionResult<string> = {
            success: true,
            data: response.text,
            retries: attempt,
            durationMs: Date.now() - start,
            executionId,
          };

          // Record outcome for feedback loop
          feedbackLoop.recordOutcome({
            id: executionId,
            taskType: 'agent-generate',
            agentId: agent.id,
            prompt,
            result: response.text || '',
            status: 'success',
            scores: {},
            metadata: { retries: attempt, durationMs: result.durationMs },
            timestamp: Date.now(),
          });

          return result;
        } catch (err: any) {
          lastError = err.message || String(err);
          retries = attempt;

          // Record failure
          watchdog.recordActivity(executionId, undefined, 0);

          if (attempt < this.options.maxRetries) {
            const delay = this.options.retryDelayMs * Math.pow(2, attempt);
            console.log(`[Harness] Retry ${attempt + 1}/${this.options.maxRetries} for ${agent.id} in ${delay}ms: ${lastError}`);
            await this.sleep(delay);
          }
        }
      }

      // All retries exhausted
      cb.failures++;
      cb.lastFailure = Date.now();
      if (cb.failures >= this.options.circuitBreakerThreshold) {
        cb.state = 'open';
        console.warn(`[Harness] Circuit breaker OPENED for ${agent.id} after ${cb.failures} failures`);
      }

      feedbackLoop.recordOutcome({
        id: executionId,
        taskType: 'agent-generate',
        agentId: agent.id,
        prompt,
        result: '',
        status: 'failure',
        scores: {},
        metadata: { error: lastError, retries },
        timestamp: Date.now(),
      });

      return {
        success: false,
        error: lastError,
        retries,
        durationMs: Date.now() - start,
        executionId,
      };
    } finally {
      this.releaseConcurrencySlot();
      watchdog.complete(executionId);
    }
  }

  /**
   * Execute an agent.stream() call with harness protection.
   * Returns the stream directly — caller handles iteration.
   */
  async executeStream(
    agent: Agent,
    prompt: string,
    options?: { memory?: any; maxSteps?: number }
  ): Promise<{ stream: any; executionId: string }> {
    const executionId = `exec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await this.acquireConcurrencySlot();
    watchdog.watch(executionId, agent.id);

    try {
      const stream = await agent.stream(prompt, options);
      // Note: caller is responsible for calling releaseConcurrencySlot and watchdog.complete
      return { stream, executionId };
    } catch (err) {
      this.releaseConcurrencySlot();
      watchdog.complete(executionId);
      throw err;
    }
  }

  /** Health check — is the harness operational? */
  healthCheck(): {
    healthy: boolean;
    activeExecutions: number;
    queuedExecutions: number;
    openCircuitBreakers: string[];
  } {
    const openBreakers = Array.from(this.circuitBreakers.entries())
      .filter(([_, cb]) => cb.state === 'open')
      .map(([id]) => id);

    return {
      healthy: openBreakers.length === 0,
      activeExecutions: this.activeCount,
      queuedExecutions: this.queue.length,
      openCircuitBreakers: openBreakers,
    };
  }

  /** Reset circuit breaker for an agent */
  resetCircuitBreaker(agentId: string): void {
    this.circuitBreakers.delete(agentId);
  }

  // --- Private helpers ---

  private getCircuitBreaker(agentId: string): CircuitBreakerState {
    if (!this.circuitBreakers.has(agentId)) {
      this.circuitBreakers.set(agentId, { failures: 0, lastFailure: 0, state: 'closed' });
    }
    return this.circuitBreakers.get(agentId)!;
  }

  private async acquireConcurrencySlot(): Promise<void> {
    if (this.activeCount < this.options.maxConcurrent) {
      this.activeCount++;
      return;
    }
    return new Promise(resolve => {
      this.queue.push(() => {
        this.activeCount++;
        resolve();
      });
    });
  }

  private releaseConcurrencySlot(): void {
    this.activeCount--;
    const next = this.queue.shift();
    if (next) next();
  }

  private createTimeout(ms: number): Promise<never> {
    return new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Execution timed out after ${ms}ms`)), ms)
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Singleton
export const executionHarness = new ExecutionHarness();
