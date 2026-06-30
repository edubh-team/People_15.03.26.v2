#!/bin/bash

# Exit on error
set -e

echo "Starting Production Setup..."

# 1. Update System
echo "Updating system packages..."
apt-get update && apt-get upgrade -y
apt-get install -y git nginx certbot python3-certbot-nginx

# 2. Setup Swap File (Crucial for stability)
# We add 4GB of swap space to act as a buffer for the 2GB RAM
if [ ! -f /swapfile ]; then
    echo "Creating 4GB Swap file..."
    fallocate -l 4G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    echo '/swapfile none swap sw 0 0' | tee -a /etc/fstab
    echo "Swap created successfully."
else
    echo "Swap file already exists. Skipping."
fi

# Optimize Swap settings
sysctl vm.swappiness=10
echo 'vm.swappiness=10' >> /etc/sysctl.conf

# 3. Install Docker (if not present)
if ! command -v docker &> /dev/null; then
    echo "Installing Docker..."
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh
    rm get-docker.sh
    echo "Docker installed."
else
    echo "Docker is already installed."
fi

# 4. Final Instructions
echo "--------------------------------------------"
echo "✅ Server Setup Complete!"
echo ""
echo "Next Steps:"
echo "1. Create your secrets file:"
echo "   nano .env.local"
echo ""
echo "2. Configure Nginx (Update 'YOUR_DOMAIN_NAME' in nginx.conf first!):"
echo "   cp nginx.conf /etc/nginx/sites-available/people-hrms"
echo "   ln -s /etc/nginx/sites-available/people-hrms /etc/nginx/sites-enabled/"
echo "   rm /etc/nginx/sites-enabled/default"
echo "   nginx -t && systemctl restart nginx"
echo ""
echo "3. Run the deployment script:"
echo "   ./deploy.sh"
echo ""
echo "4. Enable SSL (HTTPS):"
echo "   certbot --nginx -d YOUR_DOMAIN_NAME"
echo "--------------------------------------------"
