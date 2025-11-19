# 🚀 Quick Test Guide - Version 0.5.0

## ✅ What's New
1. **Clean overlay** - No pre-calculated payout shown
2. **Hedging strategy** - Logs to backend terminal (10-15% edge)
3. **Silent AI processing** - User only sees final payout

---

## 🎮 How to Test

### Step 1: Reload Extension
```
1. Open Chrome
2. Go to: chrome://extensions/
3. Find "Kalshi Parlay Helper"
4. Click the reload icon 🔄
```

### Step 2: Server is Already Running ✅
The backend is running on `http://localhost:4000`

**To see logs in real-time:**
```bash
# In a new terminal window
tail -f /tmp/kalshi-server.log
```

Or just watch for output in your current terminal when you make a quote.

---

## 🧪 Test the Flow

### 1. Open Extension on Kalshi
```
1. Go to any Kalshi market: https://kalshi.com/markets/...
2. Click the extension icon
```

### 2. Add Bets to Parlay
```
1. You should see the current market displayed
2. Select an option (Yes/No)
3. Click "Add to Parlay"
4. Repeat for another market (need at least 2 bets)
```

### 3. Click "Place Your Bet"
```
✅ Overlay modal should appear showing:
   - Your parlay bets (with images)
   - Stake input field
   - "Potential Payout: Get quote to see payout"
   - "Get Quote" button (disabled)
```

**What you should NOT see:**
- ❌ Combined Probability percentage
- ❌ Any calculated payout amount yet

### 4. Enter Stake Amount
```
1. Type: 100
2. Check overlay:
   ✅ Payout text: "Click 'Get Quote' to see payout"
   ✅ "Get Quote" button is now enabled
```

### 5. Click "Get Quote"
```
1. Button changes to: "Processing..."
2. Wait ~1-2 seconds
3. Check overlay:
   ✅ Payout updates: "$1,461.04" (or similar)
   ✅ Button changes to: "Place Parlay"
```

### 6. Check Backend Terminal 🔍
```
Switch to your terminal and you should see:

================================================================================
🎯 HEDGING STRATEGY CALCULATION
================================================================================

📊 USER BET DETAILS:
   User Stake: $100.00
   Payout if user wins: $1,461.04
   User's potential profit: $1,361.04
   Adjusted probability: 6.16%

💰 HOUSE POSITION (NO HEDGE):
   Expected value: $3.84
   Edge: 3.84%
   ⚠️  Edge is outside target range. Hedging required.

🛡️ HEDGING STRATEGY:
   We will place matching bets on Kalshi to lock in our 12.5% edge

   Leg 1: [Market Title]
      Option: [Yes/No]
      Kalshi probability: XX%
      Hedge bet size: $XXX.XX
      Potential win from hedge: $X,XXX.XX

   Leg 2: [Market Title]
      Option: [Yes/No]
      Kalshi probability: XX%
      Hedge bet size: $XXX.XX
      Potential win from hedge: $XXX.XX

💸 TOTAL HEDGING COST:
   Total to spend on Kalshi: $X,XXX.XX
   Potential win if parlay hits: $X,XXX.XX

🎲 FINAL POSITION (WITH HEDGE):
   If user WINS: House net = $XXX.XX
   If user LOSES: House net = $XXX.XX
   Expected value: $XX.XX
   Final edge: XX.XX%

================================================================================
```

**This is the hedging strategy!** 🎉

### 7. (Optional) Test Payment
```
1. Click "Place Parlay"
2. Should redirect to Stripe Checkout
3. Use test card: 4242 4242 4242 4242
4. Complete payment flow
```

---

## 🎯 What Should Happen

### User Experience (Extension)
```
Add bets → Place Bet → Enter stake → Get Quote → See payout → Pay
```

**Clean & Simple!** No technical details shown.

### Backend (Terminal)
```
Every time "Get Quote" is clicked:
  1. AI analyzes correlations
  2. Calculates adjusted payout
  3. Calculates hedging strategy
  4. Logs everything to console
  5. Returns payout to user
```

**Detailed & Transparent!** You see all the risk management.

---

## 🐛 Troubleshooting

### "I don't see the hedging output"
**Check:**
- ✅ Server is running (`curl http://localhost:4000/api/health`)
- ✅ You clicked "Get Quote" (not just "Place Your Bet")
- ✅ You're looking at the **terminal**, not browser console
- ✅ Look for lines between `====` symbols

### "Overlay doesn't show up"
**Fix:**
1. Hard refresh the Kalshi page: `Cmd+Shift+R` (Mac) or `Ctrl+Shift+R` (Windows)
2. Reload extension in `chrome://extensions/`
3. Try again

### "Payout shows a number immediately"
**That's wrong!** Should show:
- Before entering stake: "Get quote to see payout"
- After entering stake: "Click 'Get Quote' to see payout"
- After clicking Get Quote: "$1,461.04" (actual number)

**If seeing number immediately:**
1. Make sure you reloaded the extension
2. Check you're using the latest code

### "Server won't start"
**Kill existing process:**
```bash
lsof -ti:4000 | xargs kill -9
npm start
```

---

## 📊 Expected Results Checklist

**Extension UI:**
- [ ] Overlay appears when clicking "Place Your Bet"
- [ ] Parlay bets shown with images
- [ ] Combined probability is hidden
- [ ] Payout is hidden until quote is fetched
- [ ] "Get Quote" button works
- [ ] After quote: Payout shows dollar amount
- [ ] After quote: Button says "Place Parlay"

**Backend Terminal:**
- [ ] Hedging calculation appears between `====` lines
- [ ] Shows user bet details
- [ ] Shows current edge (no hedge)
- [ ] Shows hedging strategy per leg
- [ ] Shows total hedge cost
- [ ] Shows final position with edge percentage

**Flow:**
- [ ] User never sees hedging calculations
- [ ] User never sees AI analysis
- [ ] User only sees clean payout amount
- [ ] Backend handles all risk management

---

## 🎉 Success Criteria

If you can complete this flow, everything is working:

1. ✅ Add 2 bets to parlay
2. ✅ Click "Place Your Bet" → Overlay appears
3. ✅ Enter stake → Payout placeholder text shows
4. ✅ Click "Get Quote" → Payout updates to dollar amount
5. ✅ Check terminal → Hedging strategy logged
6. ✅ Click "Place Parlay" → Stripe checkout opens

**All 6 steps working = Perfect!** 🎊

---

## 📖 More Info

- **Technical details**: See `HEDGING_STRATEGY.md`
- **Where to find logs**: See `WHERE_TO_SEE_HEDGING.md`
- **Full changelog**: See `CHANGELOG.md`
- **Version summary**: See `VERSION_0.5.0_SUMMARY.md`

---

## 🚀 Ready to Test!

**Right now you can:**
1. Reload extension
2. Add some bets
3. Get a quote
4. Watch the hedging strategy in your terminal!

**Server is already running on port 4000.** ✅

Just go to a Kalshi market and try it! 🎉

