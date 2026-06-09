# SSH Connection Troubleshooting

## Issue: SSH Connection Timing Out to GCP

### Quick Fixes to Try:

1. **Test Basic Connectivity**
```bash
# Can you reach the GCP instance at all?
ping -c 3 35.244.7.120

# Check if port 22 is open
nc -zv 35.244.7.120 22
```

2. **Try Different SSH Options**
```bash
cd /Users/yavar/Documents/CoE/Manipal/gcp

# With more verbosity
ssh -i yavar-poc -v yavar-poc@35.244.7.120 "echo test"

# With longer timeout
ssh -i yavar-poc -o ConnectTimeout=60 yavar-poc@35.244.7.120 "echo test"
```

3. **Check GCP Instance Status**
```bash
# If you have GCP CLI installed:
gcloud compute instances describe --zone=YOUR_ZONE yavar-poc

# Or check GCP Console to see if instance is running
```

4. **Network Issues**
- Check your internet connection
- Try from different network (WiFi vs mobile hotspot)
- Check if VPN is interfering

### When SSH Works - Deploy Immediately:

```bash
cd /Users/yavar/Documents/CoE/Manipal/gcp

# Run automated deployment
./deploy-doctor-dashboard.sh

# Or manually
ssh -i yavar-poc yavar-poc@35.244.7.120
# Then follow MANUAL_DEPLOY.md steps
```

### Alternative: GCP Console Deployment

If SSH continues to fail:

1. **Use GCP Console Browser Shell**
   - Go to Google Cloud Console
   - Navigate to Compute Engine → VM instances
   - Click "SSH" button next to yavar-poc instance
   - Use browser-based SSH to run deployment commands

2. **Use GCP Cloud Shell**
   - Open Cloud Shell from GCP Console
   - SSH from there to your instance
   - Run deployment commands

## Files Ready to Deploy:

✅ Updated Dockerfile with Playwright + templates  
✅ Updated package.json with playwright dependency  
✅ Complete prescription_template_dev/ directory  
✅ All server/, agents/, skills/ files  

## Current Production Issues (from analysis):

1. **Prescription**: Missing CSS/JS files in container
2. **Playwright**: Chromium not installed properly  
3. **WebSocket**: Connections closing immediately (code 1000)
4. **Environment**: ✅ All STT variables configured correctly

## Fixes Applied in Updated Files:

- **Dockerfile**: Copies complete template directory + Playwright installation
- **package.json**: Added playwright dependency  
- **Template files**: All 4 files (HTML, CSS, JS, README) ready

Deploy when SSH is stable and all issues will be resolved!
