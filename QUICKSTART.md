# Quick Start Guide

Get up and running with Kalshi Parlay Helper in 5 minutes!

## Prerequisites

- Node.js 18+ installed
- Chrome browser
- Kalshi API key (get from Kalshi dashboard)

## Setup (3 Steps)

### Step 1: Database Setup (Choose one option)

#### Option A: Local PostgreSQL (5 minutes)

```bash
# macOS
brew install postgresql@15
brew services start postgresql@15
createdb kalshi_parlay

# Ubuntu/Debian
sudo apt-get install postgresql
sudo systemctl start postgresql
sudo -u postgres createdb kalshi_parlay
```

#### Option B: Free Cloud Database (3 minutes)

**Using Supabase** (Recommended - Easiest):
1. Go to https://supabase.com and sign up
2. Create a new project
3. Wait ~2 minutes for database provisioning
4. Go to Settings > Database
5. Copy the "Connection string" (URI format)

**Using Neon**:
1. Go to https://neon.tech and sign up
2. Create a new project
3. Copy the connection string

### Step 2: Backend Setup

```bash
# Install dependencies
npm install

# Create .env file (paste your actual values)
cat > .env << 'EOF'
PORT=4000
KALSHI_API_BASE_URL=https://api.elections.kalshi.com/trade-api/v2
KALSHI_API_KEY=your_kalshi_api_key_here
KALSHI_API_KEY_ID=your_api_key_id_here
KALSHI_PRIVATE_KEY_PATH=./keys/kalshi_private_key.pem
DATABASE_URL=postgresql://your_connection_string_here
NODE_ENV=development
EOF

# Edit the .env file with your actual credentials
nano .env  # or use your favorite text editor

# Start the backend
npm start
```

You should see:
```
[DB] Database initialized successfully
Kalshi backend listening on http://localhost:4000
```

### Step 3: Load Chrome Extension

1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" (toggle in top-right)
3. Click "Load unpacked"
4. Select the `KalshiExtension` folder
5. Done! The extension is now active

## Test It Out

1. Visit a Kalshi market: https://kalshi.com/markets/kxnflgame/professional-football-game/kxnflgame-25nov16seala
2. Click the extension icon in your Chrome toolbar
3. You should see the market details load
4. Click on an option to select it
5. Click "Add to Parlay"
6. Your bet is now saved in the database!

Visit another market and add more bets to build your parlay.

## Troubleshooting

### "Backend error" in the extension

**Problem**: Can't connect to backend

**Solution**:
```bash
# Check if backend is running
curl http://localhost:4000/api/health

# If not running, start it:
npm start
```

### "Failed to initialize database"

**Problem**: Database connection failed

**Solutions**:
1. Check your `DATABASE_URL` is correct
2. Ensure PostgreSQL is running (if local)
3. Test the connection:
```bash
# If using local PostgreSQL
psql $DATABASE_URL -c "SELECT 1"

# Or just
psql kalshi_parlay -c "SELECT 1"
```

### "Could not extract market ID"

**Problem**: Not on a valid Kalshi market page

**Solution**: Make sure you're on a URL like `kalshi.com/markets/...`

### Extension not loading data

**Problem**: Content script not injected

**Solution**:
1. Reload the extension in `chrome://extensions/`
2. Hard refresh the Kalshi page (Cmd+Shift+R or Ctrl+Shift+R)
3. Check the browser console for errors (right-click popup > Inspect)

## What's Working?

✅ Your parlays are now **persistent across sessions**  
✅ Close the browser and come back - your parlays are still there  
✅ Add bets from multiple markets  
✅ See combined probability calculations  
✅ Click "Place Your Bet" to clear and start over  

## Next Steps

- Read [README.md](./README.md) for complete documentation
- See [DATABASE_SETUP.md](./DATABASE_SETUP.md) for advanced database options
- Check [CHANGELOG.md](./CHANGELOG.md) for version history

## Getting Your Kalshi API Key

1. Log in to Kalshi
2. Go to Settings > API
3. Create a new API key
4. Copy the API Key ID and download the private key
5. Save the private key in `keys/kalshi_private_key.pem` (if using key-based auth)

**Note**: For this extension, you need the API key for read access to market data.

## Need Help?

- Check the browser console (right-click popup > Inspect)
- Check the backend logs in your terminal
- Review the troubleshooting sections in README.md
- Open an issue on GitHub

## Development Mode

Want to make changes?

```bash
# Terminal 1: Run backend with auto-reload
npm run dev

# Terminal 2: Make your changes
# Then reload the extension in chrome://extensions/
```

## Architecture at a Glance

```
You open extension → Loads your parlay from PostgreSQL
                   ↓
You select option → Click "Add to Parlay"
                   ↓
Saved to database → Persists forever (until you place the bet)
                   ↓
You place bet → Parlay is cleared from database
```

That's it! You're ready to build parlays. 🎯


