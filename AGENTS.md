# Motion Studio - AGENTS.md

## Build/Lint/Test Commands

### Development
- `wails dev` - Run live development mode with hot reload
- `cd frontend && npm run dev` - Run Next.js dev server directly

### Build
- `wails build` - Build production redistributable
- `cd frontend && npm run build` - Build frontend only
- `cd frontend && npm install` - Install frontend dependencies

### Linting & Type Checking
- `cd frontend && npm run lint` - Run ESLint
- TypeScript strict mode enabled; no explicit type-check command

### Running Tests
- **No test framework configured** - This project does not currently have unit or integration tests

## Code Style Guidelines

### General
- **Go**: Follow standard Go conventions (gofmt, camelCase for exports, lowercase for internals)
- **TypeScript/React**: Follow Next.js 16 with React 19 conventions
- **Strict mode**: Enabled in TypeScript (`"strict": true`)

### TypeScript/React

#### Imports
- Use default imports for React: `import React from "react"` (though not required with React 19)
- Named imports for other modules: `import { createContext, useContext } from "react"`
- Path aliases: `@/*` maps to `frontend/*`

#### Components
- Functional components only
- Use `ReactNode` for children prop
- Context providers use `Provider` suffix (e.g., `StudioProvider`)
- Custom hooks use `use` prefix (e.g., `useStudio`)

#### Types
- Use `interface` for object shapes
- Strict typing; prefer explicit types over `any`
- Context types use `Type` suffix (e.g., `StudioContextType`)

#### Naming Conventions
- Components: PascalCase (`StudioProvider`, `TimelineClip`)
- Hooks: `use` + PascalCase (`useWails`, `useGaplessPlayback`)
- Variables/Functions: camelCase
- Constants: UPPER_SNAKE_CASE
- Files: match component name (`StudioProvider.tsx`, `useWails.ts`)

#### Error Handling
- Use `useState` for error states in components
- For context hooks, throw descriptive error if used outside provider:
  ```typescript
  if (!context) {
    throw new Error("useStudio must be used within a StudioProvider");
  }
  ```

#### Formatting
- No explicit Prettier config; rely on ESLint and editor defaults
- Double quotes for strings
- 2-space indentation (inferred from JSX)

### Go

#### Conventions
- Package name: `main`
- Import grouping: standard library, then third-party
- Error handling: explicit checks with `if err != nil`
- Logging: `fmt.Printf()` for debug, `println()` for simple output

#### Structs
- JSON tags for serialization: `` `json:"fieldName"` ``
- Exported fields use PascalCase
- Unexported fields use camelCase

#### Naming
- Exported: PascalCase (`NewApp`, `GetProjects`, `CreateShot`)
- Unexported: camelCase (`newApp`, `getProjects`, `createShot`)

#### Error Messages
- Use `fmt.Errorf()` for wrapped errors
- Include context in error messages: `"failed to connect to ComfyUI: %v"`

### Project Structure
- Go backend: Root (`main.go`, `app.go`)
- Frontend: `frontend/` directory
  - App: `app/` (Next.js pages)
  - Components: `components/` (reusable UI)
  - Hooks: `hooks/` (custom React hooks)
  - Lib: `lib/` (utility modules)

### Wails Integration
- Go methods automatically exposed to frontend via `wailsjs/go/main/App`
- Use `runtime.EventsEmit()` for frontend events
- WebSocket for real-time progress updates (ComfyUI integration)

### Asset Management
- User documents: `Documents/MotionStudio/` (project data)
- Project assets: `Documents/MotionStudio/<ProjectID>/assets/`
- Workflows: `Documents/MotionStudio/workflows/`

### Video/Audio Processing
- FFmpeg for all media operations
- Video output: H.264 with yuv420p for web compatibility
- Audio: PCM_s16le WAV for AI compatibility, AAC for exports

### Security
- File paths: Sanitize all user-provided paths
- Project isolation: All assets stored within project directories
- Input validation: Check file extensions and MIME types