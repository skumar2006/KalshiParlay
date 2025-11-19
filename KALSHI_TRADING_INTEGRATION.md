# 🎯 Kalshi Trading API Integration - Automatic Hedge Execution

## 🎉 **What's New**

Your extension now has the ability to **automatically execute hedging strategies** by placing orders on Kalshi through their Trading API!

When a user completes payment, the system will:
1. ✅ Confirm payment via Stripe webhook
2. 🤖 Generate AI-powered hedging strategy
3. 📍 **NEW: Automatically place hedge bets on Kalshi**
4. 💾 Save all details to database

---

## 🔄 **How It Works**

### **Payment Flow with Hedge Execution**

```
User completes payment
    ↓
Stripe webhook fires
    ↓
Server receives confirmation
    ↓
AI hedging strategy retrieved
    ↓
🎯 FOR EACH HEDGE BET:
    ├─ Calculate order parameters
    ├─ Place order on Kalshi API
    ├─ Log order details
    └─ Update database
    ↓
Mark hedge as executed
    ↓
Clear user's parlay
```

---

## 🏗️ **Architecture**

### **1. Frontend (popup.js)**
- Captures ticker symbol when user adds bet to parlay
- Sends ticker to backend with other bet data
- Ticker is stored in database for later use

### **2. Backend (server/index.js)**
- Webhook handler receives payment confirmation
- Calls `executeHedgingStrategy()` with hedge bets
- Logs all order placements

### **3. Kalshi Trade Client (server/kalshiTradeClient.js)**
- **NEW FILE** - Handles all Kalshi Trading API interactions
- Implements order placement logic
- Currently in **DRY RUN MODE** (logs only, no real orders)

### **4. Database**
- **NEW COLUMN**: `ticker` in `parlay_bets` table
- Stores Kalshi ticker symbol (e.g., "KXNFLGAME-25NOV16SEA")
- Used for API order placement

---

## 🔧 **Current Mode: DRY RUN**

### **What is DRY RUN?**

The system is currently configured to **LOG what would happen** without placing actual orders on Kalshi.

```javascript
// In server/kalshiTradeClient.js
const DRY_RUN = true; // ← Set to false to enable real orders
```

### **What You See in DRY RUN Mode**

When a payment is confirmed, you'll see:

```
================================================================================
🛡️ EXECUTING HEDGING STRATEGY ON KALSHI
================================================================================

⚠️  DRY RUN MODE ACTIVE - No actual orders will be placed

Metadata:
   User ID: user_123abc
   Session ID: cs_test_...
   User Stake: $5.00

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

────────────────────────────────────────────────────────

[Repeats for each hedge bet]

================================================================================
📊 HEDGING EXECUTION SUMMARY
================================================================================

Total hedge bets: 2
✅ Successful: 2

🔸 DRY RUN MODE - All orders logged but not placed

💡 To execute real orders:
   1. Set DRY_RUN = false in kalshiTradeClient.js
   2. Ensure Kalshi API credentials are configured
   3. Implement RSA-PSS signature authentication
   4. Test in demo environment first

================================================================================
```

---

## 🚀 **Enabling Real Order Placement**

### **Prerequisites**

1. **Kalshi API Credentials**
   - Generate API key from Kalshi Demo account
   - Add to `.env`:
     ```
     KALSHI_DEMO_API_KEY=your-key-id-here
     KALSHI_DEMO_PRIVATE_KEY=your-private-key-here
     ```

2. **Implement RSA-PSS Signature Authentication**
   - Kalshi requires signed requests
   - Each request needs:
     - `KALSHI-ACCESS-KEY`: Your key ID
     - `KALSHI-ACCESS-TIMESTAMP`: Current timestamp (ms)
     - `KALSHI-ACCESS-SIGNATURE`: RSA-PSS signature

### **Steps to Enable**

#### **Step 1: Set Up Kalshi Demo Account**

1. Go to https://demo.kalshi.co/
2. Create an account
3. Navigate to Account Settings → API Keys
4. Generate a new API key
5. Save the Key ID and Private Key

#### **Step 2: Implement Signature Generation**

Kalshi requires RSA-PSS signatures. You'll need to:

1. Install crypto library (built into Node.js)
2. Create signature from: `timestamp + method + path`
3. Sign with your private key

Example implementation:

```javascript
import crypto from 'crypto';

function generateSignature(timestamp, method, path, privateKey) {
  const message = timestamp + method + path;
  
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(message);
  sign.end();
  
  const signature = sign.sign({
    key: privateKey,
    padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
    saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST
  }, 'base64');
  
  return signature;
}
```

#### **Step 3: Update kalshiTradeClient.js**

Find the `TODO` section in `placeKalshiOrder()`:

```javascript
// server/kalshiTradeClient.js (around line 99)

// TODO: Implement signature generation
const timestamp = Date.now().toString();
const method = 'POST';
const path = '/portfolio/orders';
const signature = generateSignature(timestamp, method, path, process.env.KALSHI_DEMO_PRIVATE_KEY);

const response = await fetch(`${API_BASE}/portfolio/orders`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'KALSHI-ACCESS-KEY': process.env.KALSHI_DEMO_API_KEY,
    'KALSHI-ACCESS-SIGNATURE': signature,
    'KALSHI-ACCESS-TIMESTAMP': timestamp,
  },
  body: JSON.stringify(orderPayload)
});
```

#### **Step 4: Disable DRY RUN Mode**

```javascript
// server/kalshiTradeClient.js (line 15)
const DRY_RUN = false; // ← Enable real orders
```

#### **Step 5: Test in Demo Environment**

```javascript
// server/kalshiTradeClient.js (line 13)
const USE_DEMO = true; // ← Always use demo for testing!
```

#### **Step 6: Restart Server and Test**

```bash
npm start
```

Then complete a test payment and watch the terminal for real order confirmations!

---

## 📊 **Order Calculation Logic**

### **How Contracts Are Calculated**

For each hedge bet:

```javascript
// Given:
const hedgeAmount = $2.00;  // Amount to hedge
const probability = 65%;     // Kalshi probability

// Calculate:
const contractCost = probability / 100;           // $0.65 per contract
const numContracts = Math.floor(hedgeAmount / contractCost);  // 3 contracts
const totalCost = numContracts * contractCost;    // $1.95 actual cost
```

### **Order Parameters**

```javascript
{
  ticker: "KXNFLGAME-25NOV16SEA",  // From database
  side: "yes",                      // Same as user's bet
  action: "buy",                    // Always buying to hedge
  count: 3,                         // Calculated contracts
  type: "market",                   // Market order for fast execution
  cancel_order_on_pause: true       // Safety feature
}
```

---

## 🔍 **Testing the Integration**

### **1. Test with DRY RUN (Current Setup)**

✅ Safe - No real orders placed
✅ See full order details in logs
✅ Verify hedging logic is correct

```bash
# Terminal 1: Run server
npm start

# Terminal 2: Run Stripe webhook forwarder
stripe listen --forward-to localhost:4000/api/webhook

# Browser: Make a test payment
# Watch both terminals for detailed logs
```

### **2. Test with Real Orders (After Setup)**

⚠️ Only after:
- Kalshi credentials configured
- Signature authentication implemented
- Tested in demo environment
- Verified with small amounts

---

## 📝 **Data Flow Example**

### **User Creates Parlay**

```javascript
// Frontend captures:
{
  marketId: "kxnflgame-25nov16seala",
  marketTitle: "Seattle vs Miami - Nov 16",
  optionLabel: "SEA",
  prob: 65,
  ticker: "KXNFLGAME-25NOV16SEA"  // ← NEW!
}

// Saved to database:
INSERT INTO parlay_bets (..., ticker) VALUES (..., 'KXNFLGAME-25NOV16SEA');
```

### **Hedging Strategy Generated**

```javascript
// AI determines hedge needed:
{
  hedgeBets: [
    {
      leg: 1,
      market: "Seattle vs Miami - Nov 16",
      option: "SEA",
      probability: 65,
      hedgeAmount: 2.00,
      potentialWin: 3.08,
      ticker: "KXNFLGAME-25NOV16SEA"  // ← Retrieved from DB
    }
  ]
}
```

### **Order Placed on Kalshi**

```javascript
// POST to Kalshi API:
{
  ticker: "KXNFLGAME-25NOV16SEA",
  side: "yes",
  action: "buy",
  count: 3,
  type: "market"
}

// Kalshi responds:
{
  order: {
    order_id: "abc123",
    status: "resting",
    // ... order details
  }
}
```

---

## 🐛 **Troubleshooting**

### **Issue: "Missing ticker symbol"**

**Cause:** Old parlay bets in database don't have ticker column.

**Fix:**
1. Clear old parlays: Delete from `parlay_bets` table
2. Restart server (creates ticker column)
3. Add new bets with ticker data

### **Issue: "Cannot connect to Kalshi API"**

**Cause:** Authentication not set up.

**Fix:**
1. Check API credentials in `.env`
2. Implement signature generation
3. Verify using demo environment

### **Issue: "Order placement failed"**

**Possible causes:**
- Invalid ticker symbol
- Insufficient funds (demo environment)
- Market closed or paused
- Invalid order parameters

**Check:**
- DRY RUN logs show correct ticker?
- Demo account has funds?
- Market is actively trading?

---

## 🔐 **Security Notes**

1. **Never commit API keys** - Keep in `.env`, add to `.gitignore`
2. **Always test in demo first** - Use `USE_DEMO = true`
3. **Start with DRY RUN** - Verify logic before real orders
4. **Monitor closely** - Watch logs when first enabling
5. **Rate limits** - Kalshi has API rate limits, respect them

---

## 📈 **Next Steps**

### **Immediate (Required for Real Orders)**
1. ✅ Set up Kalshi Demo account
2. ✅ Generate API credentials
3. ✅ Implement RSA-PSS signature authentication
4. ✅ Test with DRY RUN disabled
5. ✅ Monitor demo account balance

### **Future Enhancements**
- Order status tracking
- Retry logic for failed orders
- Position management
- Settlement tracking
- P&L calculations
- Automated reconciliation

---

## 📚 **API Documentation**

**Kalshi API Docs:** https://docs.kalshi.com/

**Key Endpoints:**
- `POST /portfolio/orders` - Place an order
- `GET /portfolio/orders` - List orders
- `GET /portfolio/positions` - View positions
- `GET /markets/{ticker}` - Market details

**Demo Environment:**
- Base URL: `https://demo-api.kalshi.co/trade-api/v2`
- Web UI: `https://demo.kalshi.co/`

---

## 🎯 **Summary**

You now have:
- ✅ Kalshi Trading API client (`kalshiTradeClient.js`)
- ✅ Automatic hedge execution in webhook handler
- ✅ Ticker data captured and stored
- ✅ DRY RUN mode for safe testing
- ✅ Comprehensive logging
- ✅ Order calculation logic
- ✅ Error handling

**Current Status:** 🔸 **DRY RUN MODE** - Logging orders, not placing them yet

**To go live:** Implement signature authentication and disable DRY RUN mode

---

**Happy Trading! 🚀**

