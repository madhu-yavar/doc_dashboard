# Doctor Dashboard Helm Chart

Medical document processing dashboard with AI chat - extracts structured data from hospital discharge summaries using Gemma LLM.

## Prerequisites

- Kubernetes cluster (AKS, EKS, GKE, or minikube for local testing)
- Helm 3.x installed
- Access to a container registry (ACR, ECR, GCR, or Docker Hub)
- Ingress controller installed (nginx, traefik, etc.)
- cert-manager installed (for automatic TLS certificates)

## Pre-deployment Checks

Before deploying, check your cluster configuration:

```bash
# Check available ingress classes
kubectl get ingressclass

# Check available storage classes
kubectl get storageclass

# Check existing deployments in target namespace
kubectl get all -n hospital

# List existing Helm releases
helm list -n hospital

# Check cert-manager is installed
kubectl get pods -n cert-manager
```

## Quick Start - Azure AKS Example

This example shows the actual deployment to an AKS cluster with Azure Container Registry.

### Step 1: Build and Push Docker Image

```bash
# Build the image
docker build -t doctor-dashboard:latest .

# Login to Azure Container Registry
az acr login --name <your-registry-name>

# Tag for your ACR
docker tag doctor-dashboard:latest <your-registry>.azurecr.io/doctor-dashboard:latest

# Push to ACR
docker push <your-registry>.azurecr.io/doctor-dashboard:latest
```

### Step 2: Create Namespace

```bash
kubectl create namespace hospital
```

### Step 3: Update values.yaml

Update `helm/doctor-dashboard/values.yaml` with your configuration:

```yaml
image:
  repository: <your-registry>.azurecr.io/doctor-dashboard
  tag: latest

ingress:
  className: nginx
  annotations:
    cert-manager.io/cluster-issuer: "letsencrypt-prod"
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
  hosts:
    - host: doctor-dashboard.your-domain.com
      paths:
        - path: /
          pathType: Prefix
  tls:
  - secretName: doctor-dashboard-dev-tls-cert
    hosts:
      - doctor-dashboard.your-domain.com

storage:
  className: default  # or "managed-csi-premium" for Azure premium SSD
  size: 5Gi

config:
  gemmaUrl: http://206.1.62.28:8000/v1/chat/completions
  gemmaModel: google/gemma-4-26B-A4B-it
```

### Step 4: Install the Chart

```bash
helm install doctor-dashboard ./helm/doctor-dashboard \
  --namespace hospital \
  --values helm/doctor-dashboard/values.yaml
```

### Step 5: Verify Deployment

```bash
# Wait for certificate to be issued (1-2 minutes)
kubectl get certificate -n hospital -w

# Check all resources
kubectl get all -n hospital

# Check pod logs
kubectl logs -n hospital deployment/doctor-dashboard -f

# Access the application
# https://doctor-dashboard.your-domain.com
```

## Installation Options

### Option 1: Using Default values.yaml

```bash
helm install doctor-dashboard ./helm/doctor-dashboard --namespace hospital
```

### Option 2: Override Specific Values

```bash
helm install doctor-dashboard ./helm/doctor-dashboard \
  --namespace hospital \
  --set image.repository=<your-registry>/doctor-dashboard \
  --set ingress.hosts[0].host=dashboard.example.com \
  --set ingress.className=nginx
```

### Option 3: Custom Values File

```bash
cat > production-values.yaml <<EOF
image:
  repository: <your-registry>/doctor-dashboard
  tag: v1.0.0

ingress:
  enabled: true
  className: nginx
  hosts:
    - host: doctor-dashboard.production.com
  tls:
  - secretName: doctor-dashboard-prod-tls
    hosts:
      - doctor-dashboard.production.com

resources:
  requests:
    cpu: 500m
    memory: 1Gi
  limits:
    cpu: 2000m
    memory: 2Gi

storage:
  size: 10Gi
EOF

helm install doctor-dashboard ./helm/doctor-dashboard \
  --namespace hospital \
  --values production-values.yaml
```

### Option 4: Set Gemini API Key

If using Gemini for external knowledge:

```bash
helm upgrade doctor-dashboard ./helm/doctor-dashboard \
  --namespace hospital \
  --set secrets.geminiApiKey=your-api-key-here

# Or create secret manually
kubectl create secret generic doctor-dashboard-gemini-key \
  --namespace hospital \
  --from-literal=gemini-api-key=your-api-key-here
```

## Configuration

See `values.yaml` for all configurable options. Key parameters:

| Parameter | Description | Default |
|-----------|-------------|---------|
| `image.repository` | Container image repository | `doctor-dashboard` |
| `image.tag` | Container image tag | `latest` |
| `replicaCount` | Number of replicas | `1` |
| `ingress.enabled` | Enable ingress | `true` |
| `ingress.className` | Ingress class name | `nginx` |
| `ingress.hosts[0].host` | Ingress hostname | `doctor-dashboard.hospital.local` |
| `storage.size` | PVC size | `5Gi` |
| `storage.className` | Storage class name | `""` (uses default) |
| `config.gemmaUrl` | Gemma API endpoint | `http://206.1.62.28:8000/v1/chat/completions` |
| `config.gemmaModel` | Gemma model name | `google/gemma-4-26B-A4B-it` |
| `secrets.geminiApiKey` | Gemini API key | `""` |

## Production Deployment Reference

This is the actual deployment configuration used in production:

### Cluster Information
- **Provider**: Azure Kubernetes Service (AKS)
- **Ingress Controller**: nginx
- **Certificate Manager**: cert-manager with Let's Encrypt
- **Storage**: Azure Disk (default storage class)
- **Registry**: Azure Container Registry (zinfradevv1.azurecr.io)

### Deployment Details
- **Namespace**: `hospital`
- **Image**: `zinfradevv1.azurecr.io/doctor-dashboard:latest`
- **URL**: `https://doctor-dashboard.zagent.dev.yavar.ai`
- **TLS**: Automatic via cert-manager (letsencrypt-prod)
- **Storage**: 5Gi Azure Disk PVC

### Architecture

```
Internet (HTTPS)
    ↓
[External IP: 48.194.108.112]
    ↓
[Nginx Ingress Controller]
    ↓
[TLS Termination - Let's Encrypt Certificate]
    ↓
[Ingress: doctor-dashboard.zagent.dev.yavar.ai]
    ↓
[Service: ClusterIP - Port 8001]
    ↓
[Pod: doctor-dashboard]
    │
    ├── [PVC: 5Gi Azure Disk]
    └── [External: Gemma API @ 206.1.62.28:8000]
```

## Upgrading

```bash
# Standard upgrade
helm upgrade doctor-dashboard ./helm/doctor-dashboard \
  --namespace hospital \
  --values helm/doctor-dashboard/values.yaml

# Upgrade with new image tag
helm upgrade doctor-dashboard ./helm/doctor-dashboard \
  --namespace hospital \
  --set image.tag=v1.0.0

# Upgrade with custom values
helm upgrade doctor-dashboard ./helm/doctor-dashboard \
  --namespace hospital \
  --values production-values.yaml
```

## Rollback

```bash
# List revisions
helm history doctor-dashboard -n hospital

# Rollback to previous version
helm rollback doctor-dashboard -n hospital

# Rollback to specific revision
helm rollback doctor-dashboard 1 -n hospital
```

## Uninstalling

```bash
# Uninstall the release
helm uninstall doctor-dashboard --namespace hospital

# Optional: Delete the namespace
kubectl delete namespace hospital

# Note: PVCs are not automatically deleted
kubectl delete pvc -n hospital doctor-dashboard-storage
```

## Troubleshooting

### Check Pod Status

```bash
kubectl get pods -n hospital -l app.kubernetes.io/name=doctor-dashboard

# Describe pod for detailed info
kubectl describe pod -n hospital <pod-name>

# View events
kubectl get events -n hospital --sort-by='.lastTimestamp'
```

### View Logs

```bash
# Follow logs
kubectl logs -n hospital deployment/doctor-dashboard -f

# Logs from previous container (if crashed)
kubectl logs -n hospital deployment/doctor-dashboard --previous

# Logs from specific container
kubectl logs -n hospital deployment/doctor-dashboard -c doctor-dashboard
```

### Check PVC Status

```bash
kubectl get pvc -n hospital

# Describe PVC
kubectl describe pvc -n hospital doctor-dashboard-storage
```

### Check Ingress Status

```bash
kubectl get ingress -n hospital

# Describe ingress
kubectl describe ingress -n hospital doctor-dashboard

# Check ingress controller logs
kubectl logs -n ingress-nginx deployment/ingress-nginx-controller
```

### Check Certificate Status

```bash
kubectl get certificate -n hospital

# Describe certificate
kubectl describe certificate -n hospital doctor-dashboard-dev-tls-cert

# Check cert-manager logs
kubectl logs -n cert-manager deployment/cert-manager
```

### Port Forward (for local testing)

```bash
kubectl port-forward -n hospital svc/doctor-dashboard 8001:8001

# Then access at http://localhost:8001
curl http://localhost:8001/api/health
```

### Common Issues

**Pod stuck in ContainerCreating**:
- Check PVC is bound: `kubectl get pvc -n hospital`
- Check storage class is available: `kubectl get storageclass`

**Certificate not provisioning**:
- Check cert-manager is running: `kubectl get pods -n cert-manager`
- Check cluster-issuer exists: `kubectl get clusterissuer`
- Describe certificate for errors: `kubectl describe certificate -n hospital`

**Ingress not accessible**:
- Check ingress controller has external IP: `kubectl get svc -n ingress-nginx`
- Verify DNS is configured for the hostname
- Check firewall rules allow access to the ingress IP

## Health Check

```bash
# From inside cluster
kubectl run -it --rm debug --image=curlimages/curl --restart=Never -- \
  curl http://doctor-dashboard.hospital.svc.cluster.local:8001/api/health

# From external (after DNS configured)
curl https://doctor-dashboard.your-domain.com/api/health
```

Expected response: `{"status":"ok"}`
