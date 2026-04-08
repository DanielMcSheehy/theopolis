// ============================================================================
// THEOPOLIS — Durable Workspace
// Isolated, persistent workspace per task/project with snapshots,
// rollback, audit logging, and migration support.
// ============================================================================

import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface WorkspaceSnapshot {
  id: string;
  workspaceId: string;
  files: Record<string, string>;   // path → content hash
  metadata: Record<string, any>;
  createdAt: string;
  description: string;
}

export interface AuditEntry {
  id: string;
  action: 'create' | 'write' | 'delete' | 'rename' | 'snapshot' | 'rollback';
  path: string;
  agentId?: string;
  details: string;
  timestamp: string;
}

export interface WorkspaceConfig {
  id: string;
  projectName: string;
  basePath: string;
  maxSnapshots: number;
  autoSnapshot: boolean;         // Snapshot before destructive operations
  auditEnabled: boolean;
}

// ---------------------------------------------------------------------------
// DurableWorkspace — Isolated, persistent workspace with full audit trail
// ---------------------------------------------------------------------------
export class DurableWorkspace {
  private config: WorkspaceConfig;
  private snapshots: WorkspaceSnapshot[] = [];
  private auditLog: AuditEntry[] = [];
  private auditCounter = 0;

  constructor(config: WorkspaceConfig) {
    this.config = config;
  }

  /** Initialize the workspace (create directories) */
  async initialize(): Promise<void> {
    const dirs = [
      this.config.basePath,
      path.join(this.config.basePath, '.theopolis'),
      path.join(this.config.basePath, '.theopolis', 'snapshots'),
      path.join(this.config.basePath, '.theopolis', 'audit'),
      path.join(this.config.basePath, 'src'),
      path.join(this.config.basePath, 'tests'),
    ];
    for (const dir of dirs) {
      await fs.mkdir(dir, { recursive: true });
    }
    this.audit('create', '.', 'Workspace initialized');
  }

  /** Read a file from the workspace */
  async readFile(filePath: string): Promise<string> {
    const resolved = this.resolvePath(filePath);
    return fs.readFile(resolved, 'utf-8');
  }

  /** Write a file, with optional auto-snapshot */
  async writeFile(filePath: string, content: string, agentId?: string): Promise<void> {
    const resolved = this.resolvePath(filePath);
    await fs.mkdir(path.dirname(resolved), { recursive: true });

    // Auto-snapshot before overwriting existing files
    if (this.config.autoSnapshot) {
      try {
        await fs.access(resolved);
        await this.createSnapshot(`Auto-snapshot before modifying ${filePath}`);
      } catch { /* file doesn't exist, skip snapshot */ }
    }

    await fs.writeFile(resolved, content, 'utf-8');
    this.audit('write', filePath, `${Buffer.byteLength(content)} bytes written`, agentId);
  }

  /** Delete a file */
  async deleteFile(filePath: string, agentId?: string): Promise<void> {
    const resolved = this.resolvePath(filePath);

    if (this.config.autoSnapshot) {
      await this.createSnapshot(`Auto-snapshot before deleting ${filePath}`);
    }

    await fs.unlink(resolved);
    this.audit('delete', filePath, 'File deleted', agentId);
  }

  /** List all files in the workspace */
  async listFiles(dir = '.'): Promise<string[]> {
    const resolved = this.resolvePath(dir);
    const files: string[] = [];

    async function walk(currentDir: string, basePath: string) {
      const entries = await fs.readdir(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.theopolis')) continue;
        const full = path.join(currentDir, entry.name);
        const relative = path.relative(basePath, full);
        if (entry.isDirectory()) {
          await walk(full, basePath);
        } else {
          files.push(relative);
        }
      }
    }

    await walk(resolved, this.config.basePath);
    return files;
  }

  /** Create a snapshot of the current workspace state */
  async createSnapshot(description: string): Promise<WorkspaceSnapshot> {
    const files = await this.listFiles();
    const fileHashes: Record<string, string> = {};

    for (const file of files) {
      const content = await this.readFile(file);
      fileHashes[file] = crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
    }

    const snapshot: WorkspaceSnapshot = {
      id: `snap_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      workspaceId: this.config.id,
      files: fileHashes,
      metadata: {
        fileCount: files.length,
        projectName: this.config.projectName,
      },
      createdAt: new Date().toISOString(),
      description,
    };

    this.snapshots.push(snapshot);

    // Save snapshot data to disk
    const snapshotDir = path.join(this.config.basePath, '.theopolis', 'snapshots', snapshot.id);
    await fs.mkdir(snapshotDir, { recursive: true });

    // Copy all current files into snapshot
    for (const file of files) {
      const content = await this.readFile(file);
      const dest = path.join(snapshotDir, file);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, content, 'utf-8');
    }

    await fs.writeFile(
      path.join(snapshotDir, 'manifest.json'),
      JSON.stringify(snapshot, null, 2)
    );

    this.audit('snapshot', '.', `Snapshot ${snapshot.id}: ${description}`);

    // Prune old snapshots
    while (this.snapshots.length > this.config.maxSnapshots) {
      const old = this.snapshots.shift()!;
      const oldDir = path.join(this.config.basePath, '.theopolis', 'snapshots', old.id);
      await fs.rm(oldDir, { recursive: true, force: true }).catch(() => {});
    }

    return snapshot;
  }

  /** Rollback to a specific snapshot */
  async rollback(snapshotId: string): Promise<void> {
    const snapshotDir = path.join(this.config.basePath, '.theopolis', 'snapshots', snapshotId);

    try {
      await fs.access(snapshotDir);
    } catch {
      throw new Error(`Snapshot ${snapshotId} not found`);
    }

    // Create a safety snapshot before rollback
    await this.createSnapshot(`Safety snapshot before rollback to ${snapshotId}`);

    // Read snapshot manifest
    const manifest: WorkspaceSnapshot = JSON.parse(
      await fs.readFile(path.join(snapshotDir, 'manifest.json'), 'utf-8')
    );

    // Delete current files
    const currentFiles = await this.listFiles();
    for (const file of currentFiles) {
      await fs.unlink(this.resolvePath(file)).catch(() => {});
    }

    // Restore snapshot files
    for (const file of Object.keys(manifest.files)) {
      const src = path.join(snapshotDir, file);
      const dest = this.resolvePath(file);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.copyFile(src, dest);
    }

    this.audit('rollback', '.', `Rolled back to snapshot ${snapshotId}`);
  }

  /** Get list of available snapshots */
  getSnapshots(): WorkspaceSnapshot[] {
    return [...this.snapshots];
  }

  /** Get the audit log */
  getAuditLog(limit = 100): AuditEntry[] {
    return this.auditLog.slice(-limit);
  }

  /** Serialize workspace state for migration */
  async serialize(): Promise<{
    config: WorkspaceConfig;
    files: Record<string, string>;
    auditLog: AuditEntry[];
  }> {
    const fileList = await this.listFiles();
    const files: Record<string, string> = {};

    for (const file of fileList) {
      files[file] = await this.readFile(file);
    }

    return {
      config: this.config,
      files,
      auditLog: this.auditLog,
    };
  }

  /** Restore from serialized state */
  async deserialize(state: { config: WorkspaceConfig; files: Record<string, string> }): Promise<void> {
    this.config = state.config;
    await this.initialize();

    for (const [filePath, content] of Object.entries(state.files)) {
      await this.writeFile(filePath, content, 'migration');
    }
  }

  // --- Private helpers ---

  private resolvePath(filePath: string): string {
    const resolved = path.resolve(this.config.basePath, filePath);
    if (!resolved.startsWith(path.resolve(this.config.basePath))) {
      throw new Error(`Path traversal denied: ${filePath}`);
    }
    return resolved;
  }

  private audit(action: AuditEntry['action'], filePath: string, details: string, agentId?: string): void {
    if (!this.config.auditEnabled) return;
    this.auditLog.push({
      id: `audit_${++this.auditCounter}`,
      action,
      path: filePath,
      agentId,
      details,
      timestamp: new Date().toISOString(),
    });
  }
}

// ---------------------------------------------------------------------------
// Factory function
// ---------------------------------------------------------------------------
export function createWorkspace(
  projectName: string,
  options: Partial<WorkspaceConfig> = {}
): DurableWorkspace {
  const id = `ws_${projectName}_${Date.now()}`;
  const basePath = options.basePath || path.join(
    process.env.THEOPOLIS_WORKSPACE || '/tmp/theopolis-workspaces',
    projectName
  );

  return new DurableWorkspace({
    id,
    projectName,
    basePath,
    maxSnapshots: 20,
    autoSnapshot: true,
    auditEnabled: true,
    ...options,
  });
}
