# Architecture Overview

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                          USER BROWSER                                 │
│                                                                       │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │           Chrome Extension (Frontend)                       │    │
│  │                                                             │    │
│  │  ┌──────────────┐  ┌──────────────┐  ┌─────────────────┐ │    │
│  │  │  popup.html  │  │  popup.js    │  │ contentScript.js│ │    │
│  │  │  (UI Layer)  │◄─│  (Logic)     │◄─│  (DOM Scraper)  │ │    │
│  │  └──────────────┘  └──────┬───────┘  └─────────────────┘ │    │
│  │                            │                                │    │
│  │                            │ Chrome Storage API             │    │
│  │                            ▼                                │    │
│  │                    ┌──────────────┐                        │    │
│  │                    │   User ID    │                        │    │
│  │                    │ (Persistent) │                        │    │
│  │                    └──────────────┘                        │    │
│  └────────────────────────────┬───────────────────────────────┘    │
│                               │                                     │
└───────────────────────────────┼─────────────────────────────────────┘
                                │
                                │ HTTP/REST API
                                │ (localhost:4000)
                                ▼
┌───────────────────────────────────────────────────────────────────────┐
│                       Backend Server (Node.js/Express)                │
│                                                                       │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │  server/index.js                                               │ │
│  │  ┌──────────────────┐  ┌──────────────────┐  ┌─────────────┐ │ │
│  │  │  API Routes      │  │  Kalshi Client   │  │ DB Client   │ │ │
│  │  │  /api/kalshi/*   │  │ kalshiClient.js  │  │  db.js      │ │ │
│  │  │  /api/parlay/*   │  │                  │  │             │ │ │
│  │  └─────────┬────────┘  └────────┬─────────┘  └──────┬──────┘ │ │
│  │            │                    │                    │        │ │
│  └────────────┼────────────────────┼────────────────────┼────────┘ │
└───────────────┼────────────────────┼────────────────────┼──────────┘
                │                    │                    │
                │                    │                    │
                │                    ▼                    ▼
                │         ┌──────────────────┐  ┌────────────────┐
                │         │   Kalshi API     │  │   PostgreSQL   │
                │         │  (Market Data)   │  │   Database     │
                │         └──────────────────┘  └────────────────┘
                │
                │ Returns: Market details, contracts, probabilities
                ▼
          ┌──────────────┐
          │  Extension   │
          │  Updates UI  │
          └──────────────┘
```

## Component Breakdown

### Frontend Components

#### 1. **popup.html** (UI Layer)
- Displays market information
- Shows betting options
- Renders current parlay
- Provides action buttons

#### 2. **popup.js** (Business Logic)
- **State Management**:
  - `currentMarket`: Currently viewed market data
  - `selectedOption`: User's selected betting option
  - `parlayBets`: Array of bets in the parlay
  - `userId`: Unique user identifier

- **Key Functions**:
  - `getUserId()`: Get/generate unique user ID
  - `init()`: Initialize extension, load data
  - `renderOptions()`: Display market betting options
  - `selectOption()`: Handle option selection
  - `addToParlay()`: Save bet to database
  - `placeBet()`: Submit parlay and clear database
  - `renderParlay()`: Display current parlay

#### 3. **contentScript.js** (DOM Scraper)
- Injects into Kalshi pages
- Extracts market image from DOM
- Sends data to popup via Chrome messaging
- Fallback for missing API data

#### 4. **manifest.json** (Extension Configuration)
- Defines extension permissions
- Configures content script injection
- Sets up popup and icons

### Backend Components

#### 1. **server/index.js** (API Server)

**Market Endpoints**:
- `GET /api/health` → Health check
- `GET /api/kalshi/market/:id` → Fetch market data from Kalshi

**Parlay Endpoints**:
- `GET /api/parlay/:userId` → Get user's parlay bets
- `POST /api/parlay/:userId` → Add bet to parlay
- `DELETE /api/parlay/:userId/:betId` → Remove specific bet
- `DELETE /api/parlay/:userId` → Clear entire parlay

#### 2. **server/kalshiClient.js** (Kalshi API Integration)

**Functions**:
- `kalshiRequest(path)`: Make authenticated API calls
- `getMarketById(marketId)`: Fetch market details
- `getMarketOrderbook(marketId)`: Fetch orderbook data

**Flow**:
1. Extract series from market ticker (e.g., "KXNFLGAME" from "KXNFLGAME-25NOV16SEALA")
2. Fetch all markets in series
3. Filter for exact market or related event markets
4. Parse and return market data with contracts

#### 3. **server/db.js** (Database Layer)

**Schema**:
```sql
users:
  - id (serial primary key)
  - user_id (varchar, unique)
  - created_at (timestamp)

parlay_bets:
  - id (serial primary key)
  - user_id (varchar, foreign key)
  - market_id (varchar)
  - market_title (text)
  - image_url (text)
  - option_id (varchar)
  - option_label (varchar)
  - prob (decimal)
  - created_at (timestamp)
```

**Functions**:
- `initializeDatabase()`: Create tables and indexes
- `getOrCreateUser(userId)`: Ensure user exists
- `getParlayBets(userId)`: Retrieve all bets
- `addParlayBet(userId, bet)`: Insert new bet
- `removeParlayBet(userId, betId)`: Delete specific bet
- `clearParlayBets(userId)`: Delete all user's bets

## Data Flow

### Scenario 1: Loading a Market

```
1. User visits Kalshi market page
   └─> Extension popup opens

2. popup.js init()
   ├─> Extract marketId from URL
   ├─> Fetch from backend: GET /api/kalshi/market/:id
   │   └─> Backend calls Kalshi API
   │       └─> Returns market data (title, contracts, probabilities)
   ├─> Request image from contentScript.js
   │   └─> contentScript scrapes DOM for image
   └─> Load existing parlay: GET /api/parlay/:userId
       └─> Backend queries PostgreSQL
           └─> Returns user's saved bets

3. UI Updates
   ├─> Display market title and image
   ├─> Render betting options with probabilities
   └─> Show current parlay bets
```

### Scenario 2: Adding to Parlay

```
1. User clicks on an option
   └─> popup.js selectOption()
       ├─> Highlight selected option
       └─> Enable "Add to Parlay" button

2. User clicks "Add to Parlay"
   └─> popup.js addToParlay()
       ├─> Check for duplicates
       ├─> POST /api/parlay/:userId with bet data
       │   └─> Backend db.addParlayBet()
       │       ├─> Ensure user exists in DB
       │       ├─> INSERT INTO parlay_bets
       │       └─> Return bet with DB id
       └─> Update UI
           ├─> Add bet to parlayBets array
           ├─> Re-render parlay section
           └─> Enable "Place Your Bet" button
```

### Scenario 3: Placing a Bet

```
1. User clicks "Place Your Bet"
   └─> popup.js placeBet()
       ├─> Calculate combined probability
       │   └─> Multiply all individual probabilities
       ├─> Show alert with parlay summary
       ├─> DELETE /api/parlay/:userId
       │   └─> Backend db.clearParlayBets()
       │       └─> DELETE FROM parlay_bets WHERE user_id = ?
       └─> Update UI
           ├─> Clear parlayBets array
           ├─> Show "No bets added yet"
           └─> Disable "Place Your Bet" button
```

## Security Considerations

### Current Implementation

1. **User Identification**:
   - Uses randomly generated IDs
   - Stored in Chrome local storage
   - Not tied to actual Kalshi accounts

2. **API Keys**:
   - Stored in backend `.env` file
   - Never exposed to frontend
   - Backend acts as proxy

3. **Database Access**:
   - Connection string in backend only
   - No direct database access from extension
   - All queries through API endpoints

### Future Enhancements

- [ ] Add proper user authentication
- [ ] Implement API rate limiting
- [ ] Add request validation and sanitization
- [ ] Encrypt sensitive data in database
- [ ] Add HTTPS for production deployment
- [ ] Implement OAuth with Kalshi

## Performance Optimizations

### Current Optimizations

1. **Database**:
   - Connection pooling with `pg.Pool`
   - Indexes on frequently queried columns
   - Efficient JOIN queries

2. **API Calls**:
   - Caching market data (frontend state)
   - Batch queries where possible
   - Error handling with retries

3. **UI**:
   - Efficient DOM updates
   - Minimal re-renders
   - Event delegation where possible

### Future Optimizations

- [ ] Add Redis caching layer
- [ ] Implement WebSocket for real-time updates
- [ ] Add service worker for background sync
- [ ] Optimize bundle size
- [ ] Lazy load components

## Scalability

### Current Capacity

- **Users**: Can handle thousands of concurrent users
- **Database**: PostgreSQL scales to millions of rows
- **API**: Express can handle thousands of requests/second

### Scaling Strategy

1. **Horizontal Scaling**:
   - Multiple backend instances behind load balancer
   - Shared PostgreSQL database
   - Redis for session management

2. **Database Scaling**:
   - Read replicas for query distribution
   - Partitioning for large tables
   - Archiving old bets

3. **Caching**:
   - Redis for frequently accessed data
   - CDN for static assets
   - Browser caching for images

## Technology Stack

### Frontend
- **Runtime**: Chrome Extension (Manifest V3)
- **Language**: JavaScript (ES6+)
- **Storage**: Chrome Storage API
- **UI**: Vanilla HTML/CSS

### Backend
- **Runtime**: Node.js
- **Framework**: Express.js
- **Database**: PostgreSQL (via `pg` client)
- **HTTP Client**: node-fetch
- **Config**: dotenv

### External APIs
- **Kalshi API**: Market data, orderbooks, prices
- **Future**: Betting execution, user auth

## Development Workflow

```
1. Make changes to code
   ↓
2. Backend auto-reloads (if using `npm run dev`)
   ↓
3. Reload extension in chrome://extensions/
   ↓
4. Hard refresh Kalshi page (if content script changed)
   ↓
5. Test in extension popup
   ↓
6. Check logs:
   - Browser console (popup)
   - Page console (content script)
   - Terminal (backend)
```

## Deployment Architecture (Future)

```
┌────────────────┐
│  Chrome Store  │ ◄── Extension distribution
└────────────────┘

┌────────────────┐
│   Vercel/      │ ◄── Backend API
│   Railway      │
└────────┬───────┘
         │
         ▼
┌────────────────┐
│  Supabase/     │ ◄── PostgreSQL database
│  Neon          │
└────────────────┘

┌────────────────┐
│  Kalshi API    │ ◄── Market data source
└────────────────┘
```

## Error Handling

### Frontend Errors
- API connection failures → Alert + console log
- Invalid market pages → Display message
- Content script failures → Fallback to API only

### Backend Errors
- Database connection → 500 error + log
- Kalshi API failures → 404/500 + detailed error
- Invalid requests → 400 error + validation message

### Database Errors
- Connection failures → Retry with exponential backoff
- Query errors → Transaction rollback + log
- Constraint violations → Specific error messages


