console.log("[ContentScript] ✅ Script loaded on:", window.location.href);

function extractMarketTitle() {
  // Try a few strategies to infer the market title.

  // 1. Look for a prominent heading that might represent the market title.
  const headingSelectors = ["h1", "h2", '[data-testid*="market-title"]'];
  for (const selector of headingSelectors) {
    const el = document.querySelector(selector);
    if (el && el.textContent.trim().length > 0) {
      return el.textContent.trim();
    }
  }

  // 2. Fall back to the document title, but clean it up a bit.
  const rawTitle = document.title || "";
  const sepIdx = rawTitle.indexOf(" - ");
  if (sepIdx > 0) {
    return rawTitle.slice(0, sepIdx);
  }
  return rawTitle.trim() || "Unknown Kalshi market";
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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message && message.type === "GET_MARKET_INFO") {
    console.log("[ContentScript] Received GET_MARKET_INFO request");
    const marketTitle = extractMarketTitle();
    const marketImageUrl = extractMarketImage();
    console.log("[ContentScript] Sending response:", { marketTitle, marketImageUrl });
    sendResponse({ marketTitle, marketImageUrl });
  }
  return true; // Keep the message channel open for async response
});


