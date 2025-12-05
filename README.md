# Kalshi Parlay Helper Chrome Extension

A Chrome extension that helps you build parlays from Kalshi markets. Browse markets on Kalshi.com, select your favorite options, and build multi-market parlays with persistent storage.

## Features

- 🎯 **Automatic Market Detection**: Detects when you're on a Kalshi market page
- 📊 **Live Market Data**: Fetches real-time prices and probabilities from Kalshi API
- 🖼️ **Visual Market Cards**: Displays market images and information
- 🎲 **Parlay Builder**: Add multiple markets to build a parlay bet
- 💾 **Persistent Storage**: Your parlay is saved in a PostgreSQL database across sessions
- 📈 **Probability Calculation**: Automatically calculates combined parlay probability
- 🎨 **Modern UI**: Clean, intuitive interface

## Architecture

```
┌─────────────────┐         ┌──────────────────┐         ┌─────────────────┐
│  Chrome         │         │  Node.js/Express │         │  PostgreSQL     │
│  Extension      │ ◄─────► │  Backend         │ ◄─────► │  Database       │
│  (Frontend)     │         │  (API Server)    │         │                 │
└─────────────────┘         └──────────────────┘         └─────────────────┘
                                    │
                                    ▼
                            ┌──────────────────┐
                            │  Kalshi API      │
                            │  (Market Data)   │
                            └──────────────────┘
```

## Installation

### 1. Prerequisites

- Node.js 18+ and npm
- PostgreSQL database (local or cloud)
- Chrome browser
- Kalshi API credentials

### 2. Database Setup

See [DATABASE_SETUP.md](./DATABASE_SETUP.md) for detailed instructions on setting up PostgreSQL.

Quick start for local development:
```bash
# Install PostgreSQL
brew install postgresql@15
brew services start postgresql@15

# Create database
createdb kalshi_parlay
```

### 3. Backend Setup

```bash
# Clone or navigate to the project
cd KalshiExtension

# Install dependencies
npm install

# Create .env file
cat > .env << 'EOF'
PORT=4000
KALSHI_API_BASE_URL=https://api.elections.kalshi.com/trade-api/v2
KALSHI_API_KEY=your_kalshi_api_key
KALSHI_API_KEY_ID=your_api_key_id
KALSHI_PRIVATE_KEY_PATH=./keys/kalshi_private_key.pem
DATABASE_URL=postgresql://localhost:5432/kalshi_parlay
NODE_ENV=development
EOF

# Start the backend server
npm start
```

The server will:
- Initialize the database tables automatically
- Start listening on http://localhost:4000
- Connect to Kalshi API for market data

### 4. Chrome Extension Setup

1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" (toggle in top-right corner)
3. Click "Load unpacked"
4. Select the `KalshiExtension` folder
5. The extension should appear in your extensions list

### 5. Test It Out

1. Navigate to a Kalshi market, e.g., https://kalshi.com/markets/kxnflgame/professional-football-game/kxnflgame-25nov16seala
2. Click the extension icon in your toolbar
3. You should see:
   - The market title and image
   - Available betting options with probabilities
   - "Add to Parlay" button
   - Your current parlay (if any)

## Usage

### Building a Parlay

1. **Visit a Kalshi market page**
   - The extension will automatically detect the market
   - Market data will load from the Kalshi API

2. **Select an option**
   - Click on any betting option to select it
   - The selected option will be highlighted
   - "Add to Parlay" button becomes enabled

3. **Add to your parlay**
   - Click "Add to Parlay"
   - The bet is saved to your database
   - Your parlay updates automatically

4. **Repeat for more markets**
   - Visit other Kalshi markets
   - Add more options to build your parlay
   - Each bet is saved independently

5. **Place your bet**
   - Review your parlay with combined probability
   - Click "Place Your Bet" to see the summary
   - The parlay is cleared after placement

### Managing Your Parlay

- **View Current Parlay**: Open the extension on any Kalshi page
- **Remove Individual Bets**: Click the × button on any bet to remove it
- **Cross-Session**: Your parlay persists even if you close the browser
- **Auto-Clear**: Parlay is automatically cleared after placing a bet

## Project Structure

```
KalshiExtension/
├── manifest.json          # Chrome extension manifest
├── popup.html            # Extension popup UI
├── popup.css             # Popup styles
├── popup.js              # Frontend logic
├── contentScript.js      # Content script for DOM scraping
├── package.json          # Node.js dependencies
├── server/
│   ├── index.js         # Express server & API routes
│   ├── kalshiClient.js  # Kalshi API client
│   └── db.js            # PostgreSQL database functions
├── DATABASE_SETUP.md     # Database setup guide
└── README.md            # This file
```

## API Endpoints

### Market Data
- `GET /api/health` - Health check
- `GET /api/kalshi/market/:id` - Get market data from Kalshi

### Parlay Management
- `GET /api/parlay/:userId` - Get all parlay bets for a user
- `POST /api/parlay/:userId` - Add a bet to the parlay
  ```json
  {
    "marketId": "kxnflgame-25nov16seala",
    "marketTitle": "Seattle at Los Angeles",
    "imageUrl": "https://...",
    "optionId": "KXNFLGAME-25NOV16SEALA-SEA",
    "optionLabel": "SEA",
    "prob": 45
  }
  ```
- `DELETE /api/parlay/:userId/:betId` - Remove a specific bet
- `DELETE /api/parlay/:userId` - Clear all bets

## Database Schema

### users
```sql
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(255) UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### parlay_bets
```sql
CREATE TABLE parlay_bets (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL,
  market_id VARCHAR(255) NOT NULL,
  market_title TEXT NOT NULL,
  image_url TEXT,
  option_id VARCHAR(255) NOT NULL,
  option_label VARCHAR(255) NOT NULL,
  prob DECIMAL(5, 2),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);
```

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Backend server port | `4000` |
| `KALSHI_API_BASE_URL` | Kalshi API base URL | `https://api.elections.kalshi.com/trade-api/v2` |
| `KALSHI_API_KEY` | Your Kalshi API key | Required |
| `KALSHI_API_KEY_ID` | Your Kalshi API key ID | Required |
| `KALSHI_PRIVATE_KEY_PATH` | Path to private key | `./keys/kalshi_private_key.pem` |
| `DATABASE_URL` | PostgreSQL connection string | Required |
| `NODE_ENV` | Environment (development/production) | `development` |

### Extension Permissions

The extension requires the following permissions:
- `tabs` - To detect the current Kalshi page
- `activeTab` - To access the current tab's URL
- `storage` - To store user ID locally
- `host_permissions` - To access Kalshi.com and localhost backend

## Development

### Running in Development Mode

```bash
# Terminal 1: Start the backend with auto-reload
npm run dev

# Terminal 2: Make changes to the extension
# After making changes, reload the extension in chrome://extensions/
```

### Debugging

**Backend:**
- Check server logs in your terminal
- Test API endpoints with curl or Postman

**Extension:**
- Right-click the extension popup → "Inspect"
- Check the Console tab for logs
- Errors will show in the popup UI

**Database:**
```bash
# Connect to your database
psql $DATABASE_URL

# View users
SELECT * FROM users;

# View parlay bets
SELECT * FROM parlay_bets;
```

## Troubleshooting

### Extension not detecting Kalshi markets
- Make sure you're on a URL starting with `kalshi.com/markets`
- Reload the Kalshi page after updating the extension
- Check the browser console for errors

### Backend connection errors
- Ensure the backend is running on http://localhost:4000
- Check that `BACKEND_BASE_URL` in `popup.js` matches your server port
- Verify `host_permissions` in `manifest.json` includes your backend URL

### Database connection issues
- Verify `DATABASE_URL` is correct
- Check that PostgreSQL is running
- See [DATABASE_SETUP.md](./DATABASE_SETUP.md) for detailed troubleshooting

### Kalshi API errors
- Verify your `KALSHI_API_KEY` is valid
- Check that you're using the correct API base URL
- Some markets may not be available through the API

## Future Enhancements

- [ ] Place bets directly through Kalshi API
- [ ] Add bet amount calculations and payouts
- [ ] Support for removing individual bets from parlay
- [ ] Market search and discovery
- [ ] Historical parlay tracking
- [ ] Multi-user support with authentication
- [ ] Odds comparison across markets
- [ ] Push notifications for market changes

## Contributing

Contributions are welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

MIT License - see LICENSE file for details

## Support

For issues, questions, or feature requests, please open an issue on GitHub.

## Acknowledgments

- Built with the Kalshi API for market data
- Uses PostgreSQL for persistent storage
- Chrome Extension Manifest V3
# KalshiParlay
