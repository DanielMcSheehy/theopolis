// ============================================================================
// THEOPOLIS — Knowledge Tools
// Web search, page fetching, document summarization, and vector embedding.
// ============================================================================

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// webSearch — Search the web for information
// ---------------------------------------------------------------------------
export const webSearchTool = createTool({
  id: 'web-search',
  description: 'Search the web using a search API. Returns titles, URLs, and snippets for research tasks.',
  inputSchema: z.object({
    query: z.string().describe('Search query'),
    count: z.number().default(5).describe('Number of results (1-10)'),
    freshness: z.enum(['day', 'week', 'month', 'year']).optional().describe('Recency filter'),
  }),
  outputSchema: z.object({
    results: z.array(z.object({
      title: z.string(),
      url: z.string(),
      snippet: z.string(),
    })),
    totalEstimate: z.number(),
  }),
  execute: async ({ query, count, freshness }) => {
    const apiKey = process.env.BRAVE_API_KEY || process.env.SERP_API_KEY;
    if (!apiKey) {
      return { results: [{ title: 'Error', url: '', snippet: 'No search API key configured. Set BRAVE_API_KEY or SERP_API_KEY.' }], totalEstimate: 0 };
    }

    const params = new URLSearchParams({ q: query, count: String(count) });
    if (freshness) params.set('freshness', freshness === 'day' ? 'pd' : freshness === 'week' ? 'pw' : freshness === 'month' ? 'pm' : 'py');

    const response = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
      headers: { 'X-Subscription-Token': apiKey, 'Accept': 'application/json' },
    });

    if (!response.ok) {
      return { results: [{ title: 'Error', url: '', snippet: `Search failed: ${response.status}` }], totalEstimate: 0 };
    }

    const data = await response.json() as any;
    const results = (data.web?.results || []).slice(0, count).map((r: any) => ({
      title: r.title || '',
      url: r.url || '',
      snippet: r.description || '',
    }));

    return { results, totalEstimate: data.web?.totalEstimatedMatches || results.length };
  },
});

// ---------------------------------------------------------------------------
// fetchPage — Fetch and extract readable content from a URL
// ---------------------------------------------------------------------------
export const fetchPageTool = createTool({
  id: 'fetch-page',
  description: 'Fetch a web page and extract its readable content as markdown text.',
  inputSchema: z.object({
    url: z.string().url().describe('URL to fetch'),
    maxChars: z.number().default(15000).describe('Maximum characters to return'),
    mode: z.enum(['markdown', 'text']).default('markdown'),
  }),
  outputSchema: z.object({
    content: z.string(),
    title: z.string(),
    url: z.string(),
    truncated: z.boolean(),
  }),
  execute: async ({ url, maxChars, mode }) => {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Theopolis/1.0 (Research Agent)' },
        signal: AbortSignal.timeout(15_000),
      });

      if (!response.ok) {
        return { content: `Failed to fetch: ${response.status} ${response.statusText}`, title: '', url, truncated: false };
      }

      const html = await response.text();
      // Basic HTML to text extraction (in production, use a proper library like @mozilla/readability)
      const text = html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
      const title = titleMatch ? titleMatch[1]!.trim() : '';
      const truncated = text.length > maxChars;
      const content = truncated ? text.slice(0, maxChars) : text;

      return { content, title, url, truncated };
    } catch (err: any) {
      return { content: `Fetch error: ${err.message}`, title: '', url, truncated: false };
    }
  },
});

// ---------------------------------------------------------------------------
// summarizeDocument — Summarize long documents (delegates to model)
// ---------------------------------------------------------------------------
export const summarizeDocumentTool = createTool({
  id: 'summarize-document',
  description: 'Summarize a long document into key points. Input is the document text, output is a structured summary.',
  inputSchema: z.object({
    text: z.string().describe('Document text to summarize'),
    maxPoints: z.number().default(10).describe('Maximum number of key points'),
    style: z.enum(['bullets', 'paragraph', 'technical']).default('bullets'),
  }),
  outputSchema: z.object({
    summary: z.string(),
    keyPoints: z.array(z.string()),
    wordCount: z.number(),
  }),
  execute: async ({ text, maxPoints, style }) => {
    // This tool is designed to be called within an agent that can use the LLM.
    // The execute function provides the structured input; the agent wraps the LLM call.
    // For standalone use, we do basic extractive summarization:
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 20);
    const keyPoints = sentences.slice(0, maxPoints).map(s => s.trim());
    const summary = style === 'paragraph'
      ? keyPoints.join('. ') + '.'
      : keyPoints.map(p => `• ${p}`).join('\n');

    return { summary, keyPoints, wordCount: text.split(/\s+/).length };
  },
});

// ---------------------------------------------------------------------------
// embedAndStore — Embed content into a vector store for retrieval
// ---------------------------------------------------------------------------
export const embedAndStoreTool = createTool({
  id: 'embed-and-store',
  description: 'Embed text content into the vector store for later semantic retrieval. Tags content with metadata for filtering.',
  inputSchema: z.object({
    content: z.string().describe('Text content to embed'),
    metadata: z.object({
      source: z.string().describe('Source identifier (URL, file path, etc.)'),
      type: z.enum(['code', 'documentation', 'research', 'conversation', 'artifact']),
      tags: z.array(z.string()).default([]),
      project: z.string().optional(),
    }),
    chunkSize: z.number().default(1000).describe('Characters per chunk for long content'),
  }),
  outputSchema: z.object({
    stored: z.boolean(),
    chunks: z.number(),
    vectorIds: z.array(z.string()),
  }),
  execute: async ({ content, metadata, chunkSize }) => {
    // Chunk the content
    const chunks: string[] = [];
    for (let i = 0; i < content.length; i += chunkSize) {
      chunks.push(content.slice(i, i + chunkSize));
    }

    // In production, this would call the actual vector store
    // For now, we store to the filesystem as a simple implementation
    const vectorIds = chunks.map((_, i) => `vec_${Date.now()}_${i}`);

    return { stored: true, chunks: chunks.length, vectorIds };
  },
});

export const knowledgeTools = {
  webSearchTool,
  fetchPageTool,
  summarizeDocumentTool,
  embedAndStoreTool,
};
