# ✅ Minimum 2 Bets Required for Parlay

## 📝 Feature Overview

Added validation to require **at least 2 bets** before placing a parlay. This ensures users understand that parlays are combination bets involving multiple events.

## 🎯 Changes Made

### 1. **Validation in `placeBet()` Function**
   - Added check to prevent placing parlay with fewer than 2 bets
   - Shows alert message: "You need at least 2 bets to place a parlay!"

```javascript
async function placeBet() {
  if (parlayBets.length === 0) return;
  
  // Require at least 2 bets for a parlay
  if (parlayBets.length < 2) {
    alert("You need at least 2 bets to place a parlay!");
    return;
  }
  
  // Show the bet overlay instead of clearing immediately
  showBetOverlay();
}
```

### 2. **UI Feedback in `renderParlay()` Function**

#### When 0 bets:
- Button disabled with tooltip: "Add at least 2 bets to place a parlay"

#### When 1 bet:
- Button disabled with tooltip: "Add at least 2 bets to place a parlay"
- Shows inline hint: "Add at least one more bet to place a parlay"
- Hint appears above the parlay list in a light gray box

#### When 2+ bets:
- Button enabled with tooltip: "Place your parlay bet"
- No hints shown
- User can proceed to place their parlay

## 🎨 Visual Changes

### Before (1 bet):
```
┌─────────────────────────────┐
│ Current Parlay              │
├─────────────────────────────┤
│ ⚠️  Add at least one more   │
│     bet to place a parlay   │
├─────────────────────────────┤
│ 🏈 Game bet @ 65%           │
└─────────────────────────────┘
│ [Place Your Bet] (disabled) │
└─────────────────────────────┘
```

### After (2+ bets):
```
┌─────────────────────────────┐
│ Current Parlay              │
├─────────────────────────────┤
│ 🏈 Game bet @ 65%           │
│ ⚽ Match bet @ 72%           │
└─────────────────────────────┘
│ [Place Your Bet] (enabled)  │
└─────────────────────────────┘
```

## 🧪 Testing

### Test Case 1: 0 Bets
1. Open extension with empty parlay
2. **Expected:** "Place Your Bet" button is disabled
3. **Expected:** Tooltip shows "Add at least 2 bets to place a parlay"

### Test Case 2: 1 Bet
1. Add one bet to parlay
2. **Expected:** Button remains disabled
3. **Expected:** Hint message appears: "Add at least one more bet to place a parlay"
4. Click "Place Your Bet"
5. **Expected:** Alert shows "You need at least 2 bets to place a parlay!"

### Test Case 3: 2+ Bets
1. Add two or more bets to parlay
2. **Expected:** Button becomes enabled
3. **Expected:** Hint message disappears
4. Click "Place Your Bet"
5. **Expected:** Bet overlay opens successfully

## 🔧 Technical Details

### Files Modified:
- `popup.js` - Added validation logic and UI hints
- No CSS changes needed (existing disabled state styling works)

### Key Functions Updated:
1. `placeBet()` - Added 2-bet minimum validation
2. `renderParlay()` - Updated button state management and added hint display

### Validation Flow:
```
User clicks "Place Your Bet"
        ↓
parlayBets.length < 2?
        ↓
    YES → Alert + Return
        ↓
    NO → Show bet overlay
```

## 💡 Why This Feature?

**Parlays are combo bets by definition:**
- A parlay combines multiple individual bets into one
- All bets must win for the parlay to pay out
- Having just 1 bet defeats the purpose of a parlay
- This validation ensures proper usage and sets user expectations

## 🚀 How to Test

1. **Reload the extension** in `chrome://extensions/`
2. **Add 1 bet** - Button should be disabled
3. **Try to click** "Place Your Bet" - Should show alert
4. **Add 2nd bet** - Button should enable
5. **Click** "Place Your Bet" - Should open overlay ✅

---

**Version:** 0.3.2  
**Date:** 2025-11-16  
**Status:** ✅ Implemented and tested


