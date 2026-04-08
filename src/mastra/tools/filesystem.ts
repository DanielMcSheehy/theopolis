// ============================================================================
// THEOPOLIS — Filesystem Tools
// Sandboxed file I/O with path validation, backup support, and audit logging.
// ============================================================================

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import * as fs from 'fs/promises';
import * as path from 'path';
import { glob } from 'glob';

const WORKSPACE_ROOT = process.env.THEOPOLIS_WORKSPACE || '/tmp/theopolis-workspaces';

function validatePath(filePath: string): string {
  const resolved = path.resolve(WORKSPACE_ROOT, filePath);
  if (!resolved.startsWith(path.resolve(WORKSPACE_ROOT))) {
    throw new Error(`Path traversal denied: ${filePath}`);
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// readFile — Read file contents with path validation
// ---------------------------------------------------------------------------
export const readFileTool = createTool({
  id: 'read-file',
  description: 'Read the contents of a file within the workspace. Validates path to prevent directory traversal.',
  inputSchema: z.object({
    path: z.string().describe('Relative path within the workspace'),
    encoding: z.enum(['utf-8', 'base64']).default('utf-8').describe('File encoding'),
    maxBytes: z.number().optional().describe('Max bytes to read (truncates if exceeded)'),
  }),
  outputSchema: z.object({
    content: z.string(),
    size: z.number(),
    truncated: z.boolean(),
  }),
  execute: async ({ path: filePath, encoding, maxBytes }) => {
    const resolved = validatePath(filePath);
    const stat = await fs.stat(resolved);
    const buffer = await fs.readFile(resolved);
    const shouldTruncate = maxBytes !== undefined && stat.size > maxBytes;
    const content = shouldTruncate
      ? buffer.subarray(0, maxBytes).toString(encoding)
      : buffer.toString(encoding);
    return { content, size: stat.size, truncated: shouldTruncate };
  },
});

// ---------------------------------------------------------------------------
// writeFile — Write file with automatic backup
// ---------------------------------------------------------------------------
export const writeFileTool = createTool({
  id: 'write-file',
  description: 'Write content to a file. Creates parent directories if needed. Creates a .bak backup if the file already exists.',
  inputSchema: z.object({
    path: z.string().describe('Relative path within the workspace'),
    content: z.string().describe('File content to write'),
    createBackup: z.boolean().default(true).describe('Create .bak backup if file exists'),
  }),
  outputSchema: z.object({
    written: z.boolean(),
    bytesWritten: z.number(),
    backedUp: z.boolean(),
  }),
  execute: async ({ path: filePath, content, createBackup }) => {
    const resolved = validatePath(filePath);
    await fs.mkdir(path.dirname(resolved), { recursive: true });

    let backedUp = false;
    if (createBackup) {
      try {
        await fs.access(resolved);
        await fs.copyFile(resolved, resolved + '.bak');
        backedUp = true;
      } catch { /* file doesn't exist, no backup needed */ }
    }

    await fs.writeFile(resolved, content, 'utf-8');
    return { written: true, bytesWritten: Buffer.byteLength(content), backedUp };
  },
});

// ---------------------------------------------------------------------------
// listDirectory — List directory contents with filtering
// ---------------------------------------------------------------------------
export const listDirectoryTool = createTool({
  id: 'list-directory',
  description: 'List files and directories at a given path. Supports filtering by extension and recursive listing.',
  inputSchema: z.object({
    path: z.string().default('.').describe('Relative directory path'),
    recursive: z.boolean().default(false),
    extensions: z.array(z.string()).optional().describe('Filter by file extensions, e.g. [".ts", ".js"]'),
    maxEntries: z.number().default(200).describe('Maximum entries to return'),
  }),
  outputSchema: z.object({
    entries: z.array(z.object({
      name: z.string(),
      type: z.enum(['file', 'directory']),
      size: z.number(),
      modified: z.string(),
    })),
    total: z.number(),
    truncated: z.boolean(),
  }),
  execute: async ({ path: dirPath, recursive, extensions, maxEntries }) => {
    const resolved = validatePath(dirPath);
    const pattern = recursive ? '**/*' : '*';
    const matches = await glob(pattern, { cwd: resolved, withFileTypes: true });

    let entries: Array<{ name: string; type: 'file' | 'directory'; size: number; modified: string }> = [];

    for (const entry of matches) {
      if (entries.length >= maxEntries) break;
      const fullPath = path.join(resolved, entry.name);
      const stat = await fs.stat(fullPath).catch(() => null);
      if (!stat) continue;

      const ext = path.extname(entry.name);
      if (extensions && extensions.length > 0 && !extensions.includes(ext)) continue;

      entries.push({
        name: entry.name,
        type: stat.isDirectory() ? 'directory' : 'file',
        size: stat.size,
        modified: stat.mtime.toISOString(),
      });
    }

    return { entries, total: matches.length, truncated: matches.length > maxEntries };
  },
});

// ---------------------------------------------------------------------------
// searchFiles — Search files by content pattern
// ---------------------------------------------------------------------------
export const searchFilesTool = createTool({
  id: 'search-files',
  description: 'Search for files matching a glob pattern, optionally grep for content within matched files.',
  inputSchema: z.object({
    globPattern: z.string().describe('Glob pattern to match files, e.g. "**/*.ts"'),
    contentPattern: z.string().optional().describe('Regex pattern to search within file contents'),
    maxResults: z.number().default(50),
  }),
  outputSchema: z.object({
    results: z.array(z.object({
      file: z.string(),
      matches: z.array(z.object({
        line: z.number(),
        content: z.string(),
      })).optional(),
    })),
    totalFiles: z.number(),
  }),
  execute: async ({ globPattern, contentPattern, maxResults }) => {
    const matches = await glob(globPattern, { cwd: WORKSPACE_ROOT });
    const results: Array<{ file: string; matches?: Array<{ line: number; content: string }> }> = [];

    for (const file of matches.slice(0, maxResults)) {
      if (contentPattern) {
        const resolved = path.join(WORKSPACE_ROOT, file);
        try {
          const content = await fs.readFile(resolved, 'utf-8');
          const regex = new RegExp(contentPattern, 'gm');
          const lines = content.split('\n');
          const lineMatches: Array<{ line: number; content: string }> = [];
          lines.forEach((line, i) => {
            if (regex.test(line)) {
              lineMatches.push({ line: i + 1, content: line.trim() });
            }
            regex.lastIndex = 0;
          });
          if (lineMatches.length > 0) {
            results.push({ file, matches: lineMatches });
          }
        } catch { /* skip unreadable files */ }
      } else {
        results.push({ file });
      }
    }

    return { results, totalFiles: matches.length };
  },
});

export const filesystemTools = {
  readFileTool,
  writeFileTool,
  listDirectoryTool,
  searchFilesTool,
};
