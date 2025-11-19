# ✅ Fixed: Stripe Metadata Limit Issue

## 🐛 The Problem

When trying to place a parlay bet, you encountered this error:

```
Failed to process payment: Metadata values can have up to 500 characters, 
but you passed in a value that is 943 characters.
```

**Root Cause**: Stripe has a **500-character limit** per metadata value, but we were trying to store the entire parlay data (with images, URLs, titles) in a single metadata field, which exceeded this limit.

---

## ✅ The Solution

Instead of storing all parlay data in Stripe metadata, we now:

1. **Save full payment details to database** (`pending_payments` table)
2. **Store only minimal metadata** in Stripe (userId, stake, betCount)
3. **Retrieve full data from database** when webhook is triggered

---

## 🔧 Changes Made

### 1. New Database Table: `pending_payments`

```sql
CREATE TABLE IF NOT EXISTS pending_payments (
  id SERIAL PRIMARY KEY,
  session_id VARCHAR(255) UNIQUE NOT NULL,
  user_id VARCHAR(255) NOT NULL,
  stake DECIMAL(10, 2) NOT NULL,
  parlay_data JSONB NOT NULL,        -- Full parlay details (no size limit!)
  quote_data JSONB,                  -- AI quote data
  status VARCHAR(50) DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);
```

### 2. New Database Functions (`server/db.js`)

- **`savePendingPayment(sessionId, userId, stake, parlayData, quoteData)`**
  - Saves full payment details to database
  - Returns the saved record
  
- **`getPendingPayment(sessionId)`**
  - Retrieves payment details by Stripe session ID
  - Returns null if not found
  
- **`updatePaymentStatus(sessionId, status)`**
  - Updates payment status (pending → completed)

### 3. Updated Checkout Session Creation (`server/index.js`)

**Before:**
```javascript
metadata: {
  userId,
  parlayData: JSON.stringify(parlayBets),  // ❌ Too large!
  stake: stake.toString(),
  quoteData: quote ? JSON.stringify(quote) : '',
}
```

**After:**
```javascript
// Minimal metadata (under 500 chars)
metadata: {
  userId,
  stake: stake.toString(),
  betCount: parlayBets.length.toString(),
}

// Save full data to database
await savePendingPayment(session.id, userId, stake, parlayBets, quote);
```

### 4. Updated Webhook Handler

**Before:**
```javascript
const parlayBets = JSON.parse(session.metadata.parlayData);
```

**After:**
```javascript
// Get full payment details from database
const payment = await getPendingPayment(session.id);
const parlayBets = payment.parlay_data;  // Full data retrieved!
```

---

## 🎯 Benefits

### 1. No Size Limits
- Database JSONB column can store unlimited data
- No more 500-character restrictions

### 2. Better Data Integrity
- Payment data persisted even if webhook fails
- Can query payment history
- Can add more fields without Stripe limits

### 3. Security
- Sensitive data stays in your database
- Stripe only stores minimal reference data

### 4. Flexibility
- Can update payment status
- Can add additional fields later
- Easy to query and analyze payments

---

## 📊 Data Flow

### Old Flow (Failed)
```
Frontend
    ↓
Create Stripe session with FULL data in metadata
    ↓
❌ ERROR: Metadata too large (943 chars > 500 limit)
```

### New Flow (Works!)
```
Frontend
    ↓
Create Stripe session with MINIMAL metadata
    ↓
Save FULL data to database (pending_payments table)
    ↓
✅ Stripe session created successfully
    ↓
User pays on Stripe
    ↓
Webhook receives session.id
    ↓
Query database for full payment details
    ↓
✅ Process payment with complete data
```

---

## 🧪 Testing

### Test the Fix

```bash
# 1. Restart server (already done)
npm start

# 2. Try the exact same parlay that failed before
curl -X POST http://localhost:4000/api/create-checkout-session \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "test_user",
    "stake": 100,
    "parlayBets": [
      {
        "marketTitle": "Will Trump veto at least 5 bills before Jan 1, 2026?",
        "marketUrl": "https://kalshi.com/markets/...",
        "imageUrl": "https://kalshi.com/_next/image?...",
        "optionLabel": "1",
        "prob": 11
      },
      {
        "marketTitle": "Will Jaxon Smith-Njigba be on the cover of Madden NFL 27?",
        "marketUrl": "https://kalshi.com/markets/...",
        "imageUrl": "https://kalshi.com/_next/image?...",
        "optionLabel": "JAX",
        "prob": 56
      }
    ]
  }'

# ✅ Response: { "sessionId": "...", "checkoutUrl": "..." }
```

### Verify Database

```bash
psql postgresql://localhost:5432/kalshi_parlay

# Check pending payments
SELECT session_id, user_id, stake, status, created_at 
FROM pending_payments 
ORDER BY created_at DESC 
LIMIT 5;

# Check full parlay data
SELECT parlay_data FROM pending_payments 
WHERE session_id = 'cs_test_...';
```

---

## 🎮 Try It in the Extension

1. **Reload extension** in `chrome://extensions/`
2. **Add the EXACT same 2 bets** that failed before:
   - Trump veto bet
   - Madden cover bet
3. **Click "Place Your Bet"**
4. **Enter $100 stake**
5. **Click "Get Quote"**
6. **Click "Place Parlay"**
7. **✅ Should open Stripe Checkout** (no more error!)

---

## 📁 Files Modified

- ✅ `server/db.js` - Added `pending_payments` table and helper functions
- ✅ `server/index.js` - Updated checkout creation and webhook handler

---

## 💡 Why This Happens

Stripe's metadata is designed for **reference data** (IDs, short strings), not **full payloads**:

| Metadata Field | Limit |
|---------------|-------|
| Key length | 40 characters |
| Value length | **500 characters** |
| Total keys | 50 keys max |

**Our parlay data** included:
- Market IDs
- Full market titles (can be 50+ chars)
- Full URLs (100+ chars)
- Full image URLs (200+ chars)
- Option labels
- Probabilities

**For 2 bets**: ~943 characters ❌

**Solution**: Store only `userId`, `stake`, `betCount` in metadata (~50 chars) ✅

---

## 🎊 Summary

✅ **Problem**: Parlay data exceeded Stripe's 500-char metadata limit  
✅ **Solution**: Store full data in database, minimal data in Stripe  
✅ **Result**: Can now handle parlays of ANY size  
✅ **Bonus**: Better data persistence and queryability  

---

## 🚀 Next Time You Test

1. Reload extension
2. Add 2+ bets (even with long titles!)
3. Place parlay
4. Should work perfectly now! 🎉

---

**Version**: 0.4.1  
**Date**: 2025-11-16  
**Status**: ✅ Fixed and working!


