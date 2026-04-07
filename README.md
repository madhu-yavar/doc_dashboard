# Doctor Dashboard

Doctor Dashboard is a React + Express application for uploading discharge-summary PDFs, processing them with a Gemma-backed extraction pipeline, and reviewing the structured output in a browser UI.

In production, the Express server serves both:

- the JSON API under `/api/*`
- the built frontend on the same port

That means a single public address is enough for normal usage.

## Stack

- Frontend: React + Vite
- Backend: Express
- Document processing: local agent/skill pipeline in `agents/`, `skills/`, and `tools/`
- LLM backend: Gemma-compatible chat-completions endpoint
- Storage: local filesystem under `server/storage`

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
GEMMA_MODEL=google/gemma-4-26B-A4B-it
USE_GEMINI_FOR_EXTERNAL=true
GEMINI_MODEL=gemini-2.5-flash
GEMINI_API_KEY=
```

Notes:

- `GEMMA_URL` must point to a Gemma-compatible OpenAI-style chat-completions endpoint.
- If Gemma runs on the same VM as this app but outside Docker, use `host.docker.internal` from inside the container.
- `USE_GEMINI_FOR_EXTERNAL` can be set to `false` if you do not want external web-answer fallback behavior.

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
  -e GEMMA_MODEL=google/gemma-4-26B-A4B-it \
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

## Kubernetes / Helm Deployment

This application includes a Helm chart for deployment on Kubernetes clusters.

### Prerequisites

- Kubernetes cluster (AKS, EKS, GKE, etc.)
- Helm 3.x installed
- Container registry access
- Ingress controller (nginx-traefik, etc.)
- cert-manager (for automatic TLS certificates)

### Quick Start

1. **Build and push the Docker image** to your registry:

```bash
# Build
docker build -t doctor-dashboard:latest .

# Tag for your registry
docker tag doctor-dashboard:latest <your-registry>/doctor-dashboard:latest

# Push
docker push <your-registry>/doctor-dashboard:latest
```

2. **Create the namespace**:

```bash
kubectl create namespace hospital
```

3. **Install the Helm chart**:

```bash
# Basic installation
helm install doctor-dashboard ./helm/doctor-dashboard \
  --namespace hospital \
  --set image.repository=<your-registry>/doctor-dashboard

# With custom hostname
helm install doctor-dashboard ./helm/doctor-dashboard \
  --namespace hospital \
  --set image.repository=<your-registry>/doctor-dashboard \
  --set ingress.hosts[0].host=doctor-dashboard.your-domain.com
```

4. **Access the application**:

After cert-manager provisions the TLS certificate (typically 1-2 minutes), access the application at:
```
https://doctor-dashboard.your-domain.com
```

### Configuration

Key Helm values (see `helm/doctor-dashboard/values.yaml` for full options):

| Parameter | Description | Default |
|-----------|-------------|---------|
| `image.repository` | Container image | `doctor-dashboard` |
| `image.tag` | Image tag | `latest` |
| `replicaCount` | Number of replicas | `1` |
| `ingress.enabled` | Enable ingress | `true` |
| `ingress.className` | Ingress class | `nginx` |
| `ingress.hosts[0].host` | Application hostname | `doctor-dashboard.hospital.local` |
| `ingress.annotations` | Ingress annotations | cert-manager enabled |
| `storage.size` | PVC size | `5Gi` |
| `config.gemmaUrl` | Gemma API endpoint | `http://206.1.62.28:8000/v1/chat/completions` |
| `config.gemmaModel` | Gemma model name | `google/gemma-4-26B-A4B-it` |
| `secrets.geminiApiKey` | Gemini API key | (empty) |

### Example Production Deployment (AKS)

```bash
# Login to Azure Container Registry
az acr login --name <your-registry>

# Build and push
docker build -t doctor-dashboard:latest .
docker tag doctor-dashboard:latest <your-registry>.azurecr.io/doctor-dashboard:latest
docker push <your-registry>.azurecr.io/doctor-dashboard:latest

# Deploy with production values
helm install doctor-dashboard ./helm/doctor-dashboard \
  --namespace hospital \
  --create-namespace \
  --set image.repository=<your-registry>.azurecr.io/doctor-dashboard \
  --set ingress.hosts[0].host=doctor-dashboard.production.com \
  --set ingress.annotations."cert-manager\.io/cluster-issuer"=letsencrypt-prod \
  --set storage.storageClass=default \
  --set storage.size=10Gi \
  --set resources.requests.cpu=500m \
  --set resources.requests.memory=1Gi \
  --set resources.limits.cpu=2000m \
  --set resources.limits.memory=2Gi
```

### Upgrade Deployment

```bash
helm upgrade doctor-dashboard ./helm/doctor-dashboard \
  --namespace hospital \
  --values helm/doctor-dashboard/values.yaml \
  --set image.tag=v1.0.0
```

### Uninstall

```bash
helm uninstall doctor-dashboard --namespace hospital
```

### Verify Deployment

```bash
# Check all resources
kubectl get all -n hospital

# Check pod logs
kubectl logs -n hospital deployment/doctor-dashboard -f

# Check ingress
kubectl get ingress -n hospital

# Check certificate status
kubectl get certificate -n hospital

# Test health endpoint
kubectl port-forward -n hospital svc/doctor-dashboard 8001:8001
curl http://localhost:8001/api/health
```

### Architecture in Kubernetes

```
External Traffic (HTTPS)
    ↓
[Ingress Controller - nginx]
    ↓
[TLS Termination - cert-manager]
    ↓
[Ingress Resource - doctor-dashboard.your-domain.com]
    ↓
[Service - ClusterIP:8001]
    ↓
[Pod - doctor-dashboard]
    ↓
[PVC - /app/server/storage]
    ↓
[External - Gemma Service]
```

### Storage and Persistence

The application requires persistent storage for:
- Uploaded PDF documents
- Extracted data (documents.json)
- Chat sessions and history
- Search cache

The Helm chart creates a PVC with configurable size (default 5Gi). Ensure your cluster has a default storage class or specify one in values.

## Storage

Uploaded files and generated state are stored in:

```text
server/storage/
```

Important files/directories include:

- `server/storage/uploads/`
- `server/storage/documents.json`
- `server/storage/chat_sessions.json`
- `server/storage/chat_actions.json`
- `server/storage/chat_exports.json`
- `server/storage/search_cache.json`

Mount `server/storage` as a persistent volume in Docker.

## Useful Endpoints

- `GET /api/health`
- `GET /api/agent/status`
- `GET /api/documents`
- `POST /api/documents/upload`
- `POST /api/documents/process`
- `GET /api/documents/process/progress`
- `GET /api/chat/history/:documentId`
- `POST /api/chat/query`
- `POST /api/chat/action/confirm`
- `POST /api/chat/export/:documentId`
- `GET /api/documents/:id/chart-note`
- `POST /api/documents/:id/chart-note/pdf`

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
