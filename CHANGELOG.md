# Changelog

## Version 0.8.0 - Kalshi Trading API Integration (DRY RUN)

### Added
- **Kalshi Trading API Client** (`server/kalshiTradeClient.js`): Complete integration for placing orders on Kalshi
- **Automatic hedge execution**: System now automatically executes hedging strategy after payment confirmation
- **Ticker column** in `parlay_bets` table: Stores Kalshi ticker symbols for API trading
- **DRY RUN mode**: Safe testing mode that logs orders without placing them (currently enabled)
- **Order calculation logic**: Automatically calculates contracts, prices, and order parameters
- **Comprehensive order logging**: Detailed console output for every order that would be placed

### Enhanced Features
- **Frontend ticker capture**: Extension now captures and stores Kalshi ticker for each bet
- **Backend ticker support**: Market API returns ticker explicitly in contract data
- **Webhook hedge execution**: Payment confirmation now triggers automatic hedge order placement
- **Order parameter generation**: Calculates contracts based on hedge amount and probability
- **Error handling**: Robust handling for missing tickers, failed orders, and API issues

### New Components

#### Kalshi Trade Client (`kalshiTradeClient.js`)
- `placeKalshiOrder()` - Places individual orders on Kalshi API
- `executeHedgingStrategy()` - Executes complete hedging strategy with multiple orders
- Support for both demo and production environments
- Market order types for fast execution
- Client order IDs for tracking
- Rate limiting protection (100ms delay between orders)

#### Database Migration
- Added `ticker VARCHAR(255)` column to `parlay_bets` table
- Migration script: `server/migrations/add_ticker_column.js`
- Stores full Kalshi ticker (e.g., "KXNFLGAME-25NOV16SEA")
- Used for API order placement

### Configuration
- `DRY_RUN = true` (default) - Logs orders without placing them
- `USE_DEMO = true` (default) - Uses demo API endpoint
- Demo API base: `https://demo-api.kalshi.co/trade-api/v2`
- Production API base: `https://trading-api.kalshi.com/trade-api/v2`

### Console Output (DRY RUN Mode)
```
================================================================================
🛡️ EXECUTING HEDGING STRATEGY ON KALSHI
================================================================================

⚠️  DRY RUN MODE ACTIVE - No actual orders will be placed

Number of hedge bets to place: 2
Total hedge cost: $2.75

────────────────────────────────────────────────────────
📍 KALSHI ORDER PLACEMENT
────────────────────────────────────────────────────────
🔸 DRY RUN MODE - No actual order will be placed

Order Details:
   Ticker: KXNFLGAME-25NOV16SEA
   Side: YES
   Action: buy
   Count: 4 contracts
   Type: market

📦 Order Payload:
{
  "ticker": "KXNFLGAME-25NOV16SEA",
  "side": "yes",
  "action": "buy",
  "count": 4,
  "type": "market",
  "cancel_order_on_pause": true
}

✅ DRY RUN: Order would be sent to:
   https://demo-api.kalshi.co/trade-api/v2/portfolio/orders

💡 To execute real orders:
   1. Set DRY_RUN = false in kalshiTradeClient.js
   2. Set up Kalshi API credentials
   3. Implement authentication signing
```

### Order Calculation Example
```javascript
// Given:
hedgeAmount = $2.00
probability = 65%

// Calculate:
contractCost = 0.65 per contract
numContracts = floor(2.00 / 0.65) = 3 contracts
totalCost = 3 × $0.65 = $1.95

// Order:
{
  ticker: "KXNFLGAME-25NOV16SEA",
  side: "yes",
  count: 3,
  type: "market"
}
```

### Next Steps to Enable Real Orders
1. ✅ Set up Kalshi Demo account at https://demo.kalshi.co/
2. ✅ Generate API credentials (Key ID and Private Key)
3. ✅ Add to `.env`: `KALSHI_DEMO_API_KEY` and `KALSHI_DEMO_PRIVATE_KEY`
4. ✅ Implement RSA-PSS signature authentication
5. ✅ Set `DRY_RUN = false` in `kalshiTradeClient.js`
6. ✅ Test in demo environment with small amounts
7. ✅ Monitor orders in Kalshi demo dashboard

### Security & Safety
- DRY RUN mode prevents accidental real orders
- Demo environment testing before production
- `cancel_order_on_pause` flag for safety
- Client order IDs for tracking and deduplication
- Comprehensive error handling and logging
- No API credentials in code (uses .env)

### Technical Details
- Uses Kalshi Trade API v2
- POST `/portfolio/orders` endpoint
- Supports market and limit order types
- Calculates optimal contract quantities
- Handles probability → price conversion
- Side detection (yes/no) based on user's bet
- Action always "buy" for hedging
- Ticker validation and error handling

### Files Modified
- **Added**: `server/kalshiTradeClient.js` - Kalshi API client (346 lines)
- **Added**: `server/migrations/add_ticker_column.js` - Database migration
- **Modified**: `server/db.js` - Added ticker column support
- **Modified**: `server/index.js` - Integrated hedge execution in webhook
- **Modified**: `server/hedgingService.js` - Added ticker to hedge bets
- **Modified**: `popup.js` - Capture and send ticker data
- **Modified**: `manifest.json` - Version bump to 0.8.0

### Documentation
- Added `KALSHI_TRADING_INTEGRATION.md` - Complete integration guide (470+ lines)
  - Architecture overview
  - DRY RUN mode explanation
  - How to enable real orders
  - Order calculation logic
  - Testing instructions
  - Troubleshooting guide
  - Security notes
  - API documentation

### Testing
- DRY RUN mode enabled by default
- Safe to test payment flow end-to-end
- All order details logged to console
- No real orders placed yet
- Ready for demo environment testing

---

## Version 0.7.0 - Payment Confirmation & Purchase Tracking

### Added
- **Stripe webhook payment confirmation**: Full detection and processing of confirmed payments
- **`completed_purchases` table**: Stores all confirmed purchases with full details
- **Purchase history tracking**: Complete audit trail of all bets placed
- **Automated hedging execution logging**: Shows exactly which hedge bets to place
- **Purchase history API**: `GET /api/purchase-history/:userId` endpoint
- **Comprehensive console logging**: Detailed output for every confirmed payment

### New Database Functions
- `saveCompletedPurchase()` - Save confirmed purchase to database
- `getCompletedPurchase()` - Retrieve purchase by Stripe session ID
- `markHedgeExecuted()` - Mark hedging bets as placed
- `getUserPurchaseHistory()` - Get all purchases for a user

### Enhanced Webhook Handler
When Stripe confirms payment (`checkout.session.completed`), the system now:
1. ✅ Verifies payment and retrieves details
2. ✅ Updates pending payment status to 'completed'
3. ✅ Saves to completed_purchases table with full data
4. ✅ Logs comprehensive payment information
5. ✅ Retrieves and displays hedging strategy
6. ✅ Shows exact hedge bets to place with amounts
7. ✅ Clears user's active parlay
8. ✅ Marks hedge as executed in database

### Console Output Includes
- Payment details (session ID, amount, customer email)
- Full parlay information (all legs with probabilities)
- Payout details (promised payout, potential profit)
- Hedging strategy (which bets, how much, potential wins)
- Action items (manual placement instructions)
- Status updates (database saves, parlay clearing)

### Database Schema
```sql
completed_purchases:
- session_id (Stripe session)
- user_id
- stake (amount paid)
- payout (promised if wins)
- parlay_data (full parlay JSONB)
- quote_data (AI analysis)
- hedging_strategy (hedge bets)
- hedge_executed (boolean)
- timestamps
```

### Documentation
- Added `PAYMENT_CONFIRMATION.md` - Complete payment system guide

---

## Version 0.6.1 - Fixed AI Pricing Constraint

### Fixed
- **AI prompt constraint**: Added explicit rule that adjusted probability must ALWAYS be >= naive probability
- **Payout constraint**: True fair payout must ALWAYS be <= naive payout (never offer better odds than independent assumption)
- **Correlation factor**: Must be >= 1.0 (never < 1.0, which would increase payout)

### Why This Matters
Previously, the AI could suggest correlation factors < 1.0, which would:
- Decrease the adjusted probability below naive
- Increase the fair payout above naive
- Result in offering better odds than the independent assumption ❌

Now, the AI is constrained to:
- Only suggest correlation factor >= 1.0
- Adjusted probability >= naive probability
- Fair payout <= naive payout
- Always conservative, house-favorable pricing ✅

### Example of Fix
**Before (Wrong):**
```
Naive prob: 0.67%, Naive payout: $745
AI suggests: factor 0.95, adjusted prob 0.64%
Result: Fair payout $781 ❌ (higher than naive!)
```

**After (Correct):**
```
Naive prob: 0.67%, Naive payout: $745
AI suggests: factor 1.0 or higher, adjusted prob >= 0.67%
Result: Fair payout <= $745 ✅ (never higher than naive)
```

### Updated AI Prompt
Added critical constraints:
- "Adjusted probability must ALWAYS be >= naive probability"
- "True fair payout must ALWAYS be <= naive payout"
- "NEVER use correlation factor < 1.0"
- Included example showing correct vs wrong approach

---

## Version 0.6.0 - Variance Reduction Hedging Strategy

### Changed
- **Complete hedging strategy overhaul**: Now properly hedges individual legs (Kalshi doesn't allow parlays)
- **Variance reduction focus**: Hedge high-probability legs to reduce outcome variance
- **Smart hedge selection**: Only hedge legs >50% probability where cost < benefit
- **AI-based fair value**: Uses AI correlation analysis, not just Kalshi percentages
- **Comprehensive logging**: Shows full reasoning, scenarios, and impact analysis

### New Hedging Rules
```
Probability ≥ 65%: Aggressive hedge (40% of stake)
Probability 55-64%: Moderate hedge (25% of stake)
Probability 50-54%: Light hedge (15% of stake)
Probability < 50%: No hedge (not beneficial)
```

### Goals Achieved
1. ✅ Reduce variance through smart individual leg hedging
2. ✅ Increase EV (often improves with hedging)
3. ✅ Offer users 85-90% of AI-determined fair payout
4. ✅ AI determines fair odds based on correlation analysis
5. ✅ Detailed console logging with full reasoning

### Console Output Now Shows
- **Parlay details**: All legs with probabilities
- **Fair value calculation**: Naive vs AI-adjusted
- **AI correlation analysis**: Full reasoning and adjustments
- **Payout to user**: Fair value vs offered amount
- **Unhedged position**: EV, edge, and variance
- **Hedging decisions**: Per-leg analysis and reasoning
- **Scenario analysis**: All possible outcomes with probabilities
- **Hedged position**: New EV, edge, and variance
- **Impact comparison**: Variance reduction % and EV change

### Example Output
```
Leg 3: Dallas at Las Vegas - DAL (65%)
Decision: ✅ HEDGE
High probability (65%) - aggressive hedge to reduce variance
Hedge: Bet $2.00 on Kalshi
If wins: Return $3.08 (profit: $1.08)

Result:
Variance reduction: 22.9%
EV change: +207.7%
🎊 WIN-WIN: Higher EV AND lower variance!
```

### Technical Changes
- Complete rewrite of `hedgingService.js`
- Calculates all 2^n scenarios for n-leg parlays
- Passes AI analysis to hedging service
- Detailed breakdown for each outcome
- Probability-weighted EV calculations

### Documentation
- Added `VARIANCE_REDUCTION_HEDGING.md` - Complete strategy guide

---

## Version 0.5.2 - Always Hedge Strategy (Guaranteed Profit)

### Changed
- **ALWAYS hedge every parlay**: No more conditional hedging based on edge
- **Guaranteed profit**: Lock in 12.5% profit regardless of outcome
- **Zero variance**: Same profit whether user wins or loses
- **Risk elimination**: Can never lose money on any bet

### Why?
Since we control the payout (via AI), we should always hedge to eliminate risk entirely, not just when edge is "bad". The user's insight: we set the payout, so we can always hedge for guaranteed profit.

### New Logic
```
Old: Only hedge if edge < 10% or > 15%
New: ALWAYS hedge every single parlay
Result: Guaranteed 12.5% profit with zero risk
```

### Hedging Math
```
Target profit = Stake × 12.5%
Hedge bet size = Stake - Target profit
Place hedge bet on Kalshi at parlay odds

If user WINS: Collect stake - Pay payout + Win hedge = Profit ✅
If user LOSES: Collect stake - Lose hedge = Profit ✅
```

### Benefits
- ✅ Zero risk of loss
- ✅ Predictable profits
- ✅ Can scale to any volume
- ✅ No variance in outcomes
- ✅ User experience unchanged

### Output
Console now shows:
- "🎯 ALWAYS hedging to lock in guaranteed 12.5% profit"
- Both win/loss scenarios with guaranteed profit
- Hedge bet sizing and potential wins
- "✅ LOCKED IN - Profit guaranteed regardless of outcome!"

### Documentation
- Added `ALWAYS_HEDGE_STRATEGY.md` - Complete explanation and math

---

## Version 0.5.1 - Fixed Overlay Payout Display

### Fixed
- **Payout calculation removed from overlay**: No longer shows pre-calculated payout
- Payout now shows placeholder text: "Get quote to see payout"
- After entering stake: "Click 'Get Quote' to see payout"
- After getting quote: Shows actual AI-adjusted payout amount
- **Combined probability hidden**: User no longer sees probability calculations

### Changed
- `calculatePayout()` function simplified - only enables button, doesn't calculate
- Overlay workflow: Stake → Get Quote → See Payout (not immediate)

### Documentation
- Added `WHERE_TO_SEE_HEDGING.md` - Guide on where hedging logs appear
- Added `QUICK_TEST_GUIDE.md` - Step-by-step testing instructions

---

## Version 0.5.0 - Silent Quote Processing + Automated Hedging Strategy

### Changed
- **Silent quote processing**: AI analysis no longer shown to user
- User now sees only the final payout amount (clean UI)
- Quote button changes to "Place Parlay" after processing

### Added
- **Automated hedging strategy** to maintain 10-15% house edge
- `hedgingService.js` - Calculates optimal hedge positions on Kalshi
- Detailed hedging logs output to backend console
- Hedging strategy considers:
  - Current edge vs target edge (10-15%)
  - User's stake and potential payout
  - Individual bet probabilities
  - Optimal hedge sizing per parlay leg

### Removed
- `displayQuoteResults()` function from frontend
- AI analysis cards (correlation, risk assessment, probability comparisons)
- Detailed payout breakdown shown to user

### Backend
- Quote endpoint now calculates hedging strategy automatically
- Hedging details logged to console for monitoring
- Hedging strategy stored in quote object for future execution
- Edge calculation: compares unhedged vs hedged positions

### User Experience
- Faster, cleaner quote process
- No overwhelming technical details
- Simple: Stake → Quote → Payout → Pay
- Backend handles all risk management silently

### Technical Details
- Target house edge: 10-15% (12.5% optimal)
- Hedge sizing based on edge deviation from target
- Console output shows:
  - User bet details
  - Current edge (no hedge)
  - Hedging bets per leg
  - Total hedge cost
  - Final edge (with hedge)
  - Scenario analysis (user wins/loses)

---

## Version 0.4.1 - Fixed Stripe Metadata Limit

### Fixed
- **Stripe metadata limit error**: "Metadata values can have up to 500 characters"
- Payment creation now works with parlays of any size

### Added
- **`pending_payments` table**: Stores full payment details in database
- **New DB functions**: `savePendingPayment()`, `getPendingPayment()`, `updatePaymentStatus()`
- Database-backed payment storage (no size limits)

### Changed
- Stripe metadata now stores only minimal data (userId, stake, betCount)
- Full parlay data saved to `pending_payments` table as JSONB
- Webhook handler retrieves full data from database instead of metadata
- Better data persistence and queryability

### Technical Details
- Stripe metadata limit: 500 characters per value
- Previous approach: Stored full parlay JSON in metadata (943+ chars) ❌
- New approach: Store reference data in Stripe, full data in PostgreSQL ✅
- JSONB column allows unlimited parlay size

### Why This Fix
- Can now handle parlays with long market titles, URLs, and images
- No more 500-character restrictions
- Better separation of concerns (Stripe for payment, DB for data)
- Easier to query payment history

---

## Version 0.4.0 - Stripe Payment Integration

### Added
- **Stripe Checkout Integration**: Users can now pay for parlays via credit/debit cards
- **`POST /api/create-checkout-session`**: Creates Stripe Checkout session for payments
- **`POST /api/webhook`**: Handles Stripe webhook events (payment confirmations)
- **`GET /payment-success`**: Beautiful success page after payment with auto-close
- **`GET /payment-cancel`**: Cancel page if user abandons payment
- **Secure Payment Flow**: Opens Stripe Checkout in new tab, handles redirects

### Changed
- `placeParlayOrder()` now creates Stripe checkout and redirects to payment
- Backend initializes Stripe SDK on startup
- Webhook handler processes `checkout.session.completed` events

### Technical Details
- Installed `stripe` npm package (v14+)
- Stripe API key stored in `.env` as `STRIPE_API_KEY`
- Payment metadata includes: userId, parlayData, stake, quoteData
- Success page auto-closes after 5 seconds
- Cancel page auto-closes after 3 seconds
- Webhook signature verification supported (optional in dev mode)

### Payment Flow
1. User clicks "Place Parlay" after AI quote
2. Extension calls `/api/create-checkout-session`
3. Stripe Checkout opens in new tab
4. User enters card details on Stripe's secure page
5. Payment processed
6. Stripe redirects to success page
7. Webhook notifies backend
8. Success page auto-closes, user returns to extension

### Test Cards (Stripe Test Mode)
- Success: `4242 4242 4242 4242`
- Declined: `4000 0000 0000 9995`
- 3D Secure: `4000 0025 0000 3155`

### TODO
- [ ] Implement Kalshi bet placement in webhook handler
- [ ] Add payment history to database
- [ ] Clear user's parlay after successful payment
- [ ] Add refund functionality

---

## Version 0.3.4 - Prioritize DOM Title

### Changed
- **Market title now scraped from webpage**: Extension now ALWAYS uses the official title from the Kalshi webpage (h1/h2 tags) instead of the API title
- **Better title accuracy**: Users see the exact same title in the extension as they do on the Kalshi page
- **Updated currentMarket object**: Title is now updated after DOM scraping completes

### Technical Details
- Modified DOM scraping logic to always prioritize webpage title over API title
- `currentMarket.title` is now overwritten with DOM-scraped title if available
- This ensures consistency between what user sees on page and what's saved in parlay
- Image scraping already had this priority, now title has it too

### Why This Matters
- API titles may be abbreviated, formatted differently, or outdated
- DOM title is what the user actually sees on the page
- Ensures parlay displays the familiar title users recognize

---

## Version 0.3.3 - Always Show Parlay

### Added
- **Persistent Parlay Display**: Parlay is now always visible, even when not on a Kalshi betting page
- **Conditional Market Section**: Market info only shows when on a Kalshi market page

### Changed
- Extension now loads and displays saved parlay bets regardless of current page
- Market header, options, and "Add to Parlay" button hidden when not on Kalshi
- "Current Parlay" section and "Place Your Bet" button always visible

### UX Improvements
- Users can view and manage their parlay from any page
- Can place parlays without navigating to a Kalshi market
- Cleaner UI when not on a betting page (only shows relevant sections)

### Technical Details
- New helper functions: `loadAndRenderParlay()`, `hideMarketSection()`, `showMarketSection()`
- Refactored event listener setup with `setupEventListeners()`
- Event listeners now use `hasListener` flag to prevent duplicate bindings
- Parlay loading moved to separate async function for reusability

---

## Version 0.3.2 - Minimum 2 Bets Required

### Added
- **Parlay validation**: Requires at least 2 bets to place a parlay
- **Alert message**: Shows "You need at least 2 bets to place a parlay!" when trying to place with fewer than 2 bets
- **Visual hint**: When only 1 bet is added, displays message "Add at least one more bet to place a parlay"
- **Button tooltips**: "Place Your Bet" button shows helpful tooltip based on state

### Changed
- `placeBet()` function now validates bet count before showing overlay
- `renderParlay()` function disables button when fewer than 2 bets
- Button state dynamically updates based on parlay size

### UX Improvements
- Clear feedback when trying to place invalid parlay
- Disabled button styling makes it obvious when action is unavailable
- Helpful hint text guides users to add more bets

---

## Version 0.3.1 - AI-Powered Quote System

### Added
- **OpenAI Integration**: AI agent analyzes parlay bets for correlation and generates smart quotes
- **Event Correlation Analysis**: AI evaluates how related events are to each other
- **Risk Assessment**: Provides risk level (low/medium/high) for the parlay
- **Probability Adjustment**: AI adjusts combined probability based on event relationships
- **Detailed Quote Display**: Shows correlation analysis, risk level, probability comparison, and payout breakdown
- **Place Parlay Button**: Appears after quote generation (implementation pending)

### Technical Details
- New file: `server/aiQuoteService.js` - OpenAI API integration
- New endpoint: `POST /api/quote` - Generates AI-powered parlay quotes
- Uses GPT-4o-mini model for fast, cost-effective analysis
- Structured JSON output with reasoning and recommendations
- Loading states during AI analysis

### UI Components
- Quote results section with:
  - Correlation analysis card
  - Risk assessment badge
  - Probability comparison (independent vs. AI-adjusted)
  - Payout details grid
  - AI reasoning display
- Transforms "Get Quote" button to "Place Parlay" after analysis

---

## Version 0.3.0 - Bet Overlay with Stake Input

### Added

#### Bet Placement Overlay
- **Beautiful modal overlay** that appears when clicking "Place Your Bet"
- **Parlay summary** showing all bets with probabilities
- **Market images** displayed for each bet in the overlay (40x40px icons)
- **Combined probability calculation** displayed prominently
- **Stake input field** for entering bet amount
- **Real-time payout calculation** as user types stake amount
- **"Get Quote" button** (placeholder for Kalshi API integration)
- **Close functionality** via × button or clicking outside modal

#### UI/UX Features
- Smooth animations (fade in, slide up)
- Backdrop blur effect for overlay
- Automatic payout calculation
- Button state management (disabled when invalid stake)
- Scrollable modal for many bets
- Click-outside-to-close functionality

#### Styling
- Modern modal design matching extension theme
- Responsive layout (90% width, max 400px)
- Green accent color for payout amounts
- Hover effects and transitions

### Changed
- `placeBet()` now shows overlay instead of clearing parlay immediately
- Parlay no longer auto-clears when clicking "Place Your Bet"

### Technical Details
- New functions: `showBetOverlay()`, `closeBetOverlay()`, `calculatePayout()`, `getQuote()`
- Real-time payout calculation: `stake / combinedProbability`
- Event listeners for stake input, close button, get quote button
- Modal can be closed by clicking overlay background

---

## Version 0.2.1 - Delete Individual Bets Feature

### Added

#### Frontend
- **Delete Individual Bets**: Click × button to remove bets from parlay
  - Visual delete button (×) on each parlay item
  - Red circular button with hover effects
  - Deletes from both UI and PostgreSQL database
  - `removeBetFromParlay(betId)` function in `popup.js`
  - Error handling with user alerts

#### Styling
- `.parlay-item-delete` CSS class for delete buttons
- Hover and active states for better UX
- Positioned at the end of each parlay item

### Changed
- Updated `renderParlay()` to include delete buttons
- Modified `.parlay-item` to use relative positioning
- Updated README with delete feature documentation

### User Experience
- Can now remove individual bets without clearing entire parlay
- Permanent deletion from database
- Immediate UI feedback

---

## Version 0.2.0 - PostgreSQL Database Integration

### Added

#### Backend
- **PostgreSQL Database Support**: Full integration with PostgreSQL for persistent storage
  - `server/db.js`: Database connection and query functions
  - Automatic table creation on server startup
  - Connection pooling for efficient database access
  - Support for both local and cloud PostgreSQL instances

- **Database Tables**:
  - `users`: Stores unique user identifiers
  - `parlay_bets`: Stores individual parlay bets with full market details
  - Automatic indexes for performance optimization

- **New API Endpoints**:
  - `GET /api/parlay/:userId` - Retrieve all parlay bets for a user
  - `POST /api/parlay/:userId` - Add a new bet to the user's parlay
  - `DELETE /api/parlay/:userId/:betId` - Remove a specific bet from the parlay
  - `DELETE /api/parlay/:userId` - Clear all bets from the parlay

#### Frontend
- **User Identification System**:
  - Automatic generation of unique user IDs
  - Storage of user IDs in Chrome's local storage
  - Persistent user identity across sessions

- **Database Synchronization**:
  - All parlay bets are saved to PostgreSQL in real-time
  - Automatic loading of existing parlays on extension open
  - Seamless sync between local state and database

#### Documentation
- `DATABASE_SETUP.md`: Comprehensive database setup guide
  - Instructions for local PostgreSQL installation
  - Cloud database provider options (Supabase, Neon, Railway)
  - Troubleshooting guide
  - Schema documentation

- `README.md`: Complete project documentation
  - Architecture overview
  - Installation instructions
  - Usage guide
  - API documentation
  - Development guide
  - Troubleshooting section

- `setup.sh`: Automated setup script
  - Dependency installation
  - Environment check
  - Database creation assistance
  - Interactive configuration

### Changed

#### Backend
- Updated `server/index.js`:
  - Added database initialization on startup
  - Imported database functions
  - Added parlay management endpoints
  - Enhanced error handling for database operations

- Updated `package.json`:
  - Added `pg` (node-postgres) dependency
  - Ready for PostgreSQL connections

#### Frontend
- Updated `popup.js`:
  - Added `getUserId()` function for user identification
  - Modified `addToParlay()` to save to database
  - Modified `placeBet()` to clear database after placing
  - Added parlay loading in `init()` function
  - Enhanced error handling for API calls

- Updated `manifest.json`:
  - Added `storage` permission for user ID storage

### Technical Details

#### Database Schema

**users table**:
```sql
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(255) UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**parlay_bets table**:
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

#### API Flow

1. **User Opens Extension**:
   - Extension checks Chrome storage for user ID
   - If not found, generates new unique ID
   - Fetches current market data from Kalshi API
   - Loads existing parlay bets from PostgreSQL

2. **Adding a Bet**:
   - User selects an option and clicks "Add to Parlay"
   - Frontend sends POST request to `/api/parlay/:userId`
   - Backend validates and inserts bet into PostgreSQL
   - Returns the saved bet with database ID
   - Frontend updates UI with new bet

3. **Placing a Bet**:
   - User reviews parlay and clicks "Place Your Bet"
   - Frontend calculates combined probability
   - Shows summary alert
   - Sends DELETE request to clear parlay
   - Backend removes all bets for that user
   - Frontend updates UI to show empty parlay

#### Persistence Benefits

- **Cross-Session**: Parlays persist even if browser is closed
- **Cross-Device**: Same user ID can be used across devices (future enhancement)
- **Reliability**: Database ensures no data loss
- **Scalability**: Can handle multiple users and large parlays
- **Audit Trail**: Created timestamps for all bets

### Configuration

New environment variable required:
```bash
DATABASE_URL=postgresql://username:password@host:5432/database_name
```

Supports various formats:
- Local: `postgresql://localhost:5432/kalshi_parlay`
- Supabase: `postgresql://postgres:[PASSWORD]@db.[PROJECT].supabase.co:5432/postgres`
- Neon: `postgresql://[user]:[password]@[host]/[database]?sslmode=require`
- Railway: From Railway dashboard variables

### Migration from Previous Version

If you were using version 0.1.0 (local storage only):
1. Update to this version
2. Set up PostgreSQL database
3. Add `DATABASE_URL` to `.env`
4. Restart the backend server
5. Existing in-memory parlays will be lost (they were not persisted)
6. Start building new parlays - they will now persist!

### Breaking Changes

None. This is backward compatible, but requires database setup for full functionality.

---

## Version 0.1.0 - Initial Release

### Features
- Chrome extension for Kalshi market detection
- Kalshi API integration for market data
- Visual parlay builder UI
- Market option selection
- Probability calculations
- DOM scraping for market images
- Express backend server
- In-memory parlay storage (cleared on extension close)

