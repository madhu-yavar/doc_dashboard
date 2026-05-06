# Doctor Dashboard

Doctor Dashboard is a React + Express application for uploading clinical PDFs, processing them with a Gemma-backed extraction pipeline, and reviewing the structured output in a browser UI.

In production, the Express server serves both:

- the JSON API under `/api/*`
- the built frontend on the same port

That means a single public address is enough for normal usage.

## Stack

- Frontend: React + Vite
- Backend: Express
- Document processing: `DocumentTypeRouter` plus local agent/skill pipeline in `agents/`, `skills/`, and `tools/`
- LLM backend: Gemma-compatible chat-completions endpoint
- Storage: local filesystem under `server/storage` plus analytics metrics in `server/storage/analytics.sqlite`

## Runtime Ports

- App server: `8001`
- Gemma endpoint: typically `8000`

Health check:

```bash
curl http://127.0.0.1:8001/api/health
```

## Environment Variables

The backend reads these variables at runtime:

```env
NODE_ENV=production
PORT=8001
GEMMA_URL=http://127.0.0.1:8000/v1/chat/completions
GEMMA_MODEL=google/gemma-4-31B-it
EXTRACTION_GEMMA_TIMEOUT_MS=240000
USE_GEMINI_FOR_EXTERNAL=true
GEMINI_MODEL=gemini-2.5-flash
GEMINI_API_KEY=
```

Notes:

- `GEMMA_URL` must point to a Gemma-compatible OpenAI-style chat-completions endpoint.
- `GEMMA_MODEL` currently defaults to `google/gemma-4-31B-it` in the live server.
- `EXTRACTION_GEMMA_TIMEOUT_MS` controls extraction-step timeout for the router-backed processing path.
- If Gemma runs on the same VM as this app but outside Docker, use `host.docker.internal` from inside the container.
- `USE_GEMINI_FOR_EXTERNAL` can be set to `false` if you do not want external web-answer fallback behavior.

## Runtime Architecture

The current production path is:

1. UI uploads PDFs to the Express server.
2. `server/index.cjs` hands processing to `agents/document_type_router.cjs`.
3. The router classifies the document and dispatches to a specialized extractor agent.
4. Processed documents are persisted in `server/storage/documents.json`.
5. Processing Insights are served from `server/storage/analytics.sqlite` through `/api/analytics/overview`.

`agents/extraction/react_extraction_agent.cjs` exists in the repo, but it is not the default extraction path for the main document-processing flow unless agentic extraction is explicitly enabled.

## Local Development

Install dependencies:

```bash
npm ci
```

Run the backend:

```bash
npm run server
```

Run the frontend dev server in a second terminal:

```bash
npm run dev
```

Build the frontend:

```bash
npm run build
```

Run tests:

```bash
npm test
```

## Production Behavior

After `npm run build`, the backend serves the built SPA from `dist/` and serves the API from the same Express process on port `8001`.

Browser access:

- UI: `http://<host>:8001/`
- API health: `http://<host>:8001/api/health`

## Docker Deployment

Build the image locally:

```bash
docker build -t doctor-dashboard:latest .
```

Run it:

```bash
docker run -d \
  --name doctor-dashboard \
  --restart unless-stopped \
  -p 8001:8001 \
  -e NODE_ENV=production \
  -e PORT=8001 \
  -e GEMMA_URL=http://host.docker.internal:8000/v1/chat/completions \
  -e GEMMA_MODEL=google/gemma-4-31B-it \
  -e EXTRACTION_GEMMA_TIMEOUT_MS=240000 \
  --add-host=host.docker.internal:host-gateway \
  -v "$(pwd)/server/storage:/app/server/storage" \
  doctor-dashboard:latest
```

Check container health:

```bash
docker logs doctor-dashboard --tail 100
curl http://127.0.0.1:8001/api/health
```

## Deploying On The GPU Host Where Gemma Already Runs

This is the intended same-host deployment path.

Assumptions:

- Gemma is already running on the host at `http://127.0.0.1:8000`
- Docker is installed on the host
- You want the app reachable from the host's external IP

Use the supplied compose file:

```bash
docker compose -f docker-compose.gpu.yml up -d --build
```

The GPU compose file already does the important networking:

- publishes `8001:8001`
- maps `host.docker.internal` to the host gateway
- points `GEMMA_URL` to `http://host.docker.internal:8000/v1/chat/completions`

Verify:

```bash
docker compose -f docker-compose.gpu.yml ps
curl http://127.0.0.1:8001/api/health
```

Important:

- This app does not need direct GPU access unless you later move Gemma into the same container.
- The app container only needs network access to Gemma.

## Exposing The App On An External IP

Docker does not create a public IP. The VM or server must already have one assigned by your cloud or network team.

Once the server has a public IP:

1. Publish port `8001` from the container.
2. Open inbound firewall access for `8001/tcp`, or place Nginx in front and expose `80/443`.
3. Access the app at `http://<public-ip>:8001/`.

Example `ufw` rule:

```bash
sudo ufw allow 8001/tcp
```

If you are using a cloud VM, also allow `8001` in the provider firewall or security group.

## Recommended Production Setup

For real deployments, prefer:

- Nginx on `80/443`
- reverse proxy to `http://127.0.0.1:8001`
- TLS via Certbot or your normal certificate workflow
- persistent storage mounted to `server/storage`

This keeps the app internal and exposes only Nginx.

## Storage

Uploaded files and generated state are stored in:

```text
server/storage/
```

Important files/directories include:

- `server/storage/uploads/`
- `server/storage/documents.json`
- `server/storage/analytics.sqlite`
- `server/storage/chat_sessions.json`
- `server/storage/chat_actions.json`
- `server/storage/chat_exports.json`
- `server/storage/search_cache.json`

Mount `server/storage` as a persistent volume in Docker.

## Useful Endpoints

- `GET /api/health`
- `GET /api/agent/status`
- `GET /api/analytics/overview`
- `GET /api/documents`
- `POST /api/documents/upload`
- `POST /api/documents/process`
- `GET /api/documents/process/progress`
- `GET /api/documents/:id/handwriting-progress`
- `POST /api/documents/:id/complete-handwriting`
- `GET /api/chat/history/:documentId`
- `POST /api/chat/query`
- `POST /api/chat/action/confirm`
- `POST /api/chat/export/:documentId`
- `GET /api/documents/:id/chart-note`
- `POST /api/documents/:id/chart-note/pdf`
- `POST /api/documents/:id/alert-preview`
- `POST /api/documents/:id/send-alerts`

## Troubleshooting

If the UI loads but actions fail:

- check `GEMMA_URL`
- check that Gemma is reachable from the app container
- check `docker logs doctor-dashboard`

If the app is reachable locally but not remotely:

- check the VM public IP
- check cloud firewall or security group rules
- check host firewall rules
- check that port `8001` is published and listening

If the container starts but processing fails:

- verify Gemma is healthy on port `8000`
- confirm the configured model name matches the served model
- inspect backend logs for request timeout or upstream connection errors
# Trigger build to push latest image
