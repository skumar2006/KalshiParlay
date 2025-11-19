# Bet Overlay Feature

## ✨ New Feature: Stake Input & Get Quote Modal

When you click **"Place Your Bet"**, a beautiful overlay modal now appears where you can:
1. Review your parlay
2. Enter a stake amount
3. See the potential payout calculated in real-time
4. Click "Get Quote" to get an actual quote (placeholder for now)

## 🎨 Visual Design

### Overlay Modal
```
┌──────────────────────────────────────────────────────────────┐
│  ╔════════════════════════════════════════════════════════╗  │
│  ║  Place Your Parlay                               ×    ║  │
│  ╠════════════════════════════════════════════════════════╣  │
│  ║                                                         ║  │
│  ║  Your Parlay                                           ║  │
│  ║  ┌─────────────────────────────────────────────────┐  ║  │
│  ║  │ [IMG] Hungary vs Ireland                        │  ║  │
│  ║  │       Ireland                           45%     │  ║  │
│  ║  │ [IMG] Seattle at LA                             │  ║  │
│  ║  │       SEA                               55%     │  ║  │
│  ║  └─────────────────────────────────────────────────┘  ║  │
│  ║  Combined Probability:                    24.75%      ║  │
│  ║                                                         ║  │
│  ║  Stake Amount ($)                                      ║  │
│  ║  ┌─────────────────────────────────────────────────┐  ║  │
│  ║  │ [Enter amount]                                   │  ║  │
│  ║  └─────────────────────────────────────────────────┘  ║  │
│  ║                                                         ║  │
│  ║  Potential Payout:                       $404.04      ║  │
│  ║                                                         ║  │
│  ║  ┌───────────────────────────────────────────────────┐║  │
│  ║  │             Get Quote                            │║  │
│  ║  └───────────────────────────────────────────────────┘║  │
│  ╚════════════════════════════════════════════════════════╝  │
└──────────────────────────────────────────────────────────────┘
```

## 🔧 How It Works

### User Flow

1. **User adds bets to parlay**
2. **Clicks "Place Your Bet"**
3. **Overlay appears** with:
   - Summary of all bets in the parlay
   - Combined probability calculation
   - Input field for stake amount
   - Real-time potential payout calculation
4. **User enters stake amount** (e.g., $100)
5. **Potential payout updates automatically**
6. **"Get Quote" button becomes enabled**
7. **User clicks "Get Quote"**
8. **Quote logic executes** (placeholder for now)

### Calculations

**Combined Probability:**
```javascript
const combinedProb = parlayBets.reduce((acc, bet) => {
  const prob = bet.prob / 100;
  return acc * prob;
}, 1) * 100;
```

**Potential Payout:**
```javascript
const payout = stake / combinedProb;
```

For example:
- Bet 1: 45% probability
- Bet 2: 55% probability
- Combined: 45% × 55% = 24.75%
- Stake: $100
- Payout: $100 / 0.2475 = $404.04

## 📁 Files Changed

### 1. `popup.html`
**Added:**
- Overlay modal structure
- Bet modal with header, body, footer
- Parlay summary section
- Stake input field
- Potential payout display
- Get Quote button
- Close button (×)

### 2. `popup.css`
**Added:**
- `.bet-overlay` - Full-screen overlay with backdrop blur
- `.bet-modal` - Modal card with animations
- `.bet-modal-header` - Header with title and close button
- `.bet-modal-body` - Scrollable content area
- `.parlay-summary` - Summary card for parlay items
- `.modal-parlay-item` - Individual bet display in modal
- `.stake-input` - Styled input field
- `.potential-payout` - Payout display section
- `.get-quote-btn` - Primary action button
- Animations: `fadeIn`, `slideUp`

### 3. `popup.js`
**Added Functions:**

1. **`showBetOverlay()`**
   - Populates modal with parlay bets
   - Calculates and displays combined probability
   - Resets input fields
   - Shows the overlay

2. **`closeBetOverlay()`**
   - Hides the overlay
   - Can be triggered by:
     - Close button (×)
     - Clicking outside the modal
     - ESC key (not implemented yet)

3. **`calculatePayout()`**
   - Triggered on stake input change
   - Calculates potential payout in real-time
   - Enables/disables "Get Quote" button
   - Updates display

4. **`getQuote()`**
   - Validates stake amount
   - Logs bet details for debugging
   - Shows placeholder alert
   - **TODO: Integrate with Kalshi API**

**Modified Functions:**

- **`placeBet()`** - Now calls `showBetOverlay()` instead of showing an alert

**Event Listeners:**
- Close button click → `closeBetOverlay()`
- Stake input change → `calculatePayout()`
- Get Quote button click → `getQuote()`
- Overlay background click → `closeBetOverlay()`

## 🎯 Features

### ✅ Implemented
- [x] Beautiful overlay modal
- [x] Parlay summary display
- [x] Combined probability calculation
- [x] Stake input with validation
- [x] Real-time payout calculation
- [x] "Get Quote" button (placeholder)
- [x] Close button and click-outside-to-close
- [x] Smooth animations (fade in, slide up)
- [x] Responsive design
- [x] Button state management (disabled when no stake)

### 🚧 To Be Implemented
- [ ] Actual Kalshi API integration for quotes
- [ ] Quote display with breakdown
- [ ] Order placement logic
- [ ] Success/error handling
- [ ] Loading states
- [ ] ESC key to close overlay
- [ ] Bet history tracking

## 💡 Next Steps for Integration

### 1. Get Quote Implementation

Replace the placeholder in `getQuote()`:

```javascript
async function getQuote() {
  const stakeInput = document.getElementById("stake-input");
  const stake = parseFloat(stakeInput?.value) || 0;
  
  if (stake <= 0) {
    alert("Please enter a valid stake amount");
    return;
  }
  
  // Show loading state
  const getQuoteBtn = document.getElementById("get-quote-btn");
  getQuoteBtn.textContent = "Getting Quote...";
  getQuoteBtn.disabled = true;
  
  try {
    // Call your backend to get quote from Kalshi
    const uid = await getUserId();
    const res = await fetch(`${BACKEND_BASE_URL}/api/kalshi/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: uid,
        bets: parlayBets,
        stake: stake
      })
    });
    
    if (!res.ok) {
      throw new Error(`Failed to get quote: ${res.status}`);
    }
    
    const quote = await res.json();
    
    // Display quote details
    displayQuote(quote);
    
  } catch (err) {
    console.error("Failed to get quote:", err);
    alert("Failed to get quote. Please try again.");
  } finally {
    getQuoteBtn.textContent = "Get Quote";
    getQuoteBtn.disabled = false;
  }
}
```

### 2. Backend Endpoint

Create a new endpoint in `server/index.js`:

```javascript
app.post("/api/kalshi/quote", async (req, res) => {
  const { userId, bets, stake } = req.body;
  
  try {
    // 1. For each bet, get the current orderbook
    // 2. Calculate the best available price
    // 3. Calculate total cost and potential payout
    // 4. Return quote details
    
    const quote = {
      bets: bets.map(bet => ({
        ...bet,
        currentPrice: /* fetch from Kalshi */,
        quantity: /* calculate */
      })),
      totalCost: stake,
      potentialPayout: /* calculate */,
      expiresAt: Date.now() + 60000 // 1 minute
    };
    
    res.json(quote);
  } catch (err) {
    res.status(500).json({ error: "Failed to get quote" });
  }
});
```

## 🎨 Styling Details

### Colors
- **Overlay Background**: `rgba(0, 0, 0, 0.7)` with backdrop blur
- **Modal Background**: `#f5f5f5`
- **Card Background**: `#ffffff`
- **Primary Green**: `#00b894`
- **Text Dark**: `#333`
- **Text Light**: `#666`
- **Border**: `#e0e0e0`

### Animations
- **Fade In**: 0.2s ease-out
- **Slide Up**: 0.3s ease-out
- **Hover transitions**: 0.2s

### Responsive
- Modal width: 90% (max 400px)
- Max height: 90vh with scrolling
- Works on small popup sizes

## 🧪 Testing

### Test Checklist

1. **Open overlay**
   - [ ] Click "Place Your Bet" with bets in parlay
   - [ ] Modal appears with smooth animation
   - [ ] All bets displayed correctly
   - [ ] Combined probability calculated correctly

2. **Enter stake**
   - [ ] Type a number (e.g., 100)
   - [ ] Potential payout updates in real-time
   - [ ] "Get Quote" button becomes enabled
   - [ ] Type 0 or negative → button disables

3. **Get quote**
   - [ ] Click "Get Quote"
   - [ ] Alert shows with stake amount
   - [ ] Console logs bet details

4. **Close overlay**
   - [ ] Click × button → overlay closes
   - [ ] Click outside modal → overlay closes
   - [ ] Overlay hidden properly

5. **Edge cases**
   - [ ] No bets in parlay → "Place Your Bet" button disabled
   - [ ] Single bet → calculations correct
   - [ ] Many bets → scrolling works
   - [ ] Large stake → formatting correct

## 📝 Usage Example

```javascript
// User has 3 bets:
// Bet 1: 45% probability
// Bet 2: 55% probability
// Bet 3: 60% probability

// Combined: 45% × 55% × 60% = 14.85%
// Stake: $100
// Potential Payout: $100 / 0.1485 = $673.40

// User clicks "Place Your Bet"
// → Overlay appears
// → User enters $100
// → Sees $673.40 potential payout
// → Clicks "Get Quote"
// → (To be implemented: Gets actual quote from Kalshi)
```

## 🔒 Security Considerations

- Validate all inputs (stake amount)
- Sanitize displayed market titles
- Rate limit quote requests
- Verify user authentication for actual betting
- Use HTTPS for all API calls in production

## 🚀 Deployment

To test the new feature:

1. **Reload the extension**:
   ```
   chrome://extensions/ → Click reload on "Kalshi Parlay Helper"
   ```

2. **Add some bets to your parlay**

3. **Click "Place Your Bet"**

4. **You should see the beautiful overlay! 🎉**

---

**The overlay is now ready for integration with the Kalshi API!**

