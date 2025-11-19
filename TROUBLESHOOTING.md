# Troubleshooting Guide

## Error: "Failed to add bet to parlay. Please try again."

This error means the extension cannot successfully save the bet to the database. Follow these steps to diagnose and fix:

### Step 1: Check Backend Server

```bash
# Check if server is running
curl http://localhost:4000/api/health

# Expected response: {"ok":true}
```

**If you get "connection refused":**
```bash
# Start the backend
cd /Users/shivamkumar/KalshiExtension
npm start
```

### Step 2: Check Database Connection

```bash
# Test database connection
psql postgresql://localhost:5432/kalshi_parlay -c "SELECT 1"

# Expected: Should return "1" without errors
```

**If database doesn't exist:**
```bash
# Create the database
createdb kalshi_parlay

# Restart the server (tables will be created automatically)
npm start
```

**If PostgreSQL is not running:**
```bash
# macOS
brew services start postgresql@15

# Linux
sudo systemctl start postgresql
```

### Step 3: Test Backend API Directly

```bash
# Test adding a bet via curl
curl -X POST http://localhost:4000/api/parlay/test_user_123 \
  -H "Content-Type: application/json" \
  -d '{
    "marketId": "test-market",
    "marketTitle": "Test Market",
    "imageUrl": "https://example.com/image.png",
    "optionId": "test-option",
    "optionLabel": "Test Option",
    "prob": 50
  }'

# Expected: Should return the saved bet with an id
```

**If this works, the backend is fine. The issue is in the extension.**

### Step 4: Check Extension Permissions

1. Open `chrome://extensions/`
2. Find "Kalshi Parlay Helper"
3. Click "Details"
4. Scroll to "Site access"
5. Verify it has permission for:
   - `http://localhost:4000/*`
   - `https://kalshi.com/*`

**If permissions are missing:**
1. Remove the extension
2. Reload it from the folder
3. Chrome should request the permissions

### Step 5: Reload Extension Properly

**Important: After any code changes, you must:**

1. Go to `chrome://extensions/`
2. Find "Kalshi Parlay Helper"
3. Click the refresh/reload icon 🔄
4. Close and reopen the extension popup
5. If on a Kalshi page, hard refresh (Cmd+Shift+R or Ctrl+Shift+R)

### Step 6: Check Browser Console

1. Open the extension popup
2. Right-click anywhere in the popup
3. Select "Inspect"
4. Check the Console tab for errors

**Common errors and fixes:**

#### Error: "Failed to fetch"
- Backend is not running → Start with `npm start`
- CORS issue → Backend should have `app.use(cors())` (already configured)
- Wrong port → Check `BACKEND_BASE_URL` in `popup.js` matches your server port

#### Error: "NetworkError" or "CORS"
- Extension might not have host permissions
- Try removing and re-adding the extension

#### Error: "Could not establish connection"
- Content script issue (not related to parlay)
- This is expected if not on a Kalshi market page

### Step 7: Check Database Tables

```bash
# Verify tables exist
psql postgresql://localhost:5432/kalshi_parlay -c "\dt"

# Should show:
# - users
# - parlay_bets

# Check if data is being saved
psql postgresql://localhost:5432/kalshi_parlay -c "SELECT * FROM parlay_bets;"
```

### Step 8: Check Server Logs

Look at your terminal where `npm start` is running. You should see:

```
[DB] Database initialized successfully
Kalshi backend listening on http://localhost:4000
```

**If you see database errors:**
- Check your DATABASE_URL in `.env`
- Ensure PostgreSQL is running
- Verify you have permissions to the database

### Step 9: Use Test Page

I've created a test page for you:

```bash
# Open the test page
open test-connection.html
# or
google-chrome test-connection.html
```

Click the buttons to test:
- Health endpoint
- Add bet
- Get bets

This will show exactly where the connection is failing.

### Step 10: Verify Environment Variables

```bash
# Check .env file has DATABASE_URL
grep DATABASE_URL .env

# Should show something like:
# DATABASE_URL=postgresql://localhost:5432/kalshi_parlay
```

## Common Issues and Solutions

### Issue: Extension works but nothing persists

**Cause**: Database operations are failing silently

**Solution**:
1. Check server logs for database errors
2. Verify `.env` has correct `DATABASE_URL`
3. Test database connection manually
4. Restart the server after fixing `.env`

### Issue: "User ID not found" or similar

**Cause**: User creation is failing

**Solution**:
```bash
# Check users table
psql postgresql://localhost:5432/kalshi_parlay -c "SELECT * FROM users;"

# If empty and you're getting errors, check server logs
```

### Issue: Bets appear then disappear

**Cause**: Frontend and backend are out of sync

**Solution**:
1. Hard refresh the extension
2. Clear Chrome's extension storage:
   ```javascript
   // In browser console (Inspect popup):
   chrome.storage.local.clear()
   ```
3. Reload the extension

### Issue: "Failed to load parlay bets" on startup

**Cause**: GET endpoint is failing

**Solution**:
```bash
# Test GET endpoint
curl http://localhost:4000/api/parlay/test_user_123

# Should return: {"bets": [...]}
```

### Issue: Server crashes on startup

**Cause**: Database connection string is invalid

**Solution**:
1. Check `.env` file
2. Test connection string:
   ```bash
   psql "$DATABASE_URL" -c "SELECT 1"
   ```
3. Fix the connection string
4. Restart server

## Full Reset Procedure

If nothing works, do a complete reset:

```bash
# 1. Stop the server
pkill -f "node.*index.js"

# 2. Drop and recreate the database
dropdb kalshi_parlay
createdb kalshi_parlay

# 3. Clear extension storage
# In Chrome, open extension popup, right-click > Inspect
# In console, run:
chrome.storage.local.clear()

# 4. Restart the server
npm start

# 5. Reload the extension
# Go to chrome://extensions/ and click reload

# 6. Try adding a bet again
```

## Debugging Checklist

- [ ] Backend server is running (`curl http://localhost:4000/api/health`)
- [ ] Database is running (`psql $DATABASE_URL -c "SELECT 1"`)
- [ ] Tables exist (`psql $DATABASE_URL -c "\dt"`)
- [ ] .env has DATABASE_URL
- [ ] Extension is reloaded in Chrome
- [ ] Extension has host permissions for localhost:4000
- [ ] Browser console shows no CORS errors
- [ ] Server logs show no database errors
- [ ] Test page (test-connection.html) works

## Still Not Working?

If you've tried everything above:

1. **Check the exact error message**:
   - Open extension popup
   - Right-click > Inspect
   - Check Console tab
   - Copy the full error message

2. **Check server logs**:
   - Look at terminal where `npm start` is running
   - Copy any error messages

3. **Verify versions**:
   ```bash
   node --version  # Should be 18+
   npm --version
   psql --version  # Should be 12+
   ```

4. **Try a fresh install**:
   ```bash
   rm -rf node_modules package-lock.json
   npm install
   npm start
   ```

## Quick Test Commands

Run these to verify everything is working:

```bash
# Test backend health
curl http://localhost:4000/api/health

# Test database
psql postgresql://localhost:5432/kalshi_parlay -c "SELECT COUNT(*) FROM parlay_bets;"

# Test add bet
curl -X POST http://localhost:4000/api/parlay/test_123 \
  -H "Content-Type: application/json" \
  -d '{"marketId":"m1","marketTitle":"Test","imageUrl":"","optionId":"o1","optionLabel":"Yes","prob":50}'

# Test get bets
curl http://localhost:4000/api/parlay/test_123

# If all these work, the backend is fine!
# The issue is in the Chrome extension.
```

## Extension-Specific Issues

### Issue: Backend works, but extension doesn't

**Solution**: The extension popup runs in a sandboxed environment. Verify:

1. **manifest.json** has the right permissions:
   ```json
   "host_permissions": [
     "http://localhost:4000/*"
   ]
   ```

2. **popup.js** has the right backend URL:
   ```javascript
   const BACKEND_BASE_URL = "http://localhost:4000";
   ```

3. After ANY changes to these files:
   - Reload extension in chrome://extensions/
   - Close and reopen the popup

### Issue: Works on some pages, not others

This is expected! The extension only works on Kalshi market pages:
- ✅ `kalshi.com/markets/...`
- ❌ `kalshi.com` (homepage)
- ❌ `kalshi.com/portfolio`

## Need More Help?

Include this information when asking for help:
1. Error message from browser console
2. Error message from server logs
3. Output of `curl http://localhost:4000/api/health`
4. Output of `psql $DATABASE_URL -c "SELECT 1"`
5. Your operating system
6. Node.js version (`node --version`)


