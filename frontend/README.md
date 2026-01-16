# TX Web Platform - Frontend

Web-based GUI editor for TX mesh configurations.

## Development

```bash
npm install
npm run dev  # Start dev server on http://localhost:5173
```

During development, API requests to `/v1/*` are proxied to `http://localhost:3000` (tx-server).

## Production Build

```bash
npm run build       # Builds to dist/
./verify-build.sh   # Verify build output
```

Build output:
- `dist/index.html` - Entry point
- `dist/assets/` - JS/CSS bundles with content hashing
- Code splitting: React vendor bundle + Monaco vendor bundle

## Deployment

Frontend is served by tx-server. To deploy:

1. Build frontend: `cd frontend && npm run build`
2. Start tx-server: `cd .ai/worktrees/tx-server && npm run dev`
3. Access at http://localhost:3000

### How Static Serving Works

- tx-server serves `frontend/dist/` for all non-API routes
- API routes (`/v1/*`) are handled by the server
- SPA fallback: all other routes return `index.html` for client-side routing

## Architecture

- **Frontend**: React + TypeScript + Vite
- **Backend**: tx-server (Express-style, native http)
- **API**: REST endpoints under `/v1/`
- **Static Assets**: Served from `/` by tx-server

## Project Structure

```
frontend/
├── src/
│   ├── components/       # UI components
│   │   ├── MeshList.tsx     # Mesh card grid
│   │   ├── MeshEditor.tsx   # Main editor with mode toggle
│   │   ├── YAMLEditor.tsx   # Monaco YAML editor
│   │   └── GUIEditor.tsx    # Form-based editor
│   ├── api/              # API client
│   │   └── mesh.ts          # Mesh CRUD operations
│   ├── types/            # TypeScript types
│   │   └── mesh.ts          # MeshConfig types
│   └── App.tsx           # Root component with routing
├── dist/                 # Production build (generated)
├── vite.config.ts        # Build config with code splitting
└── verify-build.sh       # Build verification script
```

## Phase 1 Features

- List all meshes as cards
- View mesh config (GUI + YAML modes)
- Edit mesh config (GUI + YAML modes)
- Save changes with validation
- Toggle between GUI/YAML modes
- Inline validation with error display
- Responsive design (mobile/tablet)
- Dirty state tracking with unsaved changes indicator

## API Endpoints Used

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/meshes` | GET | List all meshes |
| `/v1/meshes/:name` | GET | Get mesh config |
| `/v1/meshes/:name` | PUT | Update mesh config |
| `/v1/meshes/:name/validate` | POST | Validate config |

## Future Phases

- **Phase 2**: Interactivity (send messages to meshes, view conversations)
- **Phase 3**: Advanced Editing (visual FSM editor, drag-drop routing)
- **Phase 4**: Multi-User (auth, concurrent editing)
- **Phase 5**: SaaS Deploy (`tx deploy <mesh>` -> cloud API)
