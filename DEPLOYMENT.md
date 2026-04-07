# Deployment Record - Doctor Dashboard

This document records the actual deployment of Doctor Dashboard to the Kubernetes cluster.

## Deployment Information

| Field | Value |
|-------|-------|
| **Date** | April 7, 2026 |
| **Environment** | Production (AKS) |
| **Namespace** | hospital |
| **Helm Release** | doctor-dashboard (v1.0.0) |
| **Application URL** | https://doctor-dashboard.zagent.dev.yavar.ai |

## Cluster Details

| Field | Value |
|-------|-------|
| **Provider** | Azure Kubernetes Service (AKS) |
| **Ingress Controller** | nginx (ingress-nginx) |
| **External IP** | 48.194.108.112 |
| **Certificate Issuer** | Let's Encrypt (letsencrypt-prod) |
| **Storage Class** | default (Azure Disk) |
| **Container Registry** | zinfradevv1.azurecr.io |

## Deployment Steps

### 1. Pre-deployment Checks

```bash
# Check ingress classes
kubectl get ingressclass
# Found: nginx, livekit-nginx

# Check storage classes
kubectl get storageclass
# Found: default (Azure Disk CSI)

# Check existing deployments
kubectl get all -n hospital
# Namespace did not exist
```

### 2. Created Namespace

```bash
kubectl create namespace hospital
```

### 3. Built Docker Image

```bash
docker build -t doctor-dashboard:latest .
```

Build output:
- Multi-stage build with Node.js 20 Alpine
- Builder stage: npm ci + vite build
- Production stage: runtime dependencies only
- Image size: ~1.2GB
- Digest: sha256:e68bc5c7f5f9d19899ecb2eb2e2ee57d8d0427ead062a0c8c11306864fd7006b

### 4. Pushed to Azure Container Registry

```bash
az acr login --name zinfradevV1
docker tag doctor-dashboard:latest zinfradevv1.azurecr.io/doctor-dashboard:latest
docker push zinfradevv1.azurecr.io/doctor-dashboard:latest
```

### 5. Created Helm Chart

Created `helm/doctor-dashboard/` with:
- Chart.yaml
- values.yaml
- templates/ (deployment, service, ingress, pvc, configmap, secret, serviceaccount, _helpers.tpl, NOTES.txt)

### 6. Configured values.yaml

```yaml
image:
  repository: zinfradevv1.azurecr.io/doctor-dashboard

ingress:
  className: nginx
  annotations:
    cert-manager.io/cluster-issuer: "letsencrypt-prod"
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
  hosts:
    - host: doctor-dashboard.zagent.dev.yavar.ai
  tls:
  - secretName: doctor-dashboard-dev-tls-cert
    hosts:
      - doctor-dashboard.zagent.dev.yavar.ai

config:
  gemmaUrl: http://206.1.62.28:8000/v1/chat/completions
  gemmaModel: google/gemma-4-26B-A4B-it
```

### 7. Deployed with Helm

```bash
helm install doctor-dashboard ./helm/doctor-dashboard --namespace hospital
```

Initial deployment: Revision 1
Later upgraded: Revision 2 (with TLS enabled)

### 8. Verified Certificate Provisioning

```bash
kubectl get certificate -n hospital
# NAME                            READY   SECRET
# doctor-dashboard-dev-tls-cert   True    doctor-dashboard-dev-tls-cert
```

## Deployed Resources

### Namespace
- **Name**: hospital
- **Status**: Active

### Deployment
```yaml
Name: doctor-dashboard
Namespace: hospital
Replicas: 1/1
Image: zinfradevv1.azurecr.io/doctor-dashboard:latest
Ports: 8001/TCP
```

### Pod
```yaml
Name: doctor-dashboard-6dbf8c4dcd-bnsdc
Status: Running
Ready: 1/1
Restarts: 0
Age: 10m
```

### Service
```yaml
Name: doctor-dashboard
Type: ClusterIP
ClusterIP: 10.0.123.8
Port: 8001/TCP
Endpoints: 10.244.14.109:8001
```

### Persistent Volume Claim
```yaml
Name: doctor-dashboard-storage
Status: Bound
Capacity: 5Gi
Access Mode: ReadWriteOnce
Storage Class: default (Azure Disk)
Volume: pvc-cc375ea2-9152-438a-90d4-60449ca35c86
```

### Ingress
```yaml
Name: doctor-dashboard
Class: nginx
Host: doctor-dashboard.zagent.dev.yavar.ai
Address: 48.194.108.112
Ports: 80, 443
TLS: doctor-dashboard-dev-tls-cert (Let's Encrypt)
```

### Certificate
```yaml
Name: doctor-dashboard-dev-tls-cert
Status: Ready
Issuer: letsencrypt-prod
Secret: doctor-dashboard-dev-tls-cert
Domains:
  - doctor-dashboard.zagent.dev.yavar.ai
```

## Health Check

```bash
# Health endpoint
curl https://doctor-dashboard.zagent.dev.yavar.ai/api/health
# Expected: {"status":"ok"}
```

## Useful Commands

### Check Status
```bash
kubectl get all -n hospital
kubectl get ingress -n hospital
kubectl get certificate -n hospital
kubectl get pvc -n hospital
```

### View Logs
```bash
kubectl logs -n hospital deployment/doctor-dashboard -f
```

### Helm Operations
```bash
# Status
helm status doctor-dashboard -n hospital

# History
helm history doctor-dashboard -n hospital

# Upgrade
helm upgrade doctor-dashboard ./helm/doctor-dashboard -n hospital

# Rollback
helm rollback doctor-dashboard -n hospital

# Uninstall
helm uninstall doctor-dashboard -n hospital
```

## DNS Configuration

The application is accessible via:
- **URL**: https://doctor-dashboard.zagent.dev.yavar.ai
- **DNS**: Managed through zagent.dev.yavar.ai domain
- **TLS Certificate**: Automatically provisioned and renewed by cert-manager

## Security Considerations

1. **Non-root user**: Container runs as UID 1001 (nodejs)
2. **TLS enforced**: All traffic uses HTTPS (ssl-redirect annotation)
3. **Network policies**: Consider adding to restrict pod-to-pod communication
4. **Secrets management**: Gemini API key stored as Kubernetes Secret

## Monitoring Recommendations

1. **Pod metrics**: CPU, memory, restart count
2. **Application metrics**: Request rate, error rate, latency
3. **Storage metrics**: PVC usage, available space
4. **Certificate monitoring**: Expiration date, renewal status

## Backup Considerations

The PVC `doctor-dashboard-storage` contains:
- Uploaded PDF documents
- Extracted document data
- Chat sessions and history
- Search cache

**Backup Strategy**: Regular snapshots of the Azure Disk backing the PVC.

## Disaster Recovery

1. **Recovery from image failure**: Redeploy with new image tag
2. **Recovery from PVC failure**: Restore from Azure Disk snapshots
3. **Recovery from cluster failure**: Helm install with backed-up PVC
4. **Recovery from namespace deletion**: Full reinstall from scratch + PVC restore

## Change History

| Date | Change | Author |
|------|--------|--------|
| 2026-04-07 | Initial deployment with Helm chart | Claude Code |

## Notes

- Gemma service runs externally at http://206.1.62.28:8000
- No HPA configured (single replica)
- No PodDisruptionBudget configured
- Consider adding resource quotas to the hospital namespace
- Consider adding network policies to restrict egress traffic
