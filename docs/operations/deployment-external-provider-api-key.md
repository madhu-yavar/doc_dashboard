# Adding an External Provider API Key to Doctor Dashboard

## Problem
The chat system was staying on internal-only knowledge sources because the external-provider API key was not configured in the deployed environment.

## Solution

### Option 1: Via Azure Portal (Recommended)

1. **Go to Azure Container Apps**
   - Navigate to: https://portal.azure.com
   - Go to: Container Apps → doctor-dashboard

2. **Add the Secret**
   - Click on "Settings" → "Secrets"
   - Click "Add secret"
   - Name: `external-provider-api-key`
   - Value: `<your external-provider API key>`
   - Click "Add"

3. **Add the Environment Variable**
   - Click on "Settings" → "Environment variables" (or "Containers")
   - Click "Edit" next to the doctor-dashboard container
   - Add a new environment variable:
     - Name: `EXTERNAL_PROVIDER_API_KEY`
     - Type: "Reference a secret"
     - Secret reference: `external-provider-api-key`
   - Click "Save"

4. **Apply Changes**
   - The container app will restart automatically with the new configuration

### Option 2: Via Azure CLI

```bash
# Set the secret
az containerapp secret set \
  --name doctor-dashboard \
  --resource-group Z-INFRA-STACK-DEV \
  --secrets external-provider-api-key=<your-api-key>

# Update environment variables
az containerapp update \
  --name doctor-dashboard \
  --resource-group Z-INFRA-STACK-DEV \
  --set-env-vars EXTERNAL_PROVIDER_API_KEY=secretref:external-provider-api-key
```

### Option 3: Via Bicep/ARM Template

The configuration has been added to `aca/container-app.yaml`. You can deploy using:

```bash
# First update the secret value in the file
# Then apply the configuration
```

## Verification

After applying the changes, the chat should be able to use the configured external knowledge source for eligible queries instead of staying on internal-only references.

## Getting an External Provider API Key

1. Open the approved external provider portal for your deployment.
2. Create or retrieve the API key allowed for this environment.
3. Apply the provider-specific restrictions required by your security policy.
4. Add the API key to the Azure Container App configuration.

## Environment Variables Summary

| Variable | Value | Required |
|----------|-------|----------|
| `ENABLE_EXTERNAL_PROVIDER_LOOKUP` | `true` | Yes (for external lookups) |
| `EXTERNAL_PROVIDER_API_KEY` | `<your API key>` | Yes (for external lookups) |
| `EXTERNAL_PROVIDER_PROFILE` | deployment default | No |
