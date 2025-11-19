# 🧪 Stripe Payment Testing Guide

## ✅ Setup Complete!

Your Stripe integration is **fully functional** and ready to test!

---

## 🚀 Quick Test (5 minutes)

### 1. Reload the Extension
```
1. Go to chrome://extensions/
2. Find "Kalshi Parlay Helper"
3. Click the refresh icon 🔄
```

### 2. Add Bets to Your Parlay
```
1. Navigate to any Kalshi market page
   Example: https://kalshi.com/markets/kxnflgame/...
2. Open the extension
3. Select an option (Yes/No)
4. Click "Add to Parlay"
5. Repeat for at least one more market (minimum 2 bets)
```

### 3. Place Your Bet
```
1. Click "Place Your Bet" button
2. Enter a stake amount (e.g., $100)
3. Click "Get Quote"
4. Wait for AI analysis (5-10 seconds)
5. Click "Place Parlay" button
```

### 4. Complete Payment on Stripe
```
A new tab will open with Stripe Checkout. Enter:

Card Number:    4242 4242 4242 4242
Expiry Date:    12/34 (any future date)
CVC:            123 (any 3 digits)
Name:           Test User
Email:          test@example.com
Country:        United States
ZIP:            12345

Then click "Pay"
```

### 5. Success! 🎉
```
✅ You'll see a success page
✅ Page auto-closes after 5 seconds
✅ Check backend logs for payment confirmation
```

---

## 🎴 Test Cards Reference

| Card Number | Result | Use Case |
|-------------|--------|----------|
| `4242 4242 4242 4242` | ✅ **Success** | Happy path |
| `4000 0000 0000 9995` | ❌ **Declined** | Test failure |
| `4000 0025 0000 3155` | 🔐 **Requires 3D Secure** | Test authentication |
| `4000 0000 0000 0077` | ⏳ **Charge succeeds, card is charged, but charge is later disputed** | Test disputes |

**Note**: All test cards work with:
- Any **future** expiry date (e.g., 12/34)
- Any **3-digit** CVC (e.g., 123)
- Any **billing details**

---

## 📊 Verify Payment in Stripe Dashboard

1. Go to: https://dashboard.stripe.com/test/payments
2. Login with your Stripe account
3. You should see your test payment!

**What you'll see:**
- Amount: $100.00 (or whatever you entered)
- Status: Succeeded ✅
- Customer: test@example.com
- Product: "Kalshi Parlay Bet (2 markets)"
- Metadata: Your parlay details

---

## 🔍 Check Backend Logs

In your terminal where the server is running, you should see:

```bash
[Stripe] Creating checkout session for user user_1234..., stake: $100
✅ Checkout session created: cs_test_a1W93gOKO83K3n0AoMGw0HpS...
✅ Payment successful for session: cs_test_a1W93gOKO83K3n0AoMGw0HpS...
   Amount: $100.00
   User ID: user_1234...
   Parlay bets: [...]
```

---

## 🐛 Troubleshooting

### Issue: "Failed to create checkout"
**Check:**
1. Is the server running? `curl http://localhost:4000/api/health`
2. Is `STRIPE_API_KEY` in `.env`?
3. Check server logs for errors

### Issue: Stripe page shows "Invalid request"
**Fix:**
1. Verify `STRIPE_API_KEY` is correct (starts with `sk_test_`)
2. Check if key has expired
3. Try regenerating key in Stripe Dashboard

### Issue: Payment succeeds but nothing happens
**Expected behavior!** The webhook logs the payment, but:
- **TODO**: Implement Kalshi bet placement in webhook handler
- **TODO**: Clear user's parlay after payment

### Issue: Extension doesn't open Stripe page
**Check:**
1. Open browser console (F12)
2. Look for errors in console
3. Verify `chrome.tabs.create` permission

---

## 🎬 Full Demo Flow

### Starting State
```
Extension popup:
┌────────────────────────────┐
│ Current Parlay:            │
│ • Game 1 @ 65%        [×]  │
│ • Game 2 @ 45%        [×]  │
├────────────────────────────┤
│ [Place Your Bet] (enabled) │
└────────────────────────────┘
```

### After Clicking "Place Your Bet"
```
Bet Overlay:
┌────────────────────────────┐
│ Place Your Parlay     [×]  │
├────────────────────────────┤
│ Your Parlay                │
│ • Game 1 @ 65%             │
│ • Game 2 @ 45%             │
│ Combined Probability: 29%  │
├────────────────────────────┤
│ Stake Amount ($)           │
│ [100____________]          │
│                            │
│ Potential Payout: $344.83  │
├────────────────────────────┤
│ [Get Quote]                │
└────────────────────────────┘
```

### After AI Analysis
```
Bet Overlay (with quote):
┌────────────────────────────┐
│ Place Your Parlay     [×]  │
├────────────────────────────┤
│ 📊 Correlation Analysis    │
│ These events are WEAKLY    │
│ correlated. Different      │
│ teams, different sports.   │
│                            │
│ 🎯 Risk Level: MEDIUM      │
│                            │
│ 📈 Probability Comparison  │
│ Independent: 29.25%        │
│ AI-Adjusted: 27.5%         │
│                            │
│ 💰 Payout Details          │
│ Stake: $100.00             │
│ Payout: $363.64            │
│ Profit: $263.64            │
├────────────────────────────┤
│ [Place Parlay]             │
└────────────────────────────┘
```

### After Clicking "Place Parlay"
```
1. Overlay closes
2. New tab opens: Stripe Checkout
3. Beautiful payment form
4. User enters card: 4242 4242 4242 4242
5. User clicks "Pay"
6. Success page appears
7. Page auto-closes after 5 seconds
8. User back to extension
```

---

## 📈 What Happens Behind the Scenes

```
Frontend                Backend                Stripe
   │                       │                      │
   │──POST /checkout────▶│                      │
   │   {userId, stake}    │                      │
   │                      │                      │
   │                      │──Create Session────▶│
   │                      │                      │
   │◀─{checkoutUrl}──────│◀─────────────────────│
   │                      │                      │
   │──Open Tab─────────▶Browser                 │
   │                      │                      │
   User pays on Stripe ─────────────────────────▶│
   │                      │                      │
   │                      │◀─Webhook─────────────│
   │                      │ checkout.completed   │
   │                      │                      │
   │                      │──Log Payment         │
   │                      │──TODO: Place Bet     │
   │                      │                      │
   Browser◀─Redirect───────────────────────────│
   │  /payment-success    │                      │
   │                      │                      │
   │──Close Tab (5s)      │                      │
```

---

## 🎯 Next Steps After Testing

### 1. Implement Kalshi Bet Placement
In `server/index.js`, webhook handler (line ~46):
```javascript
case 'checkout.session.completed': {
  const session = event.data.object;
  const parlayBets = JSON.parse(session.metadata.parlayData);
  
  // TODO: Place bets on Kalshi
  for (const bet of parlayBets) {
    await placeKalshiBet(bet);
  }
  
  // Clear user's parlay
  await clearParlayBets(session.metadata.userId);
}
```

### 2. Add Payment History
Track all payments in database for user history/refunds

### 3. Add Error Handling
Handle payment failures, network errors, etc.

### 4. Go Live (When Ready)
1. Get live Stripe keys
2. Update `.env` with `sk_live_...`
3. Update URLs to production domain
4. Enable webhook signature verification

---

## ✅ Checklist

Before going live, ensure:
- [ ] Stripe account verified
- [ ] Live API keys obtained
- [ ] Production URLs configured
- [ ] Webhook endpoints secured
- [ ] SSL/HTTPS enabled
- [ ] Kalshi bet placement implemented
- [ ] Error handling complete
- [ ] Payment logging added
- [ ] Refund flow implemented
- [ ] Terms of service added

---

## 💡 Pro Tips

1. **Test Different Amounts**: Try $1, $10, $100, $1000
2. **Test Failures**: Use `4000 0000 0000 9995` to test error handling
3. **Test 3D Secure**: Use `4000 0025 0000 3155` for authentication flow
4. **Check Logs**: Always monitor backend logs during testing
5. **Use Stripe Dashboard**: Great for debugging payment issues

---

**Ready to test? Let's go! 🚀**

1. Reload extension
2. Add 2+ bets
3. Click "Place Your Bet"
4. Enter $100 stake
5. Get AI quote
6. Click "Place Parlay"
7. Use card `4242 4242 4242 4242`
8. Success! 🎉

---

**Questions? Check the logs or Stripe Dashboard!**


