# Repository Guidelines

## Project Structure & Module Organization
`src/` contains the React frontend: page entry points in `src/pages/`, reusable UI in `src/components/ui/`, dashboard-specific views in `src/components/dashboard/`, and shared helpers in `src/lib/`, `src/hooks/`, and `src/data/`. The Express backend lives in `server/` with runtime storage under `server/storage/`. Agent orchestration code is split across `agents/`, `tools/`, `skills/`, and `config/`. Frontend unit tests live in `src/test/`; workflow and extraction checks are mostly CJS scripts under `tests/` and `scripts/`. Static assets are in `public/`.

## Build, Test, and Development Commands
Install dependencies with `npm ci`. Use `npm run dev` for the Vite frontend and `npm run server` for the Express API on port `8001`. Build production assets with `npm run build`, then verify the built app through the server. Run linting with `npm run lint`. Run frontend tests with `npm test` or `npm run test:watch`. Repository-specific validation scripts can be executed directly, for example `node tests/test_dashboard_flow.cjs` or `node scripts/chat_regression_20.cjs`.

## Coding Style & Naming Conventions
This project uses TypeScript, React 18, and ESLint (`eslint.config.js`). Follow the existing style: 2-space indentation, semicolons, double quotes, and functional React components. Use `PascalCase` for components (`PatientHeader.tsx`), `camelCase` for helpers and hooks (`processedDocuments.ts`, `use-mobile.tsx`), and keep utility modules under `src/lib/`. Prefer the `@/` alias for frontend imports. Do not edit generated output in `dist/`.

## Testing Guidelines
Vitest is configured with `jsdom` and Testing Library via `src/test/setup.ts`. Name frontend tests `*.test.ts` or `*.test.tsx` inside `src/` so `npm test` picks them up. Keep tests close to the feature they cover when practical. There is no enforced coverage threshold in the repo today, so add focused assertions for new behavior and run the relevant CJS regression script when changing extraction, chat, or dashboard flows.

## Commit & Pull Request Guidelines
Recent history mixes short commits (`update`) with conventional ones (`feat: ...`, `docs: ...`). Prefer Conventional Commit prefixes such as `feat:`, `fix:`, `docs:`, and keep subjects specific. PRs should include a clear summary, impacted areas, test commands run, and screenshots for visible UI changes. Link the related issue or task when one exists, and call out any environment or model-setting changes explicitly.

## Security & Configuration Tips
Keep secrets in environment variables, not tracked files. Review `README.md` for required runtime settings such as `GEMMA_URL`, `GEMINI_API_KEY`, and `PORT`. Treat `server/storage/` and `tests/key.txt` as sensitive local data and avoid committing generated artifacts unless they are intentional fixtures.
