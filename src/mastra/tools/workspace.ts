// ============================================================================
// THEOPOLIS — Workspace Tools
// Project scaffolding, status tracking, and artifact management.
// ============================================================================

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';

const WORKSPACE_ROOT = process.env.THEOPOLIS_WORKSPACE || '/tmp/theopolis-workspaces';
const ARTIFACT_DIR = process.env.THEOPOLIS_ARTIFACTS || '/tmp/theopolis-artifacts';

// ---------------------------------------------------------------------------
// createProject — Scaffold a new project workspace
// ---------------------------------------------------------------------------
export const createProjectTool = createTool({
  id: 'create-project',
  description: 'Create a new isolated project workspace with standard directory structure and configuration.',
  inputSchema: z.object({
    name: z.string().describe('Project name (kebab-case)'),
    template: z.enum(['blank', 'typescript', 'react', 'api', 'library']).default('typescript'),
    description: z.string().optional(),
  }),
  outputSchema: z.object({
    projectPath: z.string(),
    created: z.boolean(),
    structure: z.array(z.string()),
  }),
  execute: async ({ name, template, description }) => {
    const projectPath = path.join(WORKSPACE_ROOT, name);
    await fs.mkdir(projectPath, { recursive: true });

    const dirs: string[] = ['src', 'tests', 'docs', '.theopolis'];
    if (template === 'react') dirs.push('src/components', 'src/hooks', 'public');
    if (template === 'api') dirs.push('src/routes', 'src/middleware', 'src/models');
    if (template === 'library') dirs.push('src/lib', 'examples');

    for (const dir of dirs) {
      await fs.mkdir(path.join(projectPath, dir), { recursive: true });
    }

    // Write project manifest
    const manifest = {
      name,
      template,
      description: description || '',
      created: new Date().toISOString(),
      status: 'active',
      artifacts: [],
      history: [{ event: 'created', timestamp: new Date().toISOString() }],
    };
    await fs.writeFile(
      path.join(projectPath, '.theopolis', 'manifest.json'),
      JSON.stringify(manifest, null, 2)
    );

    // Write basic tsconfig for TS projects
    if (['typescript', 'react', 'api', 'library'].includes(template)) {
      await fs.writeFile(path.join(projectPath, 'tsconfig.json'), JSON.stringify({
        compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'bundler', strict: true, outDir: 'dist', rootDir: 'src' },
        include: ['src/**/*'],
      }, null, 2));
    }

    const structure = dirs.map(d => `${name}/${d}/`);
    return { projectPath, created: true, structure };
  },
});

// ---------------------------------------------------------------------------
// getProjectStatus — Check project state and progress
// ---------------------------------------------------------------------------
export const getProjectStatusTool = createTool({
  id: 'get-project-status',
  description: 'Get the current status of a project including file counts, recent changes, and artifact status.',
  inputSchema: z.object({
    projectName: z.string().describe('Project name'),
  }),
  outputSchema: z.object({
    exists: z.boolean(),
    status: z.string(),
    fileCount: z.number(),
    totalSize: z.number(),
    lastModified: z.string(),
    artifacts: z.array(z.string()),
    history: z.array(z.object({ event: z.string(), timestamp: z.string() })),
  }),
  execute: async ({ projectName }) => {
    const projectPath = path.join(WORKSPACE_ROOT, projectName);

    try {
      await fs.access(projectPath);
    } catch {
      return { exists: false, status: 'not-found', fileCount: 0, totalSize: 0, lastModified: '', artifacts: [], history: [] };
    }

    // Count files and total size
    let fileCount = 0;
    let totalSize = 0;
    let lastModified = new Date(0);

    async function walk(dir: string) {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          await walk(full);
        } else if (entry.isFile()) {
          fileCount++;
          const stat = await fs.stat(full);
          totalSize += stat.size;
          if (stat.mtime > lastModified) lastModified = stat.mtime;
        }
      }
    }
    await walk(projectPath);

    // Read manifest
    let manifest: any = { status: 'unknown', artifacts: [], history: [] };
    try {
      const raw = await fs.readFile(path.join(projectPath, '.theopolis', 'manifest.json'), 'utf-8');
      manifest = JSON.parse(raw);
    } catch {}

    return {
      exists: true,
      status: manifest.status || 'active',
      fileCount,
      totalSize,
      lastModified: lastModified.toISOString(),
      artifacts: manifest.artifacts || [],
      history: manifest.history || [],
    };
  },
});

// ---------------------------------------------------------------------------
// saveArtifact — Save a generated artifact with versioning
// ---------------------------------------------------------------------------
export const saveArtifactTool = createTool({
  id: 'save-artifact',
  description: 'Save a generated artifact (code, config, docs) with content-addressable versioning and metadata.',
  inputSchema: z.object({
    name: z.string().describe('Artifact name'),
    content: z.string().describe('Artifact content'),
    type: z.enum(['code', 'config', 'documentation', 'test', 'schema', 'other']),
    project: z.string().optional().describe('Associated project name'),
    tags: z.array(z.string()).default([]),
    metadata: z.record(z.string()).optional(),
  }),
  outputSchema: z.object({
    artifactId: z.string(),
    hash: z.string(),
    version: z.number(),
    path: z.string(),
    isNew: z.boolean(),
  }),
  execute: async ({ name, content, type, project, tags, metadata }) => {
    await fs.mkdir(ARTIFACT_DIR, { recursive: true });

    const hash = crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
    const artifactDir = path.join(ARTIFACT_DIR, name);
    await fs.mkdir(artifactDir, { recursive: true });

    // Check for existing versions
    const existing = await fs.readdir(artifactDir).catch(() => [] as string[]);
    const versions = existing.filter(f => f.startsWith('v')).sort();
    const version = versions.length + 1;

    // Check if content already exists (dedup)
    for (const vFile of versions) {
      const meta = JSON.parse(await fs.readFile(path.join(artifactDir, vFile, 'meta.json'), 'utf-8').catch(() => '{}'));
      if (meta.hash === hash) {
        return { artifactId: `${name}@${meta.version}`, hash, version: meta.version, path: path.join(artifactDir, vFile), isNew: false };
      }
    }

    const versionDir = path.join(artifactDir, `v${version}`);
    await fs.mkdir(versionDir, { recursive: true });

    await fs.writeFile(path.join(versionDir, 'content'), content, 'utf-8');
    await fs.writeFile(path.join(versionDir, 'meta.json'), JSON.stringify({
      name, hash, version, type, project, tags, metadata,
      created: new Date().toISOString(),
    }, null, 2));

    return { artifactId: `${name}@v${version}`, hash, version, path: versionDir, isNew: true };
  },
});

// ---------------------------------------------------------------------------
// loadArtifact — Load a previously saved artifact
// ---------------------------------------------------------------------------
export const loadArtifactTool = createTool({
  id: 'load-artifact',
  description: 'Load a previously saved artifact by name, optionally specifying a version. Returns latest version by default.',
  inputSchema: z.object({
    name: z.string().describe('Artifact name'),
    version: z.number().optional().describe('Specific version number (latest if omitted)'),
  }),
  outputSchema: z.object({
    found: z.boolean(),
    content: z.string(),
    version: z.number(),
    type: z.string(),
    hash: z.string(),
    created: z.string(),
    tags: z.array(z.string()),
  }),
  execute: async ({ name, version }) => {
    const artifactDir = path.join(ARTIFACT_DIR, name);

    try {
      const versions = (await fs.readdir(artifactDir)).filter(f => f.startsWith('v')).sort();
      if (versions.length === 0) {
        return { found: false, content: '', version: 0, type: '', hash: '', created: '', tags: [] };
      }

      const targetVersion = version ? `v${version}` : versions[versions.length - 1]!;
      const versionDir = path.join(artifactDir, targetVersion);

      const content = await fs.readFile(path.join(versionDir, 'content'), 'utf-8');
      const meta = JSON.parse(await fs.readFile(path.join(versionDir, 'meta.json'), 'utf-8'));

      return {
        found: true,
        content,
        version: meta.version,
        type: meta.type,
        hash: meta.hash,
        created: meta.created,
        tags: meta.tags || [],
      };
    } catch {
      return { found: false, content: '', version: 0, type: '', hash: '', created: '', tags: [] };
    }
  },
});

export const workspaceTools = {
  createProjectTool,
  getProjectStatusTool,
  saveArtifactTool,
  loadArtifactTool,
};
