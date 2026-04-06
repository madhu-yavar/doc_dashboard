#!/bin/bash
# Setup local DNS for yavar-clinicalchartboard.local on your Mac

DOMAIN="yavar-clinicalchartboard.local"
MAC_IP="192.168.1.103"

echo "Setting up local DNS for $DOMAIN -> $MAC_IP"
echo ""

# Install dnsmasq if not installed
if ! command -v dnsmasq &> /dev/null; then
    echo "Installing dnsmasq via Homebrew..."
    if ! command -v brew &> /dev/null; then
        echo "Error: Homebrew not found. Please install Homebrew first:"
        echo " /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""
        exit 1
    fi
    brew install dnsmasq
fi

# Configure dnsmasq
echo "Configuring dnsmasq..."
echo "address=/$DOMAIN/$MAC_IP" | sudo tee /usr/local/etc/dnsmasq.d/clinical-dashboard.conf > /dev/null

# Enable and start dnsmasq
echo "Starting dnsmasq service..."
brew services restart dnsmasq

# Configure Mac to use local DNS
echo "Configuring Mac DNS settings..."
sudo mkdir -p /etc/resolver
echo "nameserver 127.0.0.1" | sudo tee /etc/resolver/$DOMAIN > /dev/null

echo ""
echo "✓ Setup complete!"
echo ""
echo "Your dashboard is now accessible at:"
echo "  http://$DOMAIN:8084"
echo ""
echo "Note: Other devices on your network need to:"
echo "  1. Install dnsmasq, or"
echo "  2. Add '$MAC_IP $DOMAIN' to their /etc/hosts file"
echo ""
