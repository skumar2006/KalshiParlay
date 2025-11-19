#!/bin/bash

# Kalshi Parlay Helper - Setup Script
# This script helps you set up the extension and backend

set -e

echo "🎯 Kalshi Parlay Helper - Setup"
echo "================================"
echo ""

# Check Node.js installation
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed"
    echo "Please install Node.js 18+ from https://nodejs.org/"
    exit 1
fi

NODE_VERSION=$(node -v)
echo "✅ Node.js version: $NODE_VERSION"

# Check npm installation
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed"
    exit 1
fi

echo "✅ npm is installed"
echo ""

# Install dependencies
echo "📦 Installing dependencies..."
npm install
echo "✅ Dependencies installed"
echo ""

# Check if .env exists
if [ -f ".env" ]; then
    echo "✅ .env file already exists"
else
    echo "⚠️  No .env file found"
    echo ""
    echo "Please create a .env file with the following variables:"
    echo ""
    echo "PORT=4000"
    echo "KALSHI_API_BASE_URL=https://api.elections.kalshi.com/trade-api/v2"
    echo "KALSHI_API_KEY=your_kalshi_api_key"
    echo "KALSHI_API_KEY_ID=your_api_key_id"
    echo "KALSHI_PRIVATE_KEY_PATH=./keys/kalshi_private_key.pem"
    echo "DATABASE_URL=postgresql://localhost:5432/kalshi_parlay"
    echo "NODE_ENV=development"
    echo ""
    
    read -p "Would you like to create a template .env file now? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        cat > .env << 'EOF'
PORT=4000
KALSHI_API_BASE_URL=https://api.elections.kalshi.com/trade-api/v2
KALSHI_API_KEY=your_kalshi_api_key
KALSHI_API_KEY_ID=your_api_key_id
KALSHI_PRIVATE_KEY_PATH=./keys/kalshi_private_key.pem
DATABASE_URL=postgresql://localhost:5432/kalshi_parlay
NODE_ENV=development
EOF
        echo "✅ Created .env file"
        echo "⚠️  Please edit .env and add your actual API credentials and database URL"
    fi
fi

echo ""

# Check PostgreSQL
echo "🔍 Checking PostgreSQL..."
if command -v psql &> /dev/null; then
    echo "✅ PostgreSQL is installed"
    
    # Try to connect to default database
    if psql -lqt 2>/dev/null | cut -d \| -f 1 | grep -qw kalshi_parlay; then
        echo "✅ kalshi_parlay database exists"
    else
        echo "⚠️  kalshi_parlay database does not exist"
        read -p "Would you like to create it now? (y/n) " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            createdb kalshi_parlay 2>/dev/null && echo "✅ Created kalshi_parlay database" || echo "❌ Failed to create database"
        fi
    fi
else
    echo "⚠️  PostgreSQL is not installed or not in PATH"
    echo ""
    echo "To install PostgreSQL:"
    echo "  macOS:    brew install postgresql@15 && brew services start postgresql@15"
    echo "  Ubuntu:   sudo apt-get install postgresql"
    echo ""
    echo "Or use a cloud database provider like Supabase, Neon, or Railway"
    echo "See DATABASE_SETUP.md for more details"
fi

echo ""
echo "================================"
echo "🎉 Setup Complete!"
echo ""
echo "Next steps:"
echo "1. Edit .env and add your Kalshi API credentials"
echo "2. Set up your PostgreSQL database (see DATABASE_SETUP.md)"
echo "3. Start the backend: npm start"
echo "4. Load the extension in Chrome:"
echo "   - Go to chrome://extensions/"
echo "   - Enable 'Developer mode'"
echo "   - Click 'Load unpacked'"
echo "   - Select this folder"
echo ""
echo "Need help? Check README.md for detailed instructions"
echo ""


