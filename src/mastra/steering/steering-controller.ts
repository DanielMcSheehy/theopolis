// ============================================================================
// THEOPOLIS — Steering Controller
// Real-time intervention in running agents via Mastra delegation hooks.
// Supports pause/resume, feedback injection, redirection, and audit logging.
// ============================================================================

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface SteeringAction {
  type: 'feedback' | 'redirect' | 'pause' | 'resume' | 'override-tools' | 'stop';
  target?: string;        // Agent ID to steer
  message?: string;       // Feedback text to inject
  redirectTo?: string;    // Agent to redirect to
  allowedTools?: string[]; // Tool whitelist override
  timestamp: number;
}

export interface SteeringLogEntry {
  id: string;
  action: SteeringAction;
  context: {
    iteration: number;
    activeAgent: string;
    prompt: string;
  };
  result: 'applied' | 'rejected' | 'queued';
  timestamp: number;
}

// ---------------------------------------------------------------------------
// SteeringController — Manages real-time agent steering
// ---------------------------------------------------------------------------
export class SteeringController {
  private actionQueue: SteeringAction[] = [];
  private log: SteeringLogEntry[] = [];
  private paused = new Set<string>();
  private logIdCounter = 0;

  /** Queue a steering action for the next delegation/iteration */
  steer(action: SteeringAction): void {
    this.actionQueue.push(action);
    console.log(`[Steering] Queued: ${action.type} → ${action.target || 'all'}`);
  }

  /** Inject feedback into an agent's next iteration */
  injectFeedback(agentId: string, feedback: string): void {
    this.steer({
      type: 'feedback',
      target: agentId,
      message: feedback,
      timestamp: Date.now(),
    });
  }

  /** Redirect delegation from one agent to another */
  redirect(fromAgent: string, toAgent: string, reason: string): void {
    this.steer({
      type: 'redirect',
      target: fromAgent,
      redirectTo: toAgent,
      message: reason,
      timestamp: Date.now(),
    });
  }

  /** Pause an agent's execution */
  pause(agentId: string): void {
    this.paused.add(agentId);
    this.steer({ type: 'pause', target: agentId, timestamp: Date.now() });
  }

  /** Resume a paused agent */
  resume(agentId: string): void {
    this.paused.delete(agentId);
    this.steer({ type: 'resume', target: agentId, timestamp: Date.now() });
  }

  /** Stop an agent entirely */
  stop(agentId: string, reason: string): void {
    this.steer({ type: 'stop', target: agentId, message: reason, timestamp: Date.now() });
  }

  /** Override which tools an agent can use */
  overrideTools(agentId: string, allowedTools: string[]): void {
    this.steer({ type: 'override-tools', target: agentId, allowedTools, timestamp: Date.now() });
  }

  /**
   * Consume pending actions for a specific agent.
   * Called from delegation hooks (onDelegationStart, onIterationComplete).
   */
  consumeActions(agentId: string): SteeringAction[] {
    const pending = this.actionQueue.filter(
      a => !a.target || a.target === agentId
    );
    this.actionQueue = this.actionQueue.filter(
      a => a.target && a.target !== agentId
    );

    // Log consumed actions
    for (const action of pending) {
      this.log.push({
        id: `steer_${++this.logIdCounter}`,
        action,
        context: { iteration: 0, activeAgent: agentId, prompt: '' },
        result: 'applied',
        timestamp: Date.now(),
      });
    }

    return pending;
  }

  /** Check if an agent is paused */
  isPaused(agentId: string): boolean {
    return this.paused.has(agentId);
  }

  /** Get the steering log */
  getLog(limit = 50): SteeringLogEntry[] {
    return this.log.slice(-limit);
  }

  /** Clear the steering log */
  clearLog(): void {
    this.log = [];
  }

  /**
   * Create Mastra-compatible delegation hooks that integrate with steering.
   * Use these as the delegation config on the supervisor agent.
   */
  createDelegationHooks() {
    const controller = this;

    return {
      onDelegationStart: async (context: { primitiveId: string; prompt: string; iteration: number }) => {
        const { primitiveId, prompt, iteration } = context;

        // Check if agent is paused
        if (controller.isPaused(primitiveId)) {
          return {
            proceed: false,
            rejectionReason: `Agent ${primitiveId} is paused by steering controller. Resume to continue.`,
          };
        }

        // Consume any pending steering actions
        const actions = controller.consumeActions(primitiveId);
        let modifiedPrompt = prompt;
        let proceed = true;

        for (const action of actions) {
          switch (action.type) {
            case 'feedback':
              modifiedPrompt += `\n\n[STEERING FEEDBACK]: ${action.message}`;
              break;
            case 'redirect':
              return {
                proceed: false,
                rejectionReason: `Steering redirect: use ${action.redirectTo} instead. Reason: ${action.message}`,
              };
            case 'stop':
              return {
                proceed: false,
                rejectionReason: `Steering stop: ${action.message}`,
              };
            case 'override-tools':
              // Tool overrides are handled at the agent level, not in delegation
              break;
          }
        }

        return { proceed, modifiedPrompt };
      },

      onDelegationComplete: async (context: { primitiveId: string; result: any; error: any; bail: () => void }) => {
        const actions = controller.consumeActions(context.primitiveId);
        for (const action of actions) {
          if (action.type === 'stop') {
            context.bail();
            return { feedback: `Stopped by steering: ${action.message}` };
          }
        }
        return {};
      },
    };
  }
}

// Singleton instance
export const steeringController = new SteeringController();
