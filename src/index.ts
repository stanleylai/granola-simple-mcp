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
const RETURN_ALL_MAX = 200;
const RETURN_ALL_PAGE_SIZE = 30;

function formatNote(n: Record<string, unknown>): string {
  const title = n.title ?? "Untitled";
  const id = n.id ?? "unknown";
  const createdAt = typeof n.created_at === "string" ? new Date(n.created_at).toLocaleDateString() : "unknown date";
  const owner = n.owner as Record<string, string> | undefined;
  const ownerStr = owner?.name ? `${owner.name} <${owner.email}>` : "unknown";
  return `- **${title}** (${createdAt})\n  ID: ${id} | Owner: ${ownerStr}`;
}

server.tool(
  "list_notes",
  [
    "List Granola meeting notes, optionally filtered by date range.",
    "Returns up to page_size notes per call (max 30). If has_more is true in the response metadata, call again with the provided cursor to get the next page.",
    "Always follow pagination to completion when the user asks for a comprehensive list.",
    "Set return_all: true with a date filter to fetch all matching notes in one call (up to 200).",
  ].join(" "),
  {
    created_after: z.string().optional().describe("ISO date/datetime — only return notes created after this (e.g. '2025-03-24')"),
    created_before: z.string().optional().describe("ISO date/datetime — only return notes created before this"),
    updated_after: z.string().optional().describe("ISO date/datetime — only return notes updated after this"),
    page_size: z.number().min(1).max(30).optional().describe("Results per page (1-30, default 10). Ignored when return_all is true."),
    cursor: z.string().optional().describe("Pagination cursor from a previous response"),
    return_all: z.boolean().optional().describe("Fetch all matching notes in one response (up to 200). Requires at least one date filter."),
  },
  async ({ created_after, created_before, updated_after, page_size, cursor, return_all }) => {
    try {
      const hasDateFilter = !!(created_after || created_before || updated_after);
      const shouldReturnAll = return_all === true && hasDateFilter;

      if (return_all === true && !hasDateFilter) {
        return toolError("return_all requires at least one date filter (created_after, created_before, or updated_after) to prevent fetching thousands of notes.");
      }

      if (shouldReturnAll) {
        // Internal pagination: fetch all pages up to RETURN_ALL_MAX
        const allNotes: Record<string, unknown>[] = [];
        let nextCursor: string | undefined;
        let truncated = false;

        do {
          const params: Record<string, string> = { page_size: String(RETURN_ALL_PAGE_SIZE) };
          if (created_after) params.created_after = created_after;
          if (created_before) params.created_before = created_before;
          if (updated_after) params.updated_after = updated_after;
          if (nextCursor) params.cursor = nextCursor;

          const data = await granolaFetch("/v1/notes", params) as Record<string, unknown>;
          const notes = Array.isArray(data.notes) ? data.notes : [];
          allNotes.push(...notes);

          if (allNotes.length >= RETURN_ALL_MAX) {
            allNotes.length = RETURN_ALL_MAX;
            truncated = true;
            break;
          }

          nextCursor = data.hasMore && typeof data.cursor === "string" ? data.cursor : undefined;
        } while (nextCursor);

        const lines = allNotes.map(formatNote);
        const meta = truncated
          ? `**Results:** ${allNotes.length} notes (truncated at ${RETURN_ALL_MAX} — more exist)`
          : `**Results:** ${allNotes.length} notes (all matching)`;

        const text = lines.length > 0
          ? [meta, "", ...lines].join("\n")
          : meta + "\n\nNo notes found for the given filters.";

        return { content: [{ type: "text", text }] };
      }

      // Standard single-page fetch
      const params: Record<string, string> = {};
      if (created_after) params.created_after = created_after;
      if (created_before) params.created_before = created_before;
      if (updated_after) params.updated_after = updated_after;
      if (page_size) params.page_size = String(page_size);
      if (cursor) params.cursor = cursor;

      const data = await granolaFetch("/v1/notes", params) as Record<string, unknown>;
      const notes = Array.isArray(data.notes) ? data.notes : [];
      const hasMore = !!data.hasMore;
      const nextPageCursor = typeof data.cursor === "string" ? data.cursor : null;

      const meta = hasMore && nextPageCursor
        ? `**Results:** ${notes.length} notes | **Has more:** yes | **Cursor:** ${nextPageCursor}`
        : `**Results:** ${notes.length} notes | **Has more:** no`;

      const lines = notes.map(formatNote);

      const text = lines.length > 0
        ? [meta, "", ...lines].join("\n")
        : meta + "\n\nNo notes found for the given filters.";

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
interface TranscriptSegment {
  text: string;
  start_time: string;
  end_time: string;
  speaker: { source: string };
}

server.tool(
  "get_transcript",
  [
    "Get the full transcript for a Granola meeting note.",
    "Each segment includes a speaker object with:",
    "- source: 'microphone' = the local user who recorded the meeting (you)",
    "- source: 'speaker' = remote participant(s) heard through audio output",
    "- is_self: true if the speaker is you (microphone), false otherwise",
    "- speaker_label: 'You' or 'Other' for easy display",
  ].join("\n"),
  {
    note_id: z.string().describe("The note ID (e.g. 'not_...')"),
  },
  async ({ note_id }) => {
    try {
      const id = validateNoteId(note_id);
      const data = await granolaFetch(`/v1/notes/${id}`, { include: "transcript" }) as Record<string, unknown>;

      if (!Array.isArray(data.transcript)) {
        const fallback = typeof data.transcript === "string"
          ? data.transcript
          : "No transcript available.";
        return { content: [{ type: "text", text: fallback }] };
      }

      const segments = data.transcript as TranscriptSegment[];

      const selfSegments: string[] = [];
      const otherSegments: string[] = [];
      const formattedLines: string[] = [];

      for (const seg of segments) {
        const isSelf = seg.speaker?.source === "microphone";
        const label = isSelf ? "You" : "Other";
        const time = seg.start_time
          ? new Date(seg.start_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
          : "";

        formattedLines.push(`**${label}** (${time}): ${seg.text}`);

        if (isSelf) {
          selfSegments.push(seg.text);
        } else {
          otherSegments.push(seg.text);
        }
      }

      const text = [
        `# Transcript: ${data.title ?? "Untitled"}`,
        `**Date:** ${data.created_at ?? "unknown"}`,
        `**Segments:** ${segments.length} (You: ${selfSegments.length}, Other: ${otherSegments.length})`,
        "",
        "## Full transcript",
        "",
        ...formattedLines,
        "",
        "## What you said",
        "",
        selfSegments.length > 0 ? selfSegments.join("\n\n") : "_No segments from you (microphone)._",
        "",
        "## What others said",
        "",
        otherSegments.length > 0 ? otherSegments.join("\n\n") : "_No segments from others._",
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
