#!/bin/bash

# Diagnostic script for Kalshi Parlay Helper
# Run this to diagnose issues with the extension

echo "🔍 Kalshi Parlay Helper - Diagnostic Tool"
echo "=========================================="
echo ""

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

passed=0
failed=0

check_pass() {
    echo -e "${GREEN}✓${NC} $1"
    ((passed++))
}

check_fail() {
    echo -e "${RED}✗${NC} $1"
    ((failed++))
}

check_warn() {
    echo -e "${YELLOW}⚠${NC} $1"
}

# Check 1: Node.js
echo "1️⃣  Checking Node.js..."
if command -v node &> /dev/null; then
    NODE_VERSION=$(node -v)
    check_pass "Node.js installed: $NODE_VERSION"
else
    check_fail "Node.js not found. Please install Node.js 18+"
fi
echo ""

# Check 2: npm
echo "2️⃣  Checking npm..."
if command -v npm &> /dev/null; then
    check_pass "npm is installed"
else
    check_fail "npm not found"
fi
echo ""

# Check 3: PostgreSQL
echo "3️⃣  Checking PostgreSQL..."
if command -v psql &> /dev/null; then
    check_pass "PostgreSQL is installed"
    
    # Check if database exists
    if psql -lqt 2>/dev/null | cut -d \| -f 1 | grep -qw kalshi_parlay; then
        check_pass "kalshi_parlay database exists"
    else
        check_fail "kalshi_parlay database does not exist"
        echo "   Fix: createdb kalshi_parlay"
    fi
else
    check_fail "PostgreSQL not found"
    echo "   Fix: brew install postgresql@15  (macOS)"
    echo "        sudo apt-get install postgresql  (Ubuntu)"
fi
echo ""

# Check 4: .env file
echo "4️⃣  Checking .env file..."
if [ -f ".env" ]; then
    check_pass ".env file exists"
    
    if grep -q "DATABASE_URL=" .env; then
        DATABASE_URL=$(grep "DATABASE_URL=" .env | cut -d '=' -f 2)
        check_pass "DATABASE_URL is set"
        
        # Test database connection
        if psql "$DATABASE_URL" -c "SELECT 1" &> /dev/null; then
            check_pass "Database connection successful"
        else
            check_fail "Cannot connect to database"
            echo "   DATABASE_URL: $DATABASE_URL"
        fi
    else
        check_fail "DATABASE_URL not set in .env"
    fi
    
    if grep -q "KALSHI_API_KEY=" .env; then
        check_pass "KALSHI_API_KEY is set"
    else
        check_warn "KALSHI_API_KEY not set (needed for market data)"
    fi
else
    check_fail ".env file not found"
    echo "   Fix: Create .env file with DATABASE_URL"
fi
echo ""

# Check 5: node_modules
echo "5️⃣  Checking dependencies..."
if [ -d "node_modules" ]; then
    check_pass "node_modules exists"
    
    if [ -d "node_modules/pg" ]; then
        check_pass "pg (PostgreSQL client) installed"
    else
        check_fail "pg not installed"
        echo "   Fix: npm install"
    fi
else
    check_fail "node_modules not found"
    echo "   Fix: npm install"
fi
echo ""

# Check 6: Backend server
echo "6️⃣  Checking backend server..."
if lsof -ti:4000 &> /dev/null; then
    check_pass "Server is running on port 4000"
    
    # Test health endpoint
    if curl -s http://localhost:4000/api/health | grep -q "ok"; then
        check_pass "Health endpoint responding"
    else
        check_fail "Health endpoint not responding correctly"
    fi
    
    # Test parlay endpoint
    TEST_USER="diagnose_test_$(date +%s)"
    RESULT=$(curl -s -X POST http://localhost:4000/api/parlay/$TEST_USER \
        -H "Content-Type: application/json" \
        -d '{"marketId":"test","marketTitle":"Test","imageUrl":"","optionId":"test","optionLabel":"Test","prob":50}')
    
    if echo "$RESULT" | grep -q "\"id\""; then
        check_pass "Parlay API endpoint working"
        # Clean up test data
        curl -s -X DELETE http://localhost:4000/api/parlay/$TEST_USER &> /dev/null
    else
        check_fail "Parlay API endpoint not working"
        echo "   Response: $RESULT"
    fi
else
    check_fail "Server is not running on port 4000"
    echo "   Fix: npm start"
fi
echo ""

# Check 7: Database tables
echo "7️⃣  Checking database tables..."
if [ -f ".env" ] && grep -q "DATABASE_URL=" .env; then
    DATABASE_URL=$(grep "DATABASE_URL=" .env | cut -d '=' -f 2)
    
    if psql "$DATABASE_URL" -c "\dt" 2>/dev/null | grep -q "users"; then
        check_pass "users table exists"
    else
        check_fail "users table does not exist"
        echo "   Fix: Restart the server (tables are created automatically)"
    fi
    
    if psql "$DATABASE_URL" -c "\dt" 2>/dev/null | grep -q "parlay_bets"; then
        check_pass "parlay_bets table exists"
    else
        check_fail "parlay_bets table does not exist"
        echo "   Fix: Restart the server (tables are created automatically)"
    fi
fi
echo ""

# Check 8: Extension files
echo "8️⃣  Checking extension files..."
REQUIRED_FILES=("manifest.json" "popup.html" "popup.js" "popup.css" "contentScript.js")
for file in "${REQUIRED_FILES[@]}"; do
    if [ -f "$file" ]; then
        check_pass "$file exists"
    else
        check_fail "$file not found"
    fi
done
echo ""

# Summary
echo "=========================================="
echo "📊 Summary"
echo "=========================================="
echo -e "${GREEN}Passed: $passed${NC}"
echo -e "${RED}Failed: $failed${NC}"
echo ""

if [ $failed -eq 0 ]; then
    echo -e "${GREEN}🎉 All checks passed!${NC}"
    echo ""
    echo "If you're still having issues:"
    echo "1. Reload the extension in chrome://extensions/"
    echo "2. Check browser console (right-click popup > Inspect)"
    echo "3. See TROUBLESHOOTING.md for more help"
else
    echo -e "${RED}⚠️  $failed check(s) failed${NC}"
    echo ""
    echo "Fix the issues above, then:"
    echo "1. Run this script again to verify"
    echo "2. Restart the server: npm start"
    echo "3. Reload the extension in chrome://extensions/"
    echo ""
    echo "For detailed help, see TROUBLESHOOTING.md"
fi
echo ""


