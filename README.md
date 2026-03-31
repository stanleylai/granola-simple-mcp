# granola-simple-mcp

A connector that gives AI tools like Claude access to your [Granola](https://granola.ai/) meeting notes — so you can ask things like _"summarise my meetings from last week"_ or _"what did we decide in Tuesday's standup?"_

Works with Claude Desktop, Claude Code, Cursor, and any other [MCP](https://modelcontextprotocol.io/)-compatible AI tool.

---

## Quick start

Requires Node.js 18+ and a Granola API key (Settings → API in the Granola desktop app).

**Claude Desktop** — add to `~/Library/Application Support/Claude/claude_desktop_config.json` (Mac) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "granola": {
      "command": "npx",
      "args": ["-y", "granola-simple-mcp"],
      "env": {
        "GRANOLA_API_KEY": "grn_your_key_here"
      }
    }
  }
}
```

Restart Claude Desktop. Done.

**Claude Code:**

```bash
claude mcp add granola -e GRANOLA_API_KEY=grn_your_key_here -- npx -y granola-simple-mcp
```

**Cursor** — same JSON block as Claude Desktop, added to your `mcp.json` via Settings → Cursor Settings → MCP.

---

## Detailed setup

You'll need two things:

1. **Node.js** installed on your computer (explained in Step 1)
2. **A Granola API key** (requires a Granola Business or Enterprise plan)

---

## Step 1: Install Node.js

**What is Node.js?** This connector is a small program written in JavaScript. Node.js is the engine that runs JavaScript programs outside of a browser — think of it like a required app that needs to be installed before other apps can work.

**Check if you already have it.** Open a terminal:

- **Mac:** Press `Cmd + Space`, type "Terminal", press Enter
- **Windows:** Press the Windows key, type "cmd", press Enter

Then run:

```
node --version
```

If you see a version number like `v18.0.0` or higher, you already have it — skip to Step 2.

**If you don't have it yet:**

- **Mac or Windows:** Download the installer from [nodejs.org](https://nodejs.org/) — click the big **"LTS"** button (the stable, recommended version). Run the installer and follow the prompts. When it's done, close and reopen your terminal, then run `node --version` to confirm.

---

## Step 2: Get your Granola API key

1. Open the **Granola desktop app**
2. Click **Settings** (gear icon, usually bottom-left)
3. Go to **API**
4. Click **Create API key**, give it a name (e.g. "Claude"), and copy the key — it will look like `grn_abc123...`

Keep this key handy — you'll paste it into a config file in the next step.

> **Note:** API keys require a Granola Business or Enterprise plan.

---

## Step 3: Connect to your AI tool

### Claude Desktop

#### Find and open the config file

Claude Desktop stores its settings in a file called `claude_desktop_config.json`.

**On Mac:**
1. Open Claude Desktop, click **Claude** in the top menu bar → **Settings**
2. Click the **Developer** tab → **Edit Config**

Or open the file directly: in Finder, press `Cmd + Shift + G` and paste:
```
~/Library/Application Support/Claude/claude_desktop_config.json
```

**On Windows:**
1. Open Claude Desktop, click the **≡** menu → **Settings** → **Developer** → **Edit Config**

Or open it directly: in File Explorer, click the address bar and paste:
```
%APPDATA%\Claude\claude_desktop_config.json
```

#### Edit the file

The file uses JSON — a structured text format that uses curly braces `{}`, colons `:`, and quotes `""` to organise settings.

**If the file is empty**, paste in exactly this, replacing `grn_your_key_here` with your actual API key:

```json
{
  "mcpServers": {
    "granola": {
      "command": "npx",
      "args": ["-y", "granola-simple-mcp"],
      "env": {
        "GRANOLA_API_KEY": "grn_your_key_here"
      }
    }
  }
}
```

**If the file already has content** (you have other tools connected), add the granola block inside the existing `"mcpServers"` section. Make sure there's a comma after the previous entry:

```json
{
  "mcpServers": {
    "some-other-tool": {
      "command": "...",
      "args": ["..."]
    },
    "granola": {
      "command": "npx",
      "args": ["-y", "granola-simple-mcp"],
      "env": {
        "GRANOLA_API_KEY": "grn_your_key_here"
      }
    }
  }
}
```

> **What do these lines mean?**
> - `"command": "npx"` — use npx (a tool bundled with Node.js) to run the connector
> - `"args": ["-y", "granola-simple-mcp"]` — the name of the connector to download and run
> - `"GRANOLA_API_KEY": "grn_your_key_here"` — your Granola API key, passed securely to the connector

#### Save and restart

1. Save the file (`Cmd + S` on Mac, `Ctrl + S` on Windows)
2. Fully quit and reopen Claude Desktop
3. Start a new conversation — you should see a **hammer 🔨 icon** near the chat input. Click it to confirm "granola" tools appear.

---

### Claude Code

Run this command in your terminal, replacing `grn_your_key_here` with your actual API key:

```bash
claude mcp add granola -e GRANOLA_API_KEY=grn_your_key_here -- npx -y granola-simple-mcp
```

That's it. Granola tools will be available the next time you start Claude Code. Run `/mcp` inside a session to confirm the connection.

---

### Cursor

1. Open Cursor → **Settings** → **Cursor Settings** → **MCP**
2. Click **+ Add new global MCP server** — this opens a file called `mcp.json`
3. Add the following, replacing `grn_your_key_here` with your actual API key:

```json
{
  "mcpServers": {
    "granola": {
      "command": "npx",
      "args": ["-y", "granola-simple-mcp"],
      "env": {
        "GRANOLA_API_KEY": "grn_your_key_here"
      }
    }
  }
}
```

4. Save the file and restart Cursor.

---

## Step 4: Verify it's working

Try asking your AI tool one of these:

- _"List my Granola meetings from the last week"_
- _"What was discussed in my most recent meeting?"_
- _"Show me the transcript from yesterday's standup"_

If you see your meeting data, you're all set.

---

## What you can ask

| Ask your AI... | What it does |
|---|---|
| "List my meetings from [date range]" | Browses your notes by date |
| "Get the summary for [meeting title]" | Returns the AI-generated summary |
| "Show me the transcript for [meeting]" | Returns the full word-for-word transcript |

---

## Troubleshooting

**"No notes found"**
The Granola API only returns meetings that have been processed with an AI summary. Very recent meetings or ones that weren't recorded may not appear yet.

**"Unauthorized — check your API key"**
Your API key is incorrect or missing. Check that it starts with `grn_` and has no extra spaces in the config file.

**"command not found: npx"**
Node.js isn't installed or didn't install correctly. Repeat Step 1 and make sure you reopen your terminal after installing.

**Tools don't appear in Claude Desktop**
- Make sure you saved the config file before restarting
- Check for JSON errors: every `{` needs a matching `}`, and every entry except the last needs a comma after it
- On Mac, you can validate your JSON by running this in Terminal:
  ```
  cat ~/Library/Application\ Support/Claude/claude_desktop_config.json | python3 -m json.tool
  ```
  If there's a mistake, it will tell you which line.

**The connector was working but stopped**
Restart your AI tool. If that doesn't help, your API key may have been revoked — generate a new one in Granola under Settings > API.

---

## API key types

- **Personal API key** — accesses your own notes and anything shared with you
- **Enterprise API key** — workspace admin only; accesses all notes in your organisation's Team space

Both work with this connector. See [Granola's API docs](https://docs.granola.ai/introduction) for details.

---

## For developers

```bash
git clone https://github.com/stanleylai/granola-simple-mcp.git
cd granola-simple-mcp
npm install
GRANOLA_API_KEY=grn_your_key_here npm start
```

---

## Disclaimer

This project was built with [Claude Code](https://claude.ai/code). It's likely fine, but as with any code you didn't write yourself — especially code that handles API keys and meeting data — you should read through [`src/index.ts`](src/index.ts) before using it if you have any concerns.

---

## License

MIT
