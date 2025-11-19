# Feature Update: Delete Bets from Parlay

## ✨ New Feature Added!

You can now **delete individual bets** from your parlay with a single click!

## How It Works

### Visual

Each bet in your parlay now has a red **×** button on the right side:

```
┌────────────────────────────────────────────────┐
│  🖼️  Market Title                              │
│      Option Label                     45%   × │
└────────────────────────────────────────────────┘
                                            ↑
                                    Click to delete
```

### Usage

1. **Open the extension** on any Kalshi page
2. **See your current parlay** in the "Current Parlay" section
3. **Hover over a bet** - the delete button (×) turns darker red
4. **Click the × button** to remove that bet
5. ✅ **Bet is deleted** from:
   - The UI (disappears immediately)
   - PostgreSQL database (permanent removal)

## Technical Details

### Frontend Changes

**popup.css:**
- Added `.parlay-item-delete` styling
- Red circular button (24×24px)
- Hover effect (darker on hover)
- Click animation (scale down)

**popup.js:**
- Added `removeBetFromParlay(betId)` function
- Calls DELETE endpoint: `/api/parlay/:userId/:betId`
- Updates local `parlayBets` array
- Re-renders the parlay UI
- Error handling with user alerts

### Backend (Already Implemented)

**server/index.js:**
- Endpoint: `DELETE /api/parlay/:userId/:betId`
- Removes bet from PostgreSQL
- Returns success response

**server/db.js:**
- `removeParlayBet(userId, betId)` function
- SQL: `DELETE FROM parlay_bets WHERE id = ? AND user_id = ?`

## User Experience

### Before
❌ Could only clear entire parlay
❌ Had to place bet to start over
❌ No way to remove mistakes

### After
✅ Delete individual bets
✅ Keep other bets intact
✅ Fix mistakes easily
✅ Permanent deletion from database

## Examples

### Example 1: Remove a Single Bet

```
Starting parlay:
1. Team A wins - 60%
2. Player scores 10+ - 45%
3. Over 50 points - 70%

Click × on bet #2

Result:
1. Team A wins - 60%
2. Over 50 points - 70%

✓ Bet #2 removed from database
✓ Combined probability updated
```

### Example 2: Remove All But One

```
Starting parlay:
1. Option A - 50%
2. Option B - 55%
3. Option C - 60%

Click × on bets #1 and #3

Result:
1. Option B - 55%

✓ Can continue adding more bets
✓ Or place a single bet
```

## Testing

To test the feature:

1. **Add multiple bets** to your parlay (3-4 bets)
2. **Click the × button** on one bet
3. **Verify**:
   - Bet disappears from UI immediately
   - Other bets remain
   - Database check:
     ```bash
     psql $DATABASE_URL -c "SELECT * FROM parlay_bets;"
     ```
   - Deleted bet should be gone

4. **Reload the extension** (close and reopen)
5. **Verify** the bet is still gone (confirms database deletion)

## Error Handling

### If deletion fails:
- User sees alert: "Failed to remove bet. Please try again."
- Bet stays in UI (not removed locally until server confirms)
- Error logged to console for debugging

### Network errors:
- Same error handling as above
- Check backend is running: `curl http://localhost:4000/api/health`

## Styling Details

### Colors
- **Normal**: `#ff6b6b` (coral red)
- **Hover**: `#ff5252` (darker red)
- **Text**: White
- **Size**: 24×24px circular button

### Positioning
- At the end of each parlay item row
- After the probability percentage
- Aligned to center vertically

### Interaction
- **Hover**: Background darkens
- **Click**: Button scales down slightly (0.95x)
- **Cursor**: Pointer (indicates clickable)

## Code Changes Summary

### Files Modified

1. **popup.css** (+28 lines)
   - Added `.parlay-item-delete` styles
   - Added hover and active states
   - Made `.parlay-item` position relative

2. **popup.js** (+24 lines)
   - Added `removeBetFromParlay(betId)` function
   - Updated `renderParlay()` to add delete buttons
   - Added event listeners for delete buttons

### No Backend Changes Needed
The DELETE endpoint was already implemented in the initial PostgreSQL integration!

## Reload Instructions

After pulling these changes:

1. **Reload extension** in `chrome://extensions/` (click 🔄)
2. **No need to reload Kalshi page** (this is popup-only)
3. **Click extension icon** and test!

## Related Documentation

- See `TROUBLESHOOTING.md` for debugging help
- See `README.md` for API documentation
- See `DATABASE_SETUP.md` for database details

## Future Enhancements

Possible improvements:
- [ ] Confirmation dialog before deleting
- [ ] Undo functionality (restore deleted bet)
- [ ] Swipe to delete gesture
- [ ] Bulk delete (select multiple)
- [ ] Edit bet (change option)

## Feedback

This feature makes it easy to:
- Experiment with different parlay combinations
- Remove bets that no longer make sense
- Fix accidental additions
- Fine-tune your parlay before placing

Enjoy the new feature! 🎉


