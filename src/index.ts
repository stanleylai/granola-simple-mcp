import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const GRANOLA_API_BASE = "https://public-api.granola.ai";
const API_KEY = process.env.GRANOLA_API_KEY;

if (!API_KEY) {
  console.error("GRANOLA_API_KEY environment variable is required");
  process.exit(1);
}

async function granolaFetch(path: string, params?: Record<string, string>): Promise<unknown> {
  const url = new URL(path, GRANOLA_API_BASE);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value) url.searchParams.set(key, value);
    }
  }

  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${API_KEY}` },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Granola API ${response.status}: ${body}`);
  }

  return response.json();
}

const server = new McpServer({
  name: "granola",
  version: "1.0.0",
});

// Tool: list_notes
server.tool(
  "list_notes",
  "List Granola meeting notes, optionally filtered by date range. Returns titles, dates, and IDs for browsing.",
  {
    created_after: z.string().optional().describe("ISO date/datetime — only return notes created after this (e.g. '2025-03-24')"),
    created_before: z.string().optional().describe("ISO date/datetime — only return notes created before this"),
    updated_after: z.string().optional().describe("ISO date/datetime — only return notes updated after this"),
    page_size: z.number().min(1).max(30).optional().describe("Results per page (1-30, default 10)"),
    cursor: z.string().optional().describe("Pagination cursor from a previous response"),
  },
  async ({ created_after, created_before, updated_after, page_size, cursor }) => {
    const params: Record<string, string> = {};
    if (created_after) params.created_after = created_after;
    if (created_before) params.created_before = created_before;
    if (updated_after) params.updated_after = updated_after;
    if (page_size) params.page_size = String(page_size);
    if (cursor) params.cursor = cursor;

    const data = await granolaFetch("/v1/notes", params) as {
      notes: Array<{ id: string; title: string; owner: { name: string; email: string }; created_at: string; updated_at: string }>;
      hasMore: boolean;
      cursor?: string;
    };

    const lines = data.notes.map((n) =>
      `- **${n.title}** (${new Date(n.created_at).toLocaleDateString()})\n  ID: ${n.id} | Owner: ${n.owner.name} <${n.owner.email}>`
    );

    let text = lines.length > 0
      ? lines.join("\n")
      : "No notes found for the given filters.";

    if (data.hasMore && data.cursor) {
      text += `\n\n_More results available. Use cursor: "${data.cursor}" to get the next page._`;
    }

    return { content: [{ type: "text", text }] };
  }
);

// Tool: get_note
server.tool(
  "get_note",
  "Get full details and AI summary for a specific Granola meeting note.",
  {
    note_id: z.string().describe("The note ID (e.g. 'not_...')"),
  },
  async ({ note_id }) => {
    const data = await granolaFetch(`/v1/notes/${note_id}`) as {
      id: string; title: string; summary: string;
      owner: { name: string; email: string };
      created_at: string; updated_at: string;
    };

    const text = [
      `# ${data.title}`,
      `**Owner:** ${data.owner.name} <${data.owner.email}>`,
      `**Created:** ${data.created_at}`,
      `**Updated:** ${data.updated_at}`,
      "",
      "## Summary",
      data.summary,
    ].join("\n");

    return { content: [{ type: "text", text }] };
  }
);

// Tool: get_transcript
server.tool(
  "get_transcript",
  "Get the full transcript for a Granola meeting note.",
  {
    note_id: z.string().describe("The note ID (e.g. 'not_...')"),
  },
  async ({ note_id }) => {
    const data = await granolaFetch(`/v1/notes/${note_id}`, { include: "transcript" }) as {
      id: string; title: string; transcript: unknown;
      created_at: string;
    };

    const text = [
      `# Transcript: ${data.title}`,
      `**Date:** ${data.created_at}`,
      "",
      typeof data.transcript === "string"
        ? data.transcript
        : JSON.stringify(data.transcript, null, 2),
    ].join("\n");

    return { content: [{ type: "text", text }] };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Granola MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
