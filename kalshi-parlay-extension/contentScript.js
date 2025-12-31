console.log("[ContentScript] ✅ Script loaded on:", window.location.href);

function extractMarketTitle() {
  // Try multiple strategies to find the actual market question
  
  // Strategy 1: Look for the main market question - usually contains a question mark
  // and is in the main content area, not sidebar
  const mainContent = document.querySelector('main') || document.body;
  const questionElements = mainContent.querySelectorAll('h1, h2, [data-testid*="market"], [class*="market-title"], [class*="question"]');
  
  for (const el of questionElements) {
    const text = el.textContent.trim();
    // Market questions typically contain question marks or are the main heading
    if (text && (text.includes('?') || el.tagName === 'H1')) {
      // Make sure it's not in a sidebar or navigation
      const isInSidebar = el.closest('[class*="sidebar"]') || el.closest('[class*="nav"]') || el.closest('[class*="menu"]');
      if (!isInSidebar && text.length > 10) {
        console.log("[ContentScript] Found market question:", text);
        return text;
      }
    }
  }
  
  // Strategy 2: Look for the first h1 in main content (most likely the market question)
  const mainH1 = mainContent.querySelector('h1');
  if (mainH1) {
    const text = mainH1.textContent.trim();
    if (text && text.length > 0) {
      console.log("[ContentScript] Found main h1:", text);
      return text;
    }
  }
  
  // Strategy 3: Look for data-testid attributes that might indicate market title
  const testIdSelectors = [
    '[data-testid*="market-title"]',
    '[data-testid*="market-question"]',
    '[data-testid*="question"]'
  ];
  for (const selector of testIdSelectors) {
    const el = document.querySelector(selector);
    if (el) {
      const text = el.textContent.trim();
      if (text && text.length > 0) {
        console.log("[ContentScript] Found via data-testid:", text);
        return text;
      }
    }
  }

  // Strategy 4: Fall back to the document title, but clean it up a bit.
  const rawTitle = document.title || "";
  const sepIdx = rawTitle.indexOf(" - ");
  if (sepIdx > 0) {
    const title = rawTitle.slice(0, sepIdx).trim();
    console.log("[ContentScript] Using document title:", title);
    return title;
  }
  
  const title = rawTitle.trim();
  if (title) {
    console.log("[ContentScript] Using full document title:", title);
    return title;
  }
  
  console.warn("[ContentScript] Could not find market title");
  return "Unknown Kalshi market";
}

function extractMarketImage() {
  console.log("[ContentScript] Attempting to extract market image...");
  
  // Look for the Series Image specifically (from Kalshi's DOM structure)
  const seriesImg = document.querySelector('img[alt="Series Image"]');
  console.log("[ContentScript] Series Image element:", seriesImg);
  
  if (seriesImg && seriesImg.src) {
    console.log("[ContentScript] Found Series Image:", seriesImg.src);
    return seriesImg.src;
  }

  // Fallback: look for any image near the top
  const candidateSelectors = [
    'main img',
    '[class*="market"] img',
    '[class*="card"] img',
  ];

  for (const selector of candidateSelectors) {
    const img = document.querySelector(selector);
    if (img && img.src) {
      console.log(`[ContentScript] Found fallback image with selector ${selector}:`, img.src);
      return img.src;
    }
  }

  console.log("[ContentScript] No image found");
  return null;
}

// Option names are now provided by the API - no DOM extraction needed

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  try {
    if (message && message.type === "GET_MARKET_INFO") {
      console.log("[ContentScript] Received GET_MARKET_INFO request - extracting title and image only");
      
      // Only extract title and image - option names come from API
      // This avoids any DOM queries that could cause screen control issues
      const marketTitle = extractMarketTitle();
      const marketImageUrl = extractMarketImage();
      
      console.log("[ContentScript] Sending response (option names from API):", { 
        marketTitle, 
        marketImageUrl, 
        optionNames: [] 
      });
      
      sendResponse({ 
        marketTitle, 
        marketImageUrl, 
        optionNames: [] // Empty - API provides all option names
      });
      return true;
    }
  } catch (error) {
    console.error("[ContentScript] Error in message listener:", error);
    sendResponse({ marketTitle: null, marketImageUrl: null, optionNames: [] });
    return true;
  }
  return true;
});


