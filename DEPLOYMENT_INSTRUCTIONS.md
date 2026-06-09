# Deployment Instructions - 504 Timeout Fix

## Issue Fixed
**Problem**: 504 Gateway Timeout during Gemma AI reconciliation in hybrid STT mode (both file upload and live audio)

**Root Cause**: Hybrid reconciler timeout was too short (60s) for LLM processing, causing nginx to timeout before reconciliation completed.

## Changes Made

### 1. Code Changes (Require New Docker Image Build)
- **File**: `agents/stt_router_agent.cjs`
  - Increased hybrid reconciler timeout: 60s → 180s (3 minutes)
- **File**: `agents/live_conversation_stt_agent.cjs` 
  - Increased hybrid reconciler timeout: 60s → 180s (3 minutes)

### 2. Configuration Changes (Helm Values Update)
- **File**: `helm/doctor-dashboard/values.yaml`
  - Added STT backend configuration variables
  - Added hybrid reconciler timeout: 240s (4 minutes)

## Deployment Team Instructions

### Option A: Using Helm (Recommended)

1. **Update Helm repository with new code**:
   ```bash
   # Build and push new Docker image to Azure Container Registry
   docker build -t zinfradevv1.azurecr.io/doctor-dashboard:timeout-fix .
   docker push zinfradevv1.azurecr.io/doctor-dashboard:timeout-fix
   ```

2. **Deploy with new image and configuration**:
   ```bash
   # Update the image tag in values.yaml to: timeout-fix
   # Or deploy directly:
   helm upgrade doctor-dashboard ./helm/doctor-dashboard \
     --namespace doctor-dashboard \
     --set image.tag=timeout-fix \
     --values helm/doctor-dashboard/values.yaml
   ```

3. **Verify deployment**:
   ```bash
   kubectl get pods -n doctor-dashboard
   kubectl logs -f deployment/doctor-dashboard -n doctor-dashboard
   ```

### Option B: Using Kubernetes YAML Files

1. **Build and push new Docker image**:
   ```bash
   docker build -t zinfradevv1.azurecr.io/doctor-dashboard:timeout-fix .
   docker push zinfradevv1.azurecr.io/doctor-dashboard:timeout-fix
   ```

2. **Update deployment image**:
   ```bash
   kubectl set image deployment/doctor-dashboard \
     doctor-dashboard=zinfradevv1.azurecr.io/doctor-dashboard:timeout-fix \
     -n doctor-dashboard
   ```

3. **Update ConfigMap with new environment variables**:
   ```bash
   kubectl create configmap doctor-dashboard-config \
     --from-literal=HYBRID_RECONCILER_TIMEOUT=240000 \
     --from-literal=ENABLE_HYBRID_STT=true \
     --from-literal=STT_BACKEND=medasr \
     --from-literal=MEDASR_ENDPOINT=http://206.1.62.28:8008/transcribe \
     --from-literal=MEDASR_TIMEOUT=30000 \
     --from-literal=WHISPER_STT_URL=http://202.88.209.11/whisper/transcribe \
     --dry-run=client -o yaml | kubectl apply -n doctor-dashboard -f -
   ```

4. **Restart deployment**:
   ```bash
   kubectl rollout restart deployment/doctor-dashboard -n doctor-dashboard
   ```

## Verification Steps

1. **Check pod status**: Ensure pods are running and not crashing
2. **Test file upload**: Upload a test audio file and check if reconciliation completes
3. **Test live audio**: Test live conversation feature
4. **Monitor logs**: Check for any timeout errors

## Expected Behavior After Fix

- **File Upload**: Reconciliation should complete within 2-4 minutes instead of timing out
- **Live Audio**: Real-time transcription should work without 504 errors
- **Console Logs**: Should see "Reconciliation completed" instead of timeout errors

## Rollback Plan (If Issues Occur)

```bash
# Rollback to previous version
helm rollback doctor-dashboard -n doctor-dashboard

# Or using kubectl
kubectl rollout undo deployment/doctor-dashboard -n doctor-dashboard
```

## Additional Notes

- **Nginx timeouts** are already properly configured (300s)
- **Gemma service** is responding normally (0.77s average response time)
- **Live audio** will have the same timeout fix applied
- **No database migrations** required

## Questions to Contact Development Team

1. What is the current Docker image tag in production?
2. Are there any custom environment variables not in values.yaml?
3. What is the rollback procedure if issues occur?

---
**Fix validated on**: 2026-06-01  
**Components affected**: File upload transcription, Live conversation audio  
**Risk level**: Low (timeout configuration changes only)