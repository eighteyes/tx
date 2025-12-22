# Meet Mesh - Google Calendar Integration

Meeting coordination agent using Google Calendar MCP. Schedule meetings, check availability, and manage calendar events through natural language.

## What It Does

- Parse meeting requests from natural language
- Check calendar availability
- Find suitable meeting times
- Create calendar events with attendees
- Handle scheduling conflicts
- Propose alternative times

## Security

This mesh uses `toolRestriction: mcp-only` - it has NO access to file system or bash commands. Only Google Calendar MCP tools are available.

## Prerequisites

1. Google Cloud Project with Calendar API enabled
2. OAuth 2.0 credentials (Desktop App type)
3. Node.js and npm installed

## Setup Steps

### 1. Create Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create new project or select existing
3. Enable Google Calendar API:
   - Navigate to "APIs & Services" > "Library"
   - Search "Google Calendar API"
   - Click "Enable"

### 2. Create OAuth Credentials

1. Go to "APIs & Services" > "Credentials"
2. Click "Create Credentials" > "OAuth client ID"
3. Select "Desktop app" as application type
4. Name it (e.g., "TX Meet Mesh")
5. Click "Create"
6. Download the JSON credentials file

### 3. Configure Environment

1. Copy `.mcp.env.example` to `.mcp.env` in project root:
   ```bash
   cp .mcp.env.example .mcp.env
   ```

2. Set `GOOGLE_OAUTH_CREDENTIALS` to the path of your downloaded JSON file:
   ```bash
   # .mcp.env
   GOOGLE_OAUTH_CREDENTIALS=/path/to/your/credentials.json
   ```

   **OR** paste the entire JSON content:
   ```bash
   GOOGLE_OAUTH_CREDENTIALS='{"installed":{"client_id":"...","client_secret":"..."}}'
   ```

### 4. First-Time Authorization

On first use, `@cocal/google-calendar-mcp` will:
1. Open browser for Google account authorization
2. Request calendar access permissions
3. Store refresh token for future use

**Token storage**: By default in `~/.config/@cocal/google-calendar-mcp/token.json`

Override location with:
```bash
# .mcp.env
GOOGLE_CALENDAR_MCP_TOKEN_PATH=/custom/path/token.json
```

## Usage

Send task messages to `meet/scheduler`:

```markdown
---
to: meet/scheduler
from: core/core
type: task
msg-id: task-123
headline: Schedule team standup
timestamp: 2025-12-19T10:00:00Z
---

Schedule 30-min meeting with alice@example.com tomorrow at 2pm to discuss project roadmap.
```

Or use natural language via core agent (automatic intent routing):
- "schedule a meeting with bob@example.com next Tuesday at 3pm"
- "book 1 hour with the team next Monday morning"
- "arrange a call with jane@example.com to discuss Q4 planning"

## Available Tools

The scheduler agent has access to:

- `list-calendars` - List all available calendars
- `list-events` - List events with date filtering
- `get-event` - Get details of specific event by ID
- `search-events` - Search events by text query
- `create-event` - Create new calendar events
- `update-event` - Update existing events
- `delete-event` - Delete events
- `respond-to-event` - Manage invitation responses
- `get-freebusy` - Check availability across calendars
- `get-current-time` - Get current date/time in calendar's timezone

## Troubleshooting

### "GOOGLE_OAUTH_CREDENTIALS not found"

Check `.mcp.env` file exists in project root with correct path:
```bash
cat .mcp.env | grep GOOGLE_OAUTH_CREDENTIALS
```

### "Invalid OAuth credentials"

Verify JSON file format from Google Cloud Console:
- Should have `installed` or `web` key
- Must include `client_id` and `client_secret`

### "Permission denied" or "Access blocked"

1. Check OAuth consent screen is configured
2. Add test users if app is in testing mode
3. Verify Calendar API is enabled

### "Token expired" errors

Delete stored token and re-authorize:
```bash
rm ~/.config/@cocal/google-calendar-mcp/token.json
```

Next request will trigger browser auth flow.

### Agent can't read/write files

Expected behavior - `toolRestriction: mcp-only` blocks all SDK tools. Agent can ONLY use Google Calendar MCP tools.

## Testing

Send a simple test request:

```bash
tx start  # Start TX system

# In core session, tell the agent:
# "schedule a 15-minute test meeting for tomorrow at 2pm with myself"
```

Check `tx logs` for MCP tool calls and responses.

## References

- [@cocal/google-calendar-mcp](https://github.com/cocal/google-calendar-mcp) - MCP server implementation
- [Google Calendar API](https://developers.google.com/calendar/api) - API documentation
- [OAuth 2.0 Setup](https://developers.google.com/identity/protocols/oauth2) - Google auth guide
