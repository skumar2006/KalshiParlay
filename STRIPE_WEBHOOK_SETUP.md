# 🎣 Stripe Webhook Setup - Payment Confirmation

## ⚠️ **Current Situation**

You're seeing this when checkout is **created** (user clicks "Place Parlay"):
```
✅ Checkout session created: cs_test_...
✅ Payment details saved to database
```

But you need to see this when payment is **confirmed** (user completes payment):
```
================================================================================
💳 STRIPE PAYMENT CONFIRMED
================================================================================
✅ Session ID: cs_test_...
💰 Amount paid: $5.00
🎯 PARLAY BETS: [full details]
🛡️ EXECUTING HEDGING STRATEGY: [hedge bets]
================================================================================
```

---

## 🔧 **Solution: Set Up Stripe Webhooks**

Stripe webhooks are HTTP callbacks that Stripe sends to your server when events happen (like payment completion).

### **Problem:**
Your local server (`http://localhost:4000`) is not accessible from the internet, so Stripe can't send webhooks to it directly.

### **Solution:**
Use **Stripe CLI** to forward Stripe events to your local server.

---

## 🚀 **Setup Instructions**

### **Step 1: Install Stripe CLI**

#### macOS (Homebrew):
```bash
brew install stripe/stripe-cli/stripe
```

#### macOS (Direct Download):
```bash
# Download from: https://github.com/stripe/stripe-cli/releases/latest
# Or use this command:
curl -L "https://github.com/stripe/stripe-cli/releases/download/v1.19.4/stripe_1.19.4_darwin_x86_64.tar.gz" -o stripe.tar.gz
tar -xvf stripe.tar.gz
sudo mv stripe /usr/local/bin/
```

#### Verify Installation:
```bash
stripe --version
```

---

### **Step 2: Login to Stripe**

```bash
stripe login
```

This will:
1. Open your browser
2. Ask you to allow access
3. Link the CLI to your Stripe account

---

### **Step 3: Forward Webhooks to Local Server**

Open a **new terminal window** and run:

```bash
stripe listen --forward-to localhost:4000/api/webhook
```

You should see:
```
> Ready! You are using Stripe API Version [2024-XX-XX]. Your webhook signing secret is whsec_...
> Listening...
```

**Keep this terminal open!** It will forward all Stripe events to your local server.

---

### **Step 4: Test a Payment**

Now when you:
1. Make a parlay quote
2. Click "Place Parlay"
3. Complete the Stripe checkout
4. **The webhook will fire!**

You'll see in the **Stripe CLI terminal**:
```
2025-11-19 02:30:00   --> checkout.session.completed [evt_test_...]
2025-11-19 02:30:01  <--  [200] POST http://localhost:4000/api/webhook [evt_test_...]
```

And in your **server terminal** (npm start):
```
================================================================================
💳 STRIPE PAYMENT CONFIRMED
================================================================================
[Full payment details, parlay info, hedging strategy]
```

---

## 🧪 **Quick Test**

### Terminal 1: Run Your Server
```bash
cd /Users/shivamkumar/KalshiExtension
npm start
```

### Terminal 2: Run Stripe CLI
```bash
stripe listen --forward-to localhost:4000/api/webhook
```

### Browser: Make a Test Payment
1. Open your extension
2. Add 2-3 bets to parlay
3. Click "Place Your Bet"
4. Enter stake
5. Click "Get Quote"
6. Click "Place Parlay"
7. Use test card: `4242 4242 4242 4242`
8. Complete payment

### Watch Both Terminals!
- **Stripe CLI**: Shows webhook was sent
- **Your server**: Shows full payment confirmation output!

---

## 🎯 **Alternative: Trigger Webhook Manually**

If you want to test the webhook without making a real payment:

```bash
# Get your session ID from the checkout creation log
# Then trigger a fake completion event:

stripe trigger checkout.session.completed \
  --override checkout_session:id=cs_test_a1HURvI39stUDcG9RCSwvW9uOMnC8BsPR78xbrTsc5HZYDIFUPkdbHMwcV
```

This will send a fake `checkout.session.completed` event to your server.

---

## 📊 **What You'll See**

### Before Webhook Setup:
```
[Stripe] Creating checkout session...
✅ Checkout session created
✅ Payment details saved to database
[Nothing when payment completes]
```

### After Webhook Setup:
```
[Stripe] Creating checkout session...
✅ Checkout session created
✅ Payment details saved to database

[User completes payment]

================================================================================
💳 STRIPE PAYMENT CONFIRMED
================================================================================
✅ Session ID: cs_test_...
💰 Amount paid: $5.00
📧 Customer email: user@example.com

📊 PURCHASE DETAILS:
   User ID: user_123abc
   Stake: $5.00
   Number of legs: 3

🎯 PARLAY BETS:
   1. Washington at Miami - WAS (43%)
   2. Albania vs England - ENG (52%)  
   3. Dallas at Las Vegas - DAL (65%)

💵 PAYOUT INFO:
   Promised payout if wins: $30.99
   Potential profit: $25.99

✅ Updated pending payment status to 'completed'
✅ Saved to completed_purchases (ID: 1)

🛡️ EXECUTING HEDGING STRATEGY:
   🎲 HEDGE BETS TO PLACE:
   
   1. Albania vs England - ENG (52%)
      Bet size: $0.75
      Potential win: $1.44
      📍 ACTION NEEDED: Place this bet on Kalshi
   
   2. Dallas at Las Vegas - DAL (65%)
      Bet size: $2.00
      Potential win: $3.08
      📍 ACTION NEEDED: Place this bet on Kalshi

✅ Cleared user's parlay bets
🎉 PAYMENT PROCESSING COMPLETE

================================================================================
```

---

## 🔐 **Production Setup (Later)**

For production, you'll need to:

1. **Deploy your server** to a public URL (Heroku, Vercel, AWS, etc.)
2. **Configure webhook endpoint** in Stripe Dashboard:
   - Go to: https://dashboard.stripe.com/webhooks
   - Add endpoint: `https://your-domain.com/api/webhook`
   - Select events: `checkout.session.completed`
3. **Add webhook secret** to your `.env`:
   ```
   STRIPE_WEBHOOK_SECRET=whsec_...
   ```

---

## 📝 **Summary**

**Current Issue:**
- You see logs when checkout is **created**
- You DON'T see logs when payment is **confirmed**

**Root Cause:**
- Stripe webhooks aren't reaching your local server

**Solution:**
```bash
# Terminal 1
npm start

# Terminal 2
stripe listen --forward-to localhost:4000/api/webhook

# Browser
# Complete a test payment
# Watch both terminals for webhook!
```

---

## ✅ **Quick Start**

```bash
# 1. Install Stripe CLI
brew install stripe/stripe-cli/stripe

# 2. Login
stripe login

# 3. Forward webhooks
stripe listen --forward-to localhost:4000/api/webhook

# 4. Test payment in browser
# 5. Watch terminal for "💳 STRIPE PAYMENT CONFIRMED"!
```

---

**That's the missing piece!** The webhook endpoint is already coded and ready - you just need to forward Stripe events to your local server using Stripe CLI. 🎣

