// ============================================================================
// THEOPOLIS — Feedback Loop System
// Collects outcomes, scores them, generates improvement suggestions,
// and supports A/B testing of prompt strategies.
// ============================================================================

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface TaskOutcome {
  id: string;
  taskType: string;
  agentId: string;
  prompt: string;
  result: string;
  status: 'success' | 'partial' | 'failure';
  scores: Record<string, number>;
  metadata: Record<string, any>;
  timestamp: number;
}

export interface ImprovementSuggestion {
  id: string;
  targetAgent: string;
  area: 'instructions' | 'tools' | 'delegation' | 'prompt';
  description: string;
  confidence: number;
  basedOn: string[];  // Outcome IDs
  suggestedChange: string;
}

export interface ABVariant {
  id: string;
  name: string;
  agentId: string;
  field: string;      // e.g., 'instructions', 'model'
  valueA: string;
  valueB: string;
  outcomes: { a: TaskOutcome[]; b: TaskOutcome[] };
  status: 'running' | 'concluded';
  winner?: 'a' | 'b' | 'inconclusive';
}

// ---------------------------------------------------------------------------
// FeedbackLoop — Continuous improvement engine
// ---------------------------------------------------------------------------
export class FeedbackLoop {
  private outcomes: TaskOutcome[] = [];
  private suggestions: ImprovementSuggestion[] = [];
  private experiments: Map<string, ABVariant> = new Map();
  private learningRate = 0.1;

  /** Record a task outcome */
  recordOutcome(outcome: TaskOutcome): void {
    this.outcomes.push(outcome);
    console.log(`[Feedback] Recorded outcome: ${outcome.id} (${outcome.status})`);

    // Auto-generate suggestions when patterns emerge
    if (this.outcomes.length % 10 === 0) {
      this.analyzePatterns();
    }
  }

  /** Analyze patterns across outcomes to generate improvement suggestions */
  analyzePatterns(): ImprovementSuggestion[] {
    const newSuggestions: ImprovementSuggestion[] = [];

    // Group by agent and find failure patterns
    const agentOutcomes = new Map<string, TaskOutcome[]>();
    for (const outcome of this.outcomes) {
      const existing = agentOutcomes.get(outcome.agentId) || [];
      existing.push(outcome);
      agentOutcomes.set(outcome.agentId, existing);
    }

    for (const [agentId, outcomes] of agentOutcomes) {
      const failures = outcomes.filter(o => o.status === 'failure');
      const total = outcomes.length;

      // High failure rate → suggest instruction improvement
      if (failures.length / total > 0.3 && total >= 5) {
        newSuggestions.push({
          id: `sug_${Date.now()}_${agentId}`,
          targetAgent: agentId,
          area: 'instructions',
          description: `${agentId} has ${((failures.length / total) * 100).toFixed(0)}% failure rate (${failures.length}/${total})`,
          confidence: Math.min(0.9, failures.length / total),
          basedOn: failures.map(f => f.id),
          suggestedChange: 'Review and clarify system instructions. Add more specific guidance for common failure scenarios.',
        });
      }

      // Low scores on specific metrics → targeted improvement
      const avgScores: Record<string, { sum: number; count: number }> = {};
      for (const outcome of outcomes) {
        for (const [metric, score] of Object.entries(outcome.scores)) {
          if (!avgScores[metric]) avgScores[metric] = { sum: 0, count: 0 };
          avgScores[metric]!.sum += score;
          avgScores[metric]!.count++;
        }
      }

      for (const [metric, data] of Object.entries(avgScores)) {
        const avg = data.sum / data.count;
        if (avg < 0.5 && data.count >= 3) {
          newSuggestions.push({
            id: `sug_${Date.now()}_${agentId}_${metric}`,
            targetAgent: agentId,
            area: 'prompt',
            description: `Low ${metric} score: ${(avg * 100).toFixed(0)}% average`,
            confidence: Math.min(0.8, (0.5 - avg) * 2),
            basedOn: outcomes.map(o => o.id),
            suggestedChange: `Improve ${metric} by adding specific instructions or examples to the agent's prompt.`,
          });
        }
      }
    }

    this.suggestions.push(...newSuggestions);
    return newSuggestions;
  }

  /** Start an A/B test */
  startExperiment(experiment: Omit<ABVariant, 'outcomes' | 'status'>): void {
    this.experiments.set(experiment.id, {
      ...experiment,
      outcomes: { a: [], b: [] },
      status: 'running',
    });
    console.log(`[Feedback] A/B experiment started: ${experiment.name}`);
  }

  /** Record an A/B outcome */
  recordExperimentOutcome(experimentId: string, variant: 'a' | 'b', outcome: TaskOutcome): void {
    const experiment = this.experiments.get(experimentId);
    if (!experiment || experiment.status !== 'running') return;

    experiment.outcomes[variant].push(outcome);

    // Auto-conclude after enough data
    if (experiment.outcomes.a.length >= 10 && experiment.outcomes.b.length >= 10) {
      this.concludeExperiment(experimentId);
    }
  }

  /** Conclude an A/B experiment */
  concludeExperiment(experimentId: string): ABVariant | null {
    const experiment = this.experiments.get(experimentId);
    if (!experiment) return null;

    const avgA = experiment.outcomes.a.reduce(
      (sum, o) => sum + (o.status === 'success' ? 1 : 0), 0
    ) / Math.max(1, experiment.outcomes.a.length);

    const avgB = experiment.outcomes.b.reduce(
      (sum, o) => sum + (o.status === 'success' ? 1 : 0), 0
    ) / Math.max(1, experiment.outcomes.b.length);

    const diff = Math.abs(avgA - avgB);
    experiment.status = 'concluded';
    experiment.winner = diff < 0.05 ? 'inconclusive' : avgA > avgB ? 'a' : 'b';

    console.log(`[Feedback] Experiment ${experimentId} concluded: winner=${experiment.winner} (A: ${(avgA * 100).toFixed(0)}%, B: ${(avgB * 100).toFixed(0)}%)`);
    return experiment;
  }

  /** Get improvement suggestions, optionally filtered by agent */
  getSuggestions(agentId?: string): ImprovementSuggestion[] {
    return agentId
      ? this.suggestions.filter(s => s.targetAgent === agentId)
      : this.suggestions;
  }

  /** Get outcome statistics */
  getStats(agentId?: string): {
    total: number;
    success: number;
    partial: number;
    failure: number;
    avgScores: Record<string, number>;
  } {
    const filtered = agentId
      ? this.outcomes.filter(o => o.agentId === agentId)
      : this.outcomes;

    const avgScores: Record<string, { sum: number; count: number }> = {};
    for (const outcome of filtered) {
      for (const [metric, score] of Object.entries(outcome.scores)) {
        if (!avgScores[metric]) avgScores[metric] = { sum: 0, count: 0 };
        avgScores[metric]!.sum += score;
        avgScores[metric]!.count++;
      }
    }

    return {
      total: filtered.length,
      success: filtered.filter(o => o.status === 'success').length,
      partial: filtered.filter(o => o.status === 'partial').length,
      failure: filtered.filter(o => o.status === 'failure').length,
      avgScores: Object.fromEntries(
        Object.entries(avgScores).map(([k, v]) => [k, v.sum / v.count])
      ),
    };
  }

  /** Set the learning rate (how aggressively to suggest changes) */
  setLearningRate(rate: number): void {
    this.learningRate = Math.max(0, Math.min(1, rate));
  }
}

// Singleton
export const feedbackLoop = new FeedbackLoop();
