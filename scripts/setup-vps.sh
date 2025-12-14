#!/bin/bash

set -e

echo "🔧 Earthly VPS Setup Script"
echo ""
echo "This script will help you set up your VPS for deployment."
echo ""

# Prompt for VPS details
read -p "Enter VPS hostname or IP: " VPS_HOST
read -p "Enter VPS user (e.g., deploy, ubuntu): " VPS_USER

echo ""
echo "📋 This script will:"
echo "  1. Test SSH connection"
echo "  2. Create deployment directory"
echo "  3. Set correct permissions"
echo "  4. Copy your SSH key for passwordless access"
echo ""
read -p "Continue? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 1
fi

echo ""
echo "🔍 Testing SSH connection..."
if ! ssh -o ConnectTimeout=5 $VPS_USER@$VPS_HOST "echo 'SSH connection successful'"; then
    echo "❌ SSH connection failed. Please check your VPS_HOST and VPS_USER."
    exit 1
fi

echo ""
echo "📁 Creating deployment directory..."
# Use -tt to force a TTY so sudo can prompt even though we're piping a heredoc
ssh -tt $VPS_USER@$VPS_HOST << 'ENDSSH'
    # Create directory with sudo if needed
    if [ ! -d "/var/www/earthly" ]; then
        echo "Creating /var/www/earthly..."
        sudo mkdir -p /var/www/earthly
    fi

    # Change ownership to current user
    echo "Setting ownership to $USER..."
    sudo chown -R $USER:$USER /var/www/earthly

    # Verify permissions
    if [ -w "/var/www/earthly" ]; then
        echo "✅ Directory is writable"
    else
        echo "❌ Directory is not writable"
        exit 1
    fi
ENDSSH

if [ $? -ne 0 ]; then
    echo ""
    echo "⚠️  If you saw password prompt errors, you may need to configure passwordless sudo for the deploy user."
    echo "Run this on your VPS as root:"
    echo "  echo \"$VPS_USER ALL=(ALL) NOPASSWD: /bin/mkdir, /bin/chown\" | sudo tee /etc/sudoers.d/$VPS_USER-deploy"
    exit 1
fi

echo ""
echo "🔑 Setting up SSH key for passwordless access..."

# Check if local SSH key exists
if [ ! -f ~/.ssh/id_rsa.pub ]; then
    echo "No SSH key found. Generating one..."
    ssh-keygen -t rsa -b 4096 -C "$(whoami)@$(hostname)" -f ~/.ssh/id_rsa -N ""
fi

# Copy SSH key to VPS
echo "Copying SSH key to VPS..."
ssh-copy-id -i ~/.ssh/id_rsa.pub $VPS_USER@$VPS_HOST

echo ""
echo "✅ VPS setup complete!"
echo ""
echo "Next steps:"
echo "  1. Update your .env file with:"
echo "     VPS_HOST=$VPS_HOST"
echo "     VPS_USER=$VPS_USER"
echo "     VPS_PATH=/var/www/earthly"
echo ""
echo "  2. Run: bun run deploy"
