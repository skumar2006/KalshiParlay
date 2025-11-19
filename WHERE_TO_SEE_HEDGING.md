# 📍 Where to See Hedging Strategy Output

## 🖥️ **Location: Backend Terminal/Console**

The hedging strategy is logged to the **terminal where you run `npm start`**.

---

## 🚀 How to See It

### 1. Start the Backend Server
```bash
cd /Users/shivamkumar/KalshiExtension
npm start
```

You should see:
```
> kalshi-extension@0.1.0 start
> node server/index.js

Kalshi backend listening on http://localhost:4000
[DB] Database initialized successfully
```

### 2. Make a Quote Request

**From the Extension:**
1. Open the extension on a Kalshi market page
2. Add 2+ bets to your parlay
3. Click "Place Your Bet"
4. Enter a stake amount (e.g., $100)
5. Click "Get Quote"

### 3. Watch the Terminal!

**The hedging calculation will appear in the terminal:**

```
[Quote] Getting quote for stake: 100

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

   Leg 1: Will Trump veto at least 5 bills before Jan 1, 2026?
      Option: Yes
      Kalshi probability: 11%
      Hedge bet size: $511.36
      Potential win from hedge: $4,648.73

   Leg 2: Will Jaxon Smith-Njigba be on the cover of Madden NFL 27?
      Option: Yes
      Kalshi probability: 56%
      Hedge bet size: $511.36
      Potential win from hedge: $913.14

💸 TOTAL HEDGING COST:
   Total to spend on Kalshi: $1,022.73
   Potential win if parlay hits: $5,561.87

🎲 FINAL POSITION (WITH HEDGE):
   If user WINS: House net = $XXX.XX
   If user LOSES: House net = $XXX.XX
   Expected value: $XX.XX
   Final edge: XX.XX%
   ✅ Edge is now within target range!

================================================================================

[Quote] Received quote: { ... }
```

---

## 🔍 What You'll See

### When Quote is Generated
Every time a user clicks "Get Quote", the backend:
1. Calls OpenAI to analyze correlations
2. Calculates the adjusted payout
3. **Calculates hedging strategy** ← This logs to terminal
4. Returns the payout to the user

### User Never Sees
- ❌ Hedging calculations
- ❌ Edge percentages
- ❌ AI correlation analysis
- ❌ Risk assessment

### User Only Sees
- ✅ Their parlay bets in the overlay
- ✅ Stake input field
- ✅ "Get Quote" button
- ✅ **Final payout** (after clicking Get Quote)
- ✅ "Place Parlay" button (after quote)

---

## 📊 Understanding the Output

### Key Sections

**1. USER BET DETAILS**
- User's stake amount
- Payout we owe if they win
- Probability of their parlay winning

**2. HOUSE POSITION (NO HEDGE)**
- Expected value without hedging
- Current edge percentage
- Whether hedging is needed

**3. HEDGING STRATEGY**
- How much to bet on each parlay leg
- Potential winnings from hedge bets
- Total cost of hedging

**4. FINAL POSITION (WITH HEDGE)**
- House net profit if user wins
- House net profit if user loses
- Final expected value
- Final edge percentage

---

## ⚙️ Quick Test

### Test Command (Alternative)
You can also test the hedging directly via curl:

```bash
curl -X POST http://localhost:4000/api/quote \
  -H "Content-Type: application/json" \
  -d '{
    "bets": [
      {"marketTitle": "Test Market 1", "optionLabel": "Yes", "prob": 60},
      {"marketTitle": "Test Market 2", "optionLabel": "No", "prob": 40}
    ],
    "stake": 100
  }'
```

**Watch the terminal** where `npm start` is running - you'll see the hedging output!

---

## 🐛 Troubleshooting

### "I don't see hedging output!"

**Check:**
1. ✅ Backend server is running (`npm start`)
2. ✅ You clicked "Get Quote" in the extension
3. ✅ You're looking at the **terminal/console**, not the browser console
4. ✅ The terminal shows `Kalshi backend listening on http://localhost:4000`

### "Output is too fast / scrolled away"

**Options:**
1. Scroll up in your terminal
2. Redirect output to a file:
   ```bash
   npm start > hedging.log 2>&1
   # Then watch the log: tail -f hedging.log
   ```
3. Use a terminal with buffer/search (iTerm2, Windows Terminal, etc.)

---

## 📸 Example Screenshot Location

```
Terminal/Console
    ↓
Running: npm start
    ↓
[When user clicks "Get Quote"]
    ↓
Hedging output appears HERE ← Look for the === lines
```

---

## ✅ Summary

**To see hedging strategy:**
1. Run `npm start` in terminal
2. Use extension to get a quote
3. Watch the terminal output

**It appears:**
- Between the `===============` lines
- After `[Quote] Getting quote for stake: X`
- Before `[Quote] Received quote`

**You'll see it every time** a user gets a quote! 🎉

