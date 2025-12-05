#!/bin/bash
# Package Chrome extension for distribution (excludes backend files)

echo "📦 Packaging Chrome extension..."

# Create extension build directory
rm -rf extension-build
mkdir extension-build

# Copy extension files
cp manifest.json extension-build/
cp popup.html extension-build/
cp popup.js extension-build/
cp popup.css extension-build/
cp contentScript.js extension-build/
cp supabase.js extension-build/
cp -r public/ extension-build/

# Create ZIP file
cd extension-build
zip -r ../kalshi-parlay-extension.zip .
cd ..

echo "✅ Extension packaged: kalshi-parlay-extension.zip"
echo ""
echo "📋 Next steps:"
echo "1. Test the extension locally by loading 'extension-build' folder in Chrome"
echo "2. Distribute 'kalshi-parlay-extension.zip' to users"
echo "3. Users should extract and load via Developer Mode"

