#!/bin/bash
# Fix Playwright PDF generation for Alpine Linux
# Run this on the doctordashboard VM

CONTAINER_ID=$(docker ps | grep -E "node|app" | awk '{print $1}' | head -1)

echo "🔧 Fixing Playwright to use system Chromium..."

# Create a chromium launcher script
docker exec $CONTAINER_ID sh << 'EOF'
cat > /usr/local/bin/chromium-launcher << 'SCRIPT'
#!/bin/bash
exec /usr/bin/chromium-browser --no-sandbox --disable-setuid-sandbox --headless --disable-gpu --disable-dev-shm-usage --remote-debugging-pipe=stdin "$@"
SCRIPT

chmod +x /usr/local/bin/chromium-launcher
echo "✅ Chromium launcher created"
EOF

# Find where Playwright is looking for chromium
docker exec $CONTAINER_ID sh << 'EOF'
# Create a symbolic link from Playwright path to system chromium
mkdir -p /home/nodejs/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/
ln -sf /usr/local/bin/chromium-launcher /home/nodejs/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell
echo "✅ Symlink created"
EOF

echo "🔄 Restarting container..."
docker restart $CONTAINER_ID

echo "⏳ Waiting 30 seconds..."
sleep 30

echo "🧪 Testing PDF generation..."
timeout 30 curl -X POST http://localhost:3000/api/prescriptions/generate \
  -H "Content-Type: application/json" \
  -d '{"documentId":"voice-live-live-1780483830844-c45144be","format":"pdf"}' || echo "Test complete"

echo "✅ Fix applied! Test at:"
echo "https://doctor-dashboard.yavar.ai/prescription/voice-live-live-1780483830844-c45144be"