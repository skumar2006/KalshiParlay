# 💳 Stripe Payment Integration

## 🎉 Overview

Your Kalshi Parlay extension now accepts payments via **Stripe Checkout**! Users can pay for their parlay bets using credit/debit cards in a secure, hosted payment flow.

---

## ✅ What's Implemented

### Backend (`server/index.js`)

1. **Stripe SDK Initialization**
   ```javascript
   import Stripe from 'stripe';
   const stripe = new Stripe(process.env.STRIPE_API_KEY);
   ```

2. **`POST /api/create-checkout-session`**
   - Creates a Stripe Checkout session
   - Accepts: `userId`, `stake`, `parlayBets`, `quote`
   - Returns: `checkoutUrl` (Stripe's hosted payment page)
   - Stores parlay data in session metadata

3. **`POST /api/webhook`**
   - Handles Stripe webhook events
   - Listens for `checkout.session.completed`
   - Logs successful payments
   - **TODO**: Place actual bets on Kalshi when payment succeeds

4. **`GET /payment-success`**
   - Beautiful success page after payment
   - Shows payment details
   - Auto-closes after 5 seconds

5. **`GET /payment-cancel`**
   - Cancel page if user abandons payment
   - Auto-closes after 3 seconds

### Frontend (`popup.js`)

1. **Updated `placeParlayOrder(quote)`**
   - Calls `/api/create-checkout-session`
   - Opens Stripe Checkout in new tab
   - Closes bet overlay after redirect
   - Error handling with user-friendly messages

---

## 🚀 How It Works

### User Flow

```
User fills out parlay
        ↓
Clicks "Place Your Bet"
        ↓
Enters stake amount
        ↓
Clicks "Get Quote"
        ↓
AI analyzes parlay
        ↓
Clicks "Place Parlay"
        ↓
Extension creates Stripe checkout session
        ↓
New tab opens with Stripe payment page
        ↓
User enters card details
        ↓
Payment processed
        ↓
Stripe redirects to success page
        ↓
Webhook notifies backend
        ↓
Backend places bet on Kalshi (TODO)
        ↓
Success page auto-closes
        ↓
User returns to extension
```

### Technical Flow

```javascript
// 1. Frontend creates checkout session
const res = await fetch('/api/create-checkout-session', {
  method: 'POST',
  body: JSON.stringify({ userId, stake, parlayBets, quote })
});

// 2. Backend creates Stripe session
const session = await stripe.checkout.sessions.create({
  payment_method_types: ['card'],
  line_items: [...],
  success_url: 'http://localhost:4000/payment-success',
  cancel_url: 'http://localhost:4000/payment-cancel',
  metadata: { userId, parlayData, stake, quoteData }
});

// 3. Frontend opens Stripe Checkout
chrome.tabs.create({ url: session.url });

// 4. User pays on Stripe's secure page

// 5. Stripe sends webhook to backend
// POST /api/webhook
// Event: checkout.session.completed

// 6. Backend processes payment
// TODO: Place bet on Kalshi
```

---

## 🧪 Testing

### Test Cards (Stripe Test Mode)

| Card Number | Scenario | CVC | Expiry |
|-------------|----------|-----|--------|
| `4242 4242 4242 4242` | ✅ Success | Any | Any future |
| `4000 0000 0000 9995` | ❌ Declined | Any | Any future |
| `4000 0025 0000 3155` | 🔐 Requires 3D Secure | Any | Any future |

### Testing Steps

1. **Add 2+ bets to parlay**
2. **Click "Place Your Bet"**
3. **Enter stake** (e.g., $100)
4. **Click "Get Quote"**
5. **Wait for AI analysis**
6. **Click "Place Parlay"**
7. **New tab opens** with Stripe Checkout
8. **Enter test card**: `4242 4242 4242 4242`
9. **Any future expiry**: `12/34`
10. **Any CVC**: `123`
11. **Click "Pay"**
12. **Success page appears** ✅
13. **Page auto-closes** after 5 seconds

### Check Backend Logs

```bash
cd /Users/shivamkumar/KalshiExtension
# Watch server logs
npm start

# You should see:
[Stripe] Creating checkout session for user user_..., stake: $100
✅ Checkout session created: cs_test_...
✅ Payment successful for session: cs_test_...
   Amount: $100.00
   User ID: user_...
   Parlay bets: [...]
```

---

## 🔧 Configuration

### Environment Variables (`.env`)

```bash
# Your Stripe API key
STRIPE_API_KEY=sk_test_your_stripe_test_key_here

# Optional: Webhook secret (for production)
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret_here
```

### Webhook Setup (For Production)

**Currently**: Webhooks work without signature verification (dev mode)

**For Production**:
1. Install Stripe CLI: `brew install stripe/stripe-cli/stripe`
2. Login: `stripe login`
3. Forward webhooks: `stripe listen --forward-to localhost:4000/api/webhook`
4. Copy the webhook signing secret: `whsec_...`
5. Add to `.env`: `STRIPE_WEBHOOK_SECRET=whsec_...`

---

## 💰 Pricing

### Stripe Fees (Test Mode: $0, Live Mode):
- **2.9% + $0.30** per successful card charge
- No monthly fees
- No setup fees

### Examples:
| Stake | Stripe Fee | You Receive |
|-------|-----------|-------------|
| $10   | $0.59     | $9.41       |
| $50   | $1.75     | $48.25      |
| $100  | $3.20     | $96.80      |
| $500  | $14.80    | $485.20     |

---

## 🎨 Customization

### Change Success/Cancel Pages

Edit in `server/index.js`:
- `app.get("/payment-success", ...)` - Line 338
- `app.get("/payment-cancel", ...)` - Line 435

### Change Stripe Checkout Appearance

In `stripe.checkout.sessions.create()`:
```javascript
const session = await stripe.checkout.sessions.create({
  // ... other options
  
  // Custom appearance
  ui_mode: 'embedded', // or 'hosted' (default)
  
  // Custom success URL
  success_url: 'https://yourdomain.com/success?session_id={CHECKOUT_SESSION_ID}',
  
  // Add customer email
  customer_email: 'user@example.com',
  
  // Add discount codes
  allow_promotion_codes: true,
});
```

---

## 🔐 Security

### What's Secure:
✅ Stripe handles all card data (PCI compliant)  
✅ API key stored in `.env` (not in code)  
✅ HTTPS required in production  
✅ Webhook signature verification (when enabled)  
✅ No card data touches your server  

### What to Do:
⚠️ **NEVER** commit `.env` to git  
⚠️ Use **test keys** (`sk_test_...`) for development  
⚠️ Use **live keys** (`sk_live_...`) only in production  
⚠️ Enable webhook signature verification in production  
⚠️ Use HTTPS for production URLs  

---

## 📊 Stripe Dashboard

View payments at: https://dashboard.stripe.com/test/payments

You can see:
- ✅ All successful payments
- ❌ Failed payments
- 📊 Revenue analytics
- 👥 Customer information
- 🔔 Webhook logs
- 💸 Refunds

---

## 🚨 Common Issues

### Issue: "No such customer" error
**Fix**: Remove `customer` field from `checkout.sessions.create()` or create customer first

### Issue: Webhook not receiving events
**Fix**: 
1. Check Stripe CLI is running: `stripe listen`
2. Verify `STRIPE_WEBHOOK_SECRET` is set
3. Check backend logs for webhook errors

### Issue: "Invalid API Key"
**Fix**: Verify `.env` has correct `STRIPE_API_KEY`

### Issue: Payment succeeds but nothing happens
**Fix**: Implement the Kalshi bet placement in webhook handler (line 46-57 in `server/index.js`)

---

## 📝 TODO: Next Steps

### 1. Place Actual Bets on Kalshi
When webhook receives `checkout.session.completed`:
```javascript
case 'checkout.session.completed': {
  const session = event.data.object;
  const parlayBets = JSON.parse(session.metadata.parlayData);
  const stake = parseFloat(session.metadata.stake);
  
  // TODO: Call Kalshi API to place bets
  for (const bet of parlayBets) {
    await placeKalshiBet(bet, stake / parlayBets.length);
  }
  
  // TODO: Clear user's parlay from database
  await clearParlayBets(session.metadata.userId);
  
  break;
}
```

### 2. Add Payment History
Store payment records in database:
```sql
CREATE TABLE payments (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(255),
  session_id VARCHAR(255) UNIQUE,
  amount DECIMAL(10, 2),
  status VARCHAR(50),
  parlay_data JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 3. Add Refund Functionality
Handle refunds via Stripe:
```javascript
const refund = await stripe.refunds.create({
  payment_intent: 'pi_...',
  amount: 10000, // cents
  reason: 'requested_by_customer'
});
```

### 4. Switch to Live Mode
1. Complete Stripe account verification
2. Get live API keys
3. Update `.env` with `sk_live_...`
4. Update success/cancel URLs to production domain
5. Enable webhook signature verification

---

## 🎯 Files Modified

- ✅ `server/index.js` - Added Stripe integration, checkout endpoint, webhook handler, success/cancel pages
- ✅ `popup.js` - Updated `placeParlayOrder()` to use Stripe Checkout
- ✅ `package.json` - Added `stripe` dependency
- ✅ `manifest.json` - Version bump to 0.4.0
- ✅ `.env` - Contains `STRIPE_API_KEY`

---

## 🎉 Summary

Your extension now has a **fully functional payment system**! Users can:
1. Build parlays
2. Get AI-powered quotes
3. Pay securely via Stripe
4. See beautiful success/cancel pages

**Next**: Implement Kalshi bet placement in the webhook handler!

---

**Version:** 0.4.0  
**Date:** 2025-11-16  
**Status:** ✅ Payment system fully integrated (Kalshi bet placement TODO)


