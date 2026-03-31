import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { version: PKG_VERSION } = require("../package.json") as { version: string };

const GRANOLA_API_BASE = "https://public-api.granola.ai";
const API_KEY = process.env.GRANOLA_API_KEY;

if (!API_KEY) {
  console.error("GRANOLA_API_KEY environment variable is required");
  process.exit(1);
}

const NOTE_ID_PATTERN = /^[a-zA-Z0-9_-]{1,256}$/;
const FETCH_TIMEOUT_MS = 30_000;

function validateNoteId(noteId: string): string {
  if (!NOTE_ID_PATTERN.test(noteId)) {
    throw new Error("Invalid note ID format. Expected 1-256 alphanumeric characters, hyphens, or underscores.");
  }
  return noteId;
}

async function granolaFetch(path: string, params?: Record<string, string>): Promise<unknown> {
  const url = new URL(path, GRANOLA_API_BASE);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value) url.searchParams.set(key, value);
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${API_KEY}` },
      signal: controller.signal,
    });

    if (!response.ok) {
      const status = response.status;
      if (status === 401) throw new Error("Granola API: unauthorized — check your API key");
      if (status === 404) throw new Error("Granola API: note not found (it may lack an AI summary/transcript)");
      if (status === 429) throw new Error("Granola API: rate limited — try again shortly");
      throw new Error(`Granola API returned status ${status}`);
    }

    return response.json();
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("Granola API: request timed out after 30s");
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

function toolError(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

const server = new McpServer({
  name: "granola",
  version: PKG_VERSION,
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
    try {
      const params: Record<string, string> = {};
      if (created_after) params.created_after = created_after;
      if (created_before) params.created_before = created_before;
      if (updated_after) params.updated_after = updated_after;
      if (page_size) params.page_size = String(page_size);
      if (cursor) params.cursor = cursor;

      const data = await granolaFetch("/v1/notes", params) as Record<string, unknown>;
      const notes = Array.isArray(data.notes) ? data.notes : [];

      const lines = notes.map((n: Record<string, unknown>) => {
        const title = n.title ?? "Untitled";
        const id = n.id ?? "unknown";
        const createdAt = typeof n.created_at === "string" ? new Date(n.created_at).toLocaleDateString() : "unknown date";
        const owner = n.owner as Record<string, string> | undefined;
        const ownerStr = owner?.name ? `${owner.name} <${owner.email}>` : "unknown";
        return `- **${title}** (${createdAt})\n  ID: ${id} | Owner: ${ownerStr}`;
      });

      let text = lines.length > 0
        ? lines.join("\n")
        : "No notes found for the given filters.";

      if (data.hasMore && typeof data.cursor === "string") {
        text += `\n\n_More results available. Use cursor: "${data.cursor}" to get the next page._`;
      }

      return { content: [{ type: "text", text }] };
    } catch (err) {
      return toolError(err instanceof Error ? err.message : "Unknown error listing notes");
    }
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
    try {
      const id = validateNoteId(note_id);
      const data = await granolaFetch(`/v1/notes/${id}`) as Record<string, unknown>;
      const owner = data.owner as Record<string, string> | undefined;
      const attendees = Array.isArray(data.attendees)
        ? (data.attendees as Array<Record<string, string>>).map(a => a.name || a.email).join(", ")
        : null;
      const folders = Array.isArray(data.folder_membership)
        ? (data.folder_membership as Array<Record<string, string>>).map(f => f.name).join(", ")
        : null;

      const lines = [
        `# ${data.title ?? "Untitled"}`,
        `**Owner:** ${owner?.name ? `${owner.name} <${owner.email}>` : "unknown"}`,
        `**Created:** ${data.created_at ?? "unknown"}`,
        `**Updated:** ${data.updated_at ?? "unknown"}`,
      ];
      if (attendees) lines.push(`**Attendees:** ${attendees}`);
      if (folders) lines.push(`**Folder:** ${folders}`);
      lines.push("");
      lines.push("## Summary");
      lines.push(
        typeof data.summary_markdown === "string" ? data.summary_markdown
        : typeof data.summary_text === "string" ? data.summary_text
        : "No summary available."
      );

      return { content: [{ type: "text", text: lines.join("\n") }] };
    } catch (err) {
      return toolError(err instanceof Error ? err.message : "Unknown error fetching note");
    }
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
    try {
      const id = validateNoteId(note_id);
      const data = await granolaFetch(`/v1/notes/${id}`, { include: "transcript" }) as Record<string, unknown>;

      const text = [
        `# Transcript: ${data.title ?? "Untitled"}`,
        `**Date:** ${data.created_at ?? "unknown"}`,
        "",
        typeof data.transcript === "string"
          ? data.transcript
          : data.transcript != null
            ? JSON.stringify(data.transcript, null, 2)
            : "No transcript available.",
      ].join("\n");

      return { content: [{ type: "text", text }] };
    } catch (err) {
      return toolError(err instanceof Error ? err.message : "Unknown error fetching transcript");
    }
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
