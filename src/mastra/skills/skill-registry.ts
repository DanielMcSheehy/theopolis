// ============================================================================
// THEOPOLIS — Skill Registry
// Dynamic registration, discovery, versioning, and dependency resolution
// for reusable skill modules.
// ============================================================================

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface SkillManifest {
  name: string;
  version: string;
  description: string;
  author?: string;
  tools: string[];
  agents: string[];
  dependencies: string[];       // Other skill names this depends on
  tags: string[];
  homepage?: string;
  entrypoint: string;           // Path to main module
  registeredAt: string;
}

export interface SkillInstance {
  manifest: SkillManifest;
  tools: Record<string, any>;   // Loaded Mastra tool objects
  agents: Record<string, any>;  // Loaded Mastra agent objects
  status: 'loaded' | 'error' | 'disabled';
  error?: string;
}

// ---------------------------------------------------------------------------
// SkillRegistry — Central registry for all skills
// ---------------------------------------------------------------------------
export class SkillRegistry {
  private skills = new Map<string, SkillInstance>();
  private manifests = new Map<string, SkillManifest>();

  /** Register a skill manifest (metadata only) */
  registerManifest(manifest: SkillManifest): void {
    this.manifests.set(manifest.name, manifest);
    console.log(`[SkillRegistry] Registered manifest: ${manifest.name}@${manifest.version}`);
  }

  /** Load and activate a skill */
  async loadSkill(name: string, module: {
    tools?: Record<string, any>;
    agents?: Record<string, any>;
  }): Promise<void> {
    const manifest = this.manifests.get(name);
    if (!manifest) {
      throw new Error(`Skill manifest not found: ${name}. Register it first.`);
    }

    // Check dependencies
    for (const dep of manifest.dependencies) {
      if (!this.skills.has(dep) || this.skills.get(dep)!.status !== 'loaded') {
        throw new Error(`Missing dependency: ${name} requires ${dep}`);
      }
    }

    try {
      this.skills.set(name, {
        manifest,
        tools: module.tools || {},
        agents: module.agents || {},
        status: 'loaded',
      });
      console.log(`[SkillRegistry] Loaded skill: ${name}@${manifest.version} (${Object.keys(module.tools || {}).length} tools, ${Object.keys(module.agents || {}).length} agents)`);
    } catch (err: any) {
      this.skills.set(name, {
        manifest,
        tools: {},
        agents: {},
        status: 'error',
        error: err.message,
      });
      throw err;
    }
  }

  /** Unload a skill */
  unloadSkill(name: string): void {
    // Check if other skills depend on this one
    for (const [depName, instance] of this.skills) {
      if (instance.manifest.dependencies.includes(name) && instance.status === 'loaded') {
        throw new Error(`Cannot unload ${name}: ${depName} depends on it`);
      }
    }
    this.skills.delete(name);
    console.log(`[SkillRegistry] Unloaded skill: ${name}`);
  }

  /** Get all tools from all loaded skills */
  getAllTools(): Record<string, any> {
    const tools: Record<string, any> = {};
    for (const instance of this.skills.values()) {
      if (instance.status === 'loaded') {
        Object.assign(tools, instance.tools);
      }
    }
    return tools;
  }

  /** Get all agents from all loaded skills */
  getAllAgents(): Record<string, any> {
    const agents: Record<string, any> = {};
    for (const instance of this.skills.values()) {
      if (instance.status === 'loaded') {
        Object.assign(agents, instance.agents);
      }
    }
    return agents;
  }

  /** Search skills by tag, name, or description */
  search(query: string): SkillManifest[] {
    const lower = query.toLowerCase();
    return Array.from(this.manifests.values()).filter(m =>
      m.name.toLowerCase().includes(lower) ||
      m.description.toLowerCase().includes(lower) ||
      m.tags.some(t => t.toLowerCase().includes(lower))
    );
  }

  /** Get a specific skill instance */
  getSkill(name: string): SkillInstance | undefined {
    return this.skills.get(name);
  }

  /** List all registered skills with status */
  list(): Array<{ name: string; version: string; status: string; tools: number; agents: number }> {
    return Array.from(this.manifests.values()).map(m => {
      const instance = this.skills.get(m.name);
      return {
        name: m.name,
        version: m.version,
        status: instance?.status || 'registered',
        tools: instance ? Object.keys(instance.tools).length : m.tools.length,
        agents: instance ? Object.keys(instance.agents).length : m.agents.length,
      };
    });
  }

  /** Resolve dependency order for loading multiple skills */
  resolveDependencyOrder(skillNames: string[]): string[] {
    const resolved: string[] = [];
    const visiting = new Set<string>();
    const visited = new Set<string>();

    const visit = (name: string) => {
      if (visited.has(name)) return;
      if (visiting.has(name)) {
        throw new Error(`Circular dependency detected: ${name}`);
      }

      visiting.add(name);
      const manifest = this.manifests.get(name);
      if (manifest) {
        for (const dep of manifest.dependencies) {
          visit(dep);
        }
      }
      visiting.delete(name);
      visited.add(name);
      resolved.push(name);
    };

    for (const name of skillNames) {
      visit(name);
    }
    return resolved;
  }

  /** Serialize the registry state for export/sharing */
  serialize(): { manifests: SkillManifest[]; loadedSkills: string[] } {
    return {
      manifests: Array.from(this.manifests.values()),
      loadedSkills: Array.from(this.skills.entries())
        .filter(([_, s]) => s.status === 'loaded')
        .map(([name]) => name),
    };
  }
}

// Singleton
export const skillRegistry = new SkillRegistry();

// ---------------------------------------------------------------------------
// Built-in skill template manifests
// ---------------------------------------------------------------------------
skillRegistry.registerManifest({
  name: 'api-client',
  version: '1.0.0',
  description: 'Template for building API integration skills with retry, rate limiting, and typed responses',
  tools: ['api-request', 'api-auth', 'api-paginate'],
  agents: [],
  dependencies: [],
  tags: ['api', 'http', 'integration', 'template'],
  entrypoint: './templates/api-client-skill.ts',
  registeredAt: new Date().toISOString(),
});

skillRegistry.registerManifest({
  name: 'data-pipeline',
  version: '1.0.0',
  description: 'Template for data processing pipelines with streaming, checkpoints, and schema validation',
  tools: ['pipeline-run', 'pipeline-checkpoint', 'pipeline-validate'],
  agents: [],
  dependencies: [],
  tags: ['data', 'etl', 'pipeline', 'streaming', 'template'],
  entrypoint: './templates/data-pipeline-skill.ts',
  registeredAt: new Date().toISOString(),
});

skillRegistry.registerManifest({
  name: 'automation',
  version: '1.0.0',
  description: 'Template for browser and task automation with idempotent operations and structured logging',
  tools: ['automate-browser', 'automate-task', 'automate-schedule'],
  agents: [],
  dependencies: [],
  tags: ['automation', 'browser', 'tasks', 'scheduling', 'template'],
  entrypoint: './templates/automation-skill.ts',
  registeredAt: new Date().toISOString(),
});
