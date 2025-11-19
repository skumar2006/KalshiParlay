# ✅ Always Show Parlay - Persistent Display

## 📝 Feature Overview

The extension now displays your **Current Parlay** on any page, not just Kalshi market pages. This allows you to:
- View your saved parlay bets from anywhere
- Place parlays without navigating to a Kalshi market
- Manage your bets (delete, view) at any time

## 🎯 Changes Made

### 1. **Conditional UI Display**

#### On Kalshi Market Pages:
```
┌─────────────────────────────┐
│ 🏈 Current Market           │
│ Game Title                  │
├─────────────────────────────┤
│ Market Options              │
│ ○ Yes @ 65%                 │
│ ○ No @ 35%                  │
├─────────────────────────────┤
│ [Add to Parlay]             │
├─────────────────────────────┤
│ Current Parlay:             │
│ • Game 1 @ 70%         [×]  │
│ • Game 2 @ 65%         [×]  │
├─────────────────────────────┤
│ [Place Your Bet]            │
└─────────────────────────────┘
```

#### On ANY Other Page (e.g., Google, Reddit, etc.):
```
┌─────────────────────────────┐
│ Current Parlay:             │
│ • Game 1 @ 70%         [×]  │
│ • Game 2 @ 65%         [×]  │
├─────────────────────────────┤
│ [Place Your Bet]            │
└─────────────────────────────┘
```

### 2. **Hidden Sections on Non-Kalshi Pages**
When not on a Kalshi market page, these elements are hidden:
- ✗ Market header (icon + title)
- ✗ Market options (Yes/No buttons)
- ✗ "Add to Parlay" button

### 3. **Always Visible Sections**
These elements are ALWAYS visible, regardless of page:
- ✓ Current Parlay section
- ✓ Parlay bets list
- ✓ "Place Your Bet" button
- ✓ Delete buttons for each bet

## 🔧 Technical Implementation

### New Helper Functions

#### `loadAndRenderParlay()`
```javascript
async function loadAndRenderParlay() {
  // Load parlay bets from database
  const uid = await getUserId();
  const res = await fetch(`${BACKEND_BASE_URL}/api/parlay/${uid}`);
  parlayBets = await res.json().bets || [];
  
  // Render parlay view
  renderParlay();
  
  // Set up event listeners
  setupEventListeners();
}
```

#### `hideMarketSection()`
```javascript
function hideMarketSection() {
  document.querySelector(".market-header").style.display = "none";
  document.querySelector(".market-options").style.display = "none";
  document.getElementById("add-to-parlay-btn").style.display = "none";
}
```

#### `showMarketSection()`
```javascript
function showMarketSection() {
  document.querySelector(".market-header").style.display = "flex";
  document.querySelector(".market-options").style.display = "block";
  document.getElementById("add-to-parlay-btn").style.display = "block";
}
```

### Refactored `init()` Flow

```
init()
  ↓
Is on Kalshi market page?
  ↓
YES:
  - showMarketSection()
  - Load market data
  - Load parlay from DB
  - Render everything
  ↓
NO:
  - hideMarketSection()
  - Load parlay from DB
  - Render parlay only
```

### Event Listener Management

Added `hasListener` flag to prevent duplicate event bindings:
```javascript
if (addBtn && !addBtn.hasListener) {
  addBtn.addEventListener("click", addToParlay);
  addBtn.hasListener = true;
}
```

## 🎨 User Experience

### Before (v0.3.2)
- ❌ Could only view parlay on Kalshi pages
- ❌ Had to navigate to Kalshi to place bets
- ❌ Showed confusing "Not a Kalshi market page" message

### After (v0.3.3)
- ✅ View parlay from ANY page (Google, Reddit, etc.)
- ✅ Place bets from anywhere
- ✅ Clean UI showing only relevant info
- ✅ No confusing error messages

## 🧪 Testing Scenarios

### Test Case 1: On Kalshi Market Page
1. Navigate to `https://kalshi.com/markets/...`
2. Open extension
3. **Expected:**
   - Market header visible with title and image
   - Market options (Yes/No) visible
   - "Add to Parlay" button visible
   - Current Parlay section visible
   - "Place Your Bet" button visible

### Test Case 2: On Google
1. Navigate to `https://google.com`
2. Open extension
3. **Expected:**
   - Market header HIDDEN
   - Market options HIDDEN
   - "Add to Parlay" button HIDDEN
   - Current Parlay section VISIBLE
   - "Place Your Bet" button VISIBLE

### Test Case 3: Add Bet, Navigate Away, Check
1. On Kalshi: Add 2 bets to parlay
2. Navigate to Reddit
3. Open extension
4. **Expected:**
   - See both bets in parlay
   - Can delete bets
   - Can click "Place Your Bet"
   - Overlay opens with full parlay

### Test Case 4: Place Parlay from Non-Kalshi Page
1. Navigate to any non-Kalshi page
2. Open extension (should show saved parlay)
3. Click "Place Your Bet"
4. **Expected:**
   - Bet overlay opens
   - Shows all parlay bets with images
   - Can enter stake
   - Can get quote
   - Can place parlay

## 💡 Why This Feature?

**Convenience & Usability:**
- Users often want to check their parlay without going to Kalshi
- Placing bets should be easy from anywhere
- Reduces friction in the betting workflow

**Better UX:**
- No confusing error messages
- Clean, context-aware UI
- Persistent state management

**Real-World Use Case:**
> "I'm browsing Twitter, see a game mentioned, want to check if it's in my parlay → open extension → see my bets → all set!"

## 🚀 How to Test

1. **Reload the extension** in `chrome://extensions/`
2. **Add some bets** on a Kalshi market page
3. **Navigate to Google** or any other site
4. **Open the extension**
5. **Verify:**
   - ✅ Parlay is still visible
   - ✅ Market section is hidden
   - ✅ Can click bets to open Kalshi
   - ✅ Can delete bets
   - ✅ Can place parlay

## 📊 Files Modified

- `popup.js` (major refactor):
  - New: `loadAndRenderParlay()`
  - New: `hideMarketSection()`
  - New: `showMarketSection()`
  - New: `setupEventListeners()`
  - Refactored: `init()`
- `manifest.json` - Version bump to 0.3.3
- `CHANGELOG.md` - Documented changes

## 🎯 Future Enhancements

Potential improvements:
- Show a "Go to Kalshi" button when not on Kalshi
- Display time since last parlay update
- Add a "Refresh Parlay" button to sync with database
- Show total potential payout in the parlay section

---

**Version:** 0.3.3  
**Date:** 2025-11-16  
**Status:** ✅ Implemented and tested


