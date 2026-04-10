# Adding Gemini API Key to Doctor Dashboard

## Problem
The chat system was using RxNorm instead of Google Search because the `GEMINI_API_KEY` was not configured in the deployed environment.

## Solution

### Option 1: Via Azure Portal (Recommended)

1. **Go to Azure Container Apps**
   - Navigate to: https://portal.azure.com
   - Go to: Container Apps → doctor-dashboard

2. **Add the Secret**
   - Click on "Settings" → "Secrets"
   - Click "Add secret"
   - Name: `gemini-api-key`
   - Value: `<your Gemini API key>`
   - Click "Add"

3. **Add the Environment Variable**
   - Click on "Settings" → "Environment variables" (or "Containers")
   - Click "Edit" next to the doctor-dashboard container
   - Add a new environment variable:
     - Name: `GEMINI_API_KEY`
     - Type: "Reference a secret"
     - Secret reference: `gemini-api-key`
   - Click "Save"

4. **Apply Changes**
   - The container app will restart automatically with the new configuration

### Option 2: Via Azure CLI

```bash
# Set the secret
az containerapp secret set \
  --name doctor-dashboard \
  --resource-group Z-INFRA-STACK-DEV \
  --secrets gemini-api-key=<your-api-key>

# Update environment variables
az containerapp update \
  --name doctor-dashboard \
  --resource-group Z-INFRA-STACK-DEV \
  --set-env-vars GEMINI_API_KEY=secretref:gemini-api-key
```

### Option 3: Via Bicep/ARM Template

The configuration has been added to `aca/container-app.yaml`. You can deploy using:

```bash
# First update the secret value in the file
# Then apply the configuration
```

## Verification

After applying the changes, the chat should use Google Search for external queries. You'll see citations like `[Gemini: ...]` instead of `[RxNorm: ...]`.

## Getting a Gemini API Key

1. Go to: https://makersuite.google.com/app/apikey
2. Create a new API key
3. Restrict it to "Generative Language API"
4. Copy the API key and add it to the Azure Container App configuration

## Environment Variables Summary

| Variable | Value | Required |
|----------|-------|----------|
| `USE_GEMINI_FOR_EXTERNAL` | `true` | Yes (for Google Search) |
| `GEMINI_API_KEY` | `<your API key>` | Yes (for external search) |
| `GEMINI_MODEL` | `gemini-2.5-flash` or similar | No (has default) |
