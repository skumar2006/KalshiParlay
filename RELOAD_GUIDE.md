# How to Properly Reload the Extension

## Important: Two Things Need Reloading

When you update the extension code, **BOTH** of these need to be reloaded:

### 1. The Extension Itself
### 2. The Kalshi Page (where content script runs)

## Step-by-Step Reload Process

### Step 1: Reload the Extension
1. Open `chrome://extensions/`
2. Find "Kalshi Parlay Helper"
3. Click the **refresh/reload icon** (🔄)
4. ✅ Extension code is now updated

### Step 2: Reload the Kalshi Page (CRITICAL!)
1. Go to your Kalshi market page tab
2. **Hard refresh** the page:
   - **Mac**: `Cmd + Shift + R`
   - **Windows/Linux**: `Ctrl + Shift + R`
3. ✅ Content script is now re-injected

### Step 3: Test It
1. Click the extension icon
2. Images should now appear!

## Why Images Disappear

The image scraping happens in **`contentScript.js`**, which:
- Runs on the Kalshi page (not in the popup)
- Gets injected when the page loads
- Is NOT updated when you reload the extension

**That's why you must reload the Kalshi page too!**

## Visual Guide

```
┌─────────────────────────────────────────────────────────┐
│  chrome://extensions/                                    │
│                                                          │
│  Kalshi Parlay Helper                    [🔄 Reload]   │
│  ↑                                                       │
│  └── Click this to reload extension                     │
└─────────────────────────────────────────────────────────┘

                      ↓ THEN ↓

┌─────────────────────────────────────────────────────────┐
│  kalshi.com/markets/...               [↻ Cmd+Shift+R]  │
│  ↑                                                       │
│  └── Hard refresh this page                             │
└─────────────────────────────────────────────────────────┘
```

## Quick Checklist

After ANY code changes:

- [ ] Reload extension in `chrome://extensions/`
- [ ] Hard refresh the Kalshi page (`Cmd+Shift+R`)
- [ ] Click extension icon
- [ ] Check browser console for logs

## If Images Still Don't Show

1. **Open the page console** (not popup console):
   - On the Kalshi page, press `F12` or right-click > Inspect
   - Look for `[ContentScript]` logs
   - Should see: `"[ContentScript] ✅ Script loaded on: ..."`

2. **If you don't see `[ContentScript]` logs:**
   - The content script isn't injected
   - Remove and re-add the extension completely
   - Reload the Kalshi page

3. **Check the popup console:**
   - Right-click popup > Inspect
   - Look for image-related logs:
     - `"Attempting to get image from DOM..."`
     - `"✅ Setting image from DOM: ..."`
   - If you see `"❌ Failed to communicate with content script"`:
     - Content script isn't running
     - Reload the Kalshi page!

## The Complete Reload (if nothing works)

Do this to completely reset everything:

1. **Close all Kalshi tabs**
2. **Go to** `chrome://extensions/`
3. **Remove** "Kalshi Parlay Helper" (click Remove button)
4. **Click** "Load unpacked"
5. **Select** the extension folder
6. **Allow** all permissions
7. **Open** a new Kalshi market page
8. **Click** the extension icon
9. ✅ Everything should work!

## Common Mistakes

❌ **Only reloading the extension**
   - Content script stays old
   - Images won't load

❌ **Only refreshing the Kalshi page**
   - Extension code stays old
   - Database features won't work

❌ **Soft refresh** (just pressing Reload)
   - Cache might not clear
   - Use hard refresh instead

✅ **Correct**: Reload BOTH extension AND page

## Quick Test

Run this in the **page console** (F12 on Kalshi page):

```javascript
// Check if content script is loaded
console.log("[TEST] Content script loaded:", typeof extractMarketImage === 'function');
```

If it shows `false`, the content script isn't running → reload the page!

## Server Restart Not Needed

Note: Images are scraped from the DOM, not from the server.
You do NOT need to restart the server for images to work.

Only reload:
1. Extension in Chrome
2. Kalshi page

That's it!


