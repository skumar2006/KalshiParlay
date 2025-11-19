const BACKEND_BASE_URL = "http://localhost:4000";

// Global state
let currentMarket = null;
let selectedOption = null;
let parlayBets = [];
let userId = null;

// Generate or retrieve userId from chrome.storage
async function getUserId() {
  if (userId) return userId;
  
  const result = await chrome.storage.local.get(['userId']);
  
  if (result.userId) {
    userId = result.userId;
  } else {
    // Generate a new unique ID
    userId = 'user_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    await chrome.storage.local.set({ userId });
  }
  
  return userId;
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

function isKalshiMarketUrl(url) {
  if (!url) return false;
  try {
    const u = new URL(url);
    return (
      (u.host === "kalshi.com" || u.host === "www.kalshi.com") &&
      u.pathname.startsWith("/markets")
    );
  } catch (e) {
    return false;
  }
}

function setMarketTitle(text) {
  const el = document.getElementById("market-title");
  if (!el) return;
  el.textContent = text;
}

function setMarketImage(src) {
  const img = document.getElementById("market-image");
  if (!img) return;

  if (src) {
    img.src = src;
    img.style.display = "block";
  } else {
    img.removeAttribute("src");
    img.style.display = "none";
  }
}

function extractMarketId(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    // Return the LAST segment, which is the actual market ticker
    return parts[parts.length - 1] || null;
  } catch (e) {
    return null;
  }
}

function renderOptions(contracts) {
  const container = document.getElementById("options-container");
  if (!container) return;

  container.innerHTML = "";

  if (!Array.isArray(contracts) || contracts.length === 0) {
    const row = document.createElement("div");
    row.className = "option-row placeholder";
    row.textContent = "No options found for this market.";
    container.appendChild(row);
    return;
  }

  contracts.forEach((c) => {
    const row = document.createElement("div");
    row.className = "option-row";
    row.dataset.contractId = c.id;

    const label = document.createElement("span");
    label.className = "option-label";
    label.textContent = c.label ?? c.id;

    const percent = document.createElement("span");
    percent.className = "option-percent";
    percent.textContent =
      typeof c.prob === "number" ? `${c.prob}%` : c.price != null ? c.price : "–";

    row.appendChild(label);
    row.appendChild(percent);
    
    // Add click handler
    row.addEventListener("click", () => selectOption(c));
    
    container.appendChild(row);
  });
}

function selectOption(contract) {
  // Deselect all options
  document.querySelectorAll(".option-row").forEach(row => {
    row.classList.remove("selected");
  });
  
  // Select clicked option
  const row = document.querySelector(`[data-contract-id="${contract.id}"]`);
  if (row) {
    row.classList.add("selected");
  }
  
  selectedOption = contract;
  
  // Enable "Add to Parlay" button
  const addBtn = document.getElementById("add-to-parlay-btn");
  if (addBtn) {
    addBtn.disabled = false;
  }
}

function renderParlay() {
  const container = document.getElementById("parlay-container");
  if (!container) return;
  
  container.innerHTML = "";
  
  if (parlayBets.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-parlay";
    empty.textContent = "No bets added yet";
    container.appendChild(empty);
    
    // Disable "Place Your Bet" button
    const placeBtn = document.getElementById("place-bet-btn");
    if (placeBtn) {
      placeBtn.disabled = true;
      placeBtn.title = "Add at least 2 bets to place a parlay";
    }
    return;
  }
  
  // Show message if only 1 bet
  if (parlayBets.length === 1) {
    const hint = document.createElement("div");
    hint.className = "parlay-hint";
    hint.textContent = "Add at least one more bet to place a parlay";
    hint.style.cssText = "padding: 8px; text-align: center; color: #666; font-size: 12px; background: #f8f9fa; border-radius: 8px; margin-bottom: 8px;";
    container.appendChild(hint);
  }
  
  parlayBets.forEach((bet) => {
    const item = document.createElement("div");
    item.className = "parlay-item";
    item.style.cursor = "pointer";
    item.title = `Click to open ${bet.marketTitle} on Kalshi`;
    
    const icon = document.createElement("div");
    icon.className = "parlay-item-icon";
    if (bet.imageUrl) {
      const img = document.createElement("img");
      img.src = bet.imageUrl;
      img.alt = "";
      icon.appendChild(img);
    }
    
    const info = document.createElement("div");
    info.className = "parlay-item-info";
    
    const title = document.createElement("div");
    title.className = "parlay-item-title";
    title.textContent = bet.marketTitle;
    
    const option = document.createElement("div");
    option.className = "parlay-item-option";
    option.textContent = bet.optionLabel;
    
    info.appendChild(title);
    info.appendChild(option);
    
    const prob = document.createElement("div");
    prob.className = "parlay-item-prob";
    prob.textContent = typeof bet.prob === "number" ? `${bet.prob}%` : "–";
    
    const deleteBtn = document.createElement("button");
    deleteBtn.className = "parlay-item-delete";
    deleteBtn.textContent = "×";
    deleteBtn.title = "Remove from parlay";
    deleteBtn.addEventListener("click", (e) => {
      e.stopPropagation(); // Prevent opening market when deleting
      removeBetFromParlay(bet.id);
    });
    
    // Add click handler to open market page
    item.addEventListener("click", () => {
      openMarketPage(bet.marketId);
    });
    
    item.appendChild(icon);
    item.appendChild(info);
    item.appendChild(prob);
    item.appendChild(deleteBtn);
    
    container.appendChild(item);
  });
  
  // Enable/disable "Place Your Bet" button based on bet count
  const placeBtn = document.getElementById("place-bet-btn");
  if (placeBtn) {
    if (parlayBets.length < 2) {
      placeBtn.disabled = true;
      placeBtn.title = "Add at least 2 bets to place a parlay";
    } else {
      placeBtn.disabled = false;
      placeBtn.title = "Place your parlay bet";
    }
  }
}

function openMarketPage(marketId) {
  if (!marketId) return;
  
  // Find the bet to get the stored URL
  const bet = parlayBets.find(b => b.marketId === marketId);
  
  if (bet && bet.marketUrl) {
    // Use the stored URL to navigate directly
    chrome.tabs.create({ url: bet.marketUrl });
  } else {
    // Fallback: use search on Kalshi with the market ID
    const searchUrl = `https://kalshi.com/markets?q=${encodeURIComponent(marketId)}`;
    chrome.tabs.create({ url: searchUrl });
  }
}

async function removeBetFromParlay(betId) {
  if (!betId) return;
  
  try {
    const uid = await getUserId();
    const res = await fetch(`${BACKEND_BASE_URL}/api/parlay/${uid}/${betId}`, {
      method: 'DELETE'
    });
    
    if (!res.ok) {
      throw new Error(`Failed to remove bet: ${res.status}`);
    }
    
    // Remove from local array
    parlayBets = parlayBets.filter(bet => bet.id !== betId);
    
    // Re-render parlay
    renderParlay();
    
    console.log("Bet removed successfully:", betId);
  } catch (err) {
    console.error("Failed to remove bet from parlay:", err);
    alert("Failed to remove bet. Please try again.");
  }
}

async function addToParlay() {
  if (!selectedOption || !currentMarket) return;
  
  // Check if already in parlay
  const alreadyAdded = parlayBets.some(bet => 
    bet.marketId === currentMarket.id && bet.optionId === selectedOption.id
  );
  
  if (alreadyAdded) {
    alert("This bet is already in your parlay!");
    return;
  }
  
  // Get the current tab URL to store with the bet
  const tab = await getActiveTab();
  const marketUrl = tab?.url || '';
  
  const newBet = {
    marketId: currentMarket.id,
    marketTitle: currentMarket.title,
    marketUrl: marketUrl,
    imageUrl: currentMarket.imageUrl,
    optionId: selectedOption.id,
    optionLabel: selectedOption.label,
    prob: selectedOption.prob,
    ticker: selectedOption.ticker || selectedOption.id || null // Kalshi ticker for API trading
  };
  
  try {
    const uid = await getUserId();
    const res = await fetch(`${BACKEND_BASE_URL}/api/parlay/${uid}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newBet)
    });
    
    if (!res.ok) {
      throw new Error(`Failed to add bet: ${res.status}`);
    }
    
    const data = await res.json();
    parlayBets.push(data.bet);
    
    renderParlay();
    
    // Deselect option and disable button
    document.querySelectorAll(".option-row").forEach(row => {
      row.classList.remove("selected");
    });
    selectedOption = null;
    
    const addBtn = document.getElementById("add-to-parlay-btn");
    if (addBtn) {
      addBtn.disabled = true;
    }
  } catch (err) {
    console.error("Failed to add bet to parlay:", err);
    alert("Failed to add bet to parlay. Please try again.");
  }
}

function showBetOverlay() {
  const overlay = document.getElementById("bet-overlay");
  if (!overlay) return;
  
  // Calculate combined probability
  const combinedProb = parlayBets.reduce((acc, bet) => {
    const prob = bet.prob / 100;
    return acc * prob;
  }, 1) * 100;
  
  // Populate modal with parlay items
  const modalList = document.getElementById("modal-parlay-list");
  if (modalList) {
    modalList.innerHTML = "";
    
    parlayBets.forEach(bet => {
      const item = document.createElement("div");
      item.className = "modal-parlay-item";
      
      // Add image icon
      const icon = document.createElement("div");
      icon.className = "modal-parlay-item-icon";
      if (bet.imageUrl) {
        const img = document.createElement("img");
        img.src = bet.imageUrl;
        img.alt = "";
        icon.appendChild(img);
      }
      
      const info = document.createElement("div");
      info.className = "modal-parlay-item-info";
      
      const title = document.createElement("div");
      title.className = "modal-parlay-item-title";
      title.textContent = bet.marketTitle;
      
      const option = document.createElement("div");
      option.className = "modal-parlay-item-option";
      option.textContent = bet.optionLabel;
      
      info.appendChild(title);
      info.appendChild(option);
      
      const prob = document.createElement("div");
      prob.className = "modal-parlay-item-prob";
      prob.textContent = typeof bet.prob === "number" ? `${bet.prob}%` : "–";
      
      item.appendChild(icon);
      item.appendChild(info);
      item.appendChild(prob);
      
      modalList.appendChild(item);
    });
  }
  
  // Hide combined probability section (no need to show user)
  const combinedProbEl = document.getElementById("combined-prob");
  if (combinedProbEl) {
    combinedProbEl.textContent = `${combinedProb.toFixed(2)}%`;
  }
  
  // Reset stake input
  const stakeInput = document.getElementById("stake-input");
  if (stakeInput) {
    stakeInput.value = "";
  }
  
  // Hide potential payout initially (only show after getting quote)
  const payoutEl = document.getElementById("potential-payout");
  if (payoutEl) {
    payoutEl.textContent = "Get quote to see payout";
  }
  
  // Disable get quote button initially
  const getQuoteBtn = document.getElementById("get-quote-btn");
  if (getQuoteBtn) {
    getQuoteBtn.disabled = true;
    getQuoteBtn.textContent = "Get Quote"; // Reset button text
    getQuoteBtn.onclick = getQuote; // Reset to getQuote function
  }
  
  // Show overlay
  overlay.classList.remove("hidden");
}

function closeBetOverlay() {
  const overlay = document.getElementById("bet-overlay");
  if (overlay) {
    overlay.classList.add("hidden");
  }
}

function calculatePayout() {
  const stakeInput = document.getElementById("stake-input");
  const payoutEl = document.getElementById("potential-payout");
  const getQuoteBtn = document.getElementById("get-quote-btn");
  
  if (!stakeInput || !payoutEl || !getQuoteBtn) return;
  
  const stake = parseFloat(stakeInput.value) || 0;
  
  if (stake <= 0) {
    payoutEl.textContent = "Get quote to see payout";
    getQuoteBtn.disabled = true;
    return;
  }
  
  // Don't show payout yet - user needs to get quote first
  payoutEl.textContent = "Click 'Get Quote' to see payout";
  getQuoteBtn.disabled = false;
}

async function getQuote() {
  const stakeInput = document.getElementById("stake-input");
  const stake = parseFloat(stakeInput?.value) || 0;
  
  if (stake <= 0) {
    alert("Please enter a valid stake amount");
    return;
  }
  
  const getQuoteBtn = document.getElementById("get-quote-btn");
  const potentialPayoutSpan = document.getElementById("potential-payout");
  const originalText = getQuoteBtn?.textContent || "Get Quote";
  
  try {
    // Show loading state
    if (getQuoteBtn) {
      getQuoteBtn.textContent = "Processing...";
      getQuoteBtn.disabled = true;
    }
    
    console.log("[Quote] Getting quote for stake:", stake);
    
    // Call the AI quote endpoint (silent - user doesn't see analysis)
    const res = await fetch(`${BACKEND_BASE_URL}/api/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bets: parlayBets.map(bet => ({
          marketTitle: bet.marketTitle,
          optionLabel: bet.optionLabel,
          prob: bet.prob
        })),
        stake: stake
      })
    });
    
    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(error.details || `Failed to get quote: ${res.status}`);
    }
    
    const result = await res.json();
    console.log("[Quote] Received quote:", result);
    
    // Update payout display
    if (potentialPayoutSpan && result.quote.payout) {
      potentialPayoutSpan.textContent = `$${result.quote.payout.adjustedPayout}`;
    }
    
    // Change button to "Place Parlay" and enable payment
    if (getQuoteBtn) {
      getQuoteBtn.textContent = "Place Parlay";
      getQuoteBtn.disabled = false;
      getQuoteBtn.onclick = () => placeParlayOrder(result.quote);
    }
    
  } catch (err) {
    console.error("[Quote] Failed to get quote:", err);
    alert(`Failed to get quote: ${err.message}\n\nPlease try again.`);
    
    // Reset button
    if (getQuoteBtn) {
      getQuoteBtn.textContent = originalText;
      getQuoteBtn.disabled = false;
    }
  }
}

// displayQuoteResults removed - quote processing is now silent

async function placeParlayOrder(quote) {
  try {
    // Get user ID
    const uid = await getUserId();
    
    console.log("[Payment] Creating Stripe checkout session...");
    
    // Create Stripe checkout session
    const res = await fetch(`${BACKEND_BASE_URL}/api/create-checkout-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: uid,
        stake: quote.stake,
        parlayBets: parlayBets,
        quote: quote
      })
    });
    
    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(error.details || `Failed to create checkout: ${res.status}`);
    }
    
    const { checkoutUrl } = await res.json();
    
    console.log("[Payment] Opening Stripe Checkout:", checkoutUrl);
    
    // Open Stripe Checkout in new tab
    chrome.tabs.create({ url: checkoutUrl });
    
    // Close the overlay
    closeBetOverlay();
    
  } catch (err) {
    console.error("[Payment] Failed to create checkout:", err);
    alert(`Failed to process payment: ${err.message}\n\nPlease try again.`);
  }
}

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

async function init() {
  const tab = await getActiveTab();

  if (!tab || !tab.url) {
    setMarketTitle("No active tab");
    hideMarketSection();
    await loadAndRenderParlay();
    return;
  }

  console.log("Current tab URL:", tab.url);

  // Check if it's a Kalshi market page
  if (!isKalshiMarketUrl(tab.url)) {
    // Hide the market section when not on Kalshi
    hideMarketSection();
    // But still load and show the parlay
    await loadAndRenderParlay();
    return;
  }
  
  // Show market section when on Kalshi
  showMarketSection();

  const marketId = extractMarketId(tab.url);
  console.log("Extracted market ID:", marketId);

  if (!marketId) {
    setMarketTitle("Could not extract market ID from URL");
    setMarketImage(null);
    renderOptions([]);
    return;
  }

  // First try: backend API (preferred, richer data).
  let backendSuccess = false;
  try {
    const res = await fetch(`${BACKEND_BASE_URL}/api/kalshi/market/${marketId}`);
    
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      console.error("Backend error:", res.status, errorData);
      throw new Error(`Backend error: ${res.status} - ${errorData.error || 'Unknown'}`);
    }
    
    const data = await res.json();
    console.log("Received market data:", data);

    // Store current market
    currentMarket = {
      id: marketId,
      title: data.title || `Market ${marketId}`,
      imageUrl: data.imageUrl || null,
      contracts: data.contracts || []
    };

    setMarketTitle(currentMarket.title);
    setMarketImage(currentMarket.imageUrl);
    renderOptions(currentMarket.contracts);
    backendSuccess = true;
  } catch (err) {
    console.error("Failed to load market from backend, falling back to DOM", err);
  }

  // Always try to get the title and image from the DOM (prioritize actual webpage content)
  try {
    console.log("Attempting to get title and image from DOM...");
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: "GET_MARKET_INFO",
    });

    console.log("DOM scraping response:", response);

    if (response) {
      // ALWAYS use DOM title if available (prioritize what user sees on page)
      if (response.marketTitle) {
        console.log("✅ Using title from DOM:", response.marketTitle);
        setMarketTitle(response.marketTitle);
        if (currentMarket) {
          currentMarket.title = response.marketTitle;
        }
      }
      
      // ALWAYS use the scraped image if available
      if (response.marketImageUrl) {
        console.log("✅ Setting image from DOM:", response.marketImageUrl);
        setMarketImage(response.marketImageUrl);
        if (currentMarket) {
          currentMarket.imageUrl = response.marketImageUrl;
        }
      } else {
        console.log("❌ No image found in DOM scrape");
      }
    } else {
      console.log("❌ No response from content script");
    }
  } catch (err) {
    console.error("❌ Failed to communicate with content script:", err);
    console.log("Make sure you've reloaded the Kalshi page after updating the extension.");
  }

  // Only render options if backend didn't already do it
  if (!backendSuccess) {
    renderOptions([]);
  }
  
  // Always load and show parlay at the end
  await loadAndRenderParlay();
}

// Helper function to load parlay and set up event listeners
async function loadAndRenderParlay() {
  // Load parlay bets from database
  try {
    const uid = await getUserId();
    const res = await fetch(`${BACKEND_BASE_URL}/api/parlay/${uid}`);
    
    if (res.ok) {
      const data = await res.json();
      parlayBets = data.bets || [];
      console.log("Loaded parlay bets:", parlayBets);
    }
  } catch (err) {
    console.error("Failed to load parlay bets:", err);
  }
  
  // Initialize parlay view
  renderParlay();
  
  // Set up event listeners (only once)
  setupEventListeners();
}

// Helper function to set up all event listeners
function setupEventListeners() {
  const addBtn = document.getElementById("add-to-parlay-btn");
  if (addBtn && !addBtn.hasListener) {
    addBtn.addEventListener("click", addToParlay);
    addBtn.hasListener = true;
  }
  
  const placeBtn = document.getElementById("place-bet-btn");
  if (placeBtn && !placeBtn.hasListener) {
    placeBtn.addEventListener("click", placeBet);
    placeBtn.hasListener = true;
  }
  
  // Set up overlay event listeners
  const closeOverlayBtn = document.getElementById("close-overlay-btn");
  if (closeOverlayBtn && !closeOverlayBtn.hasListener) {
    closeOverlayBtn.addEventListener("click", closeBetOverlay);
    closeOverlayBtn.hasListener = true;
  }
  
  const stakeInput = document.getElementById("stake-input");
  if (stakeInput && !stakeInput.hasListener) {
    stakeInput.addEventListener("input", calculatePayout);
    stakeInput.hasListener = true;
  }
  
  const getQuoteBtn = document.getElementById("get-quote-btn");
  if (getQuoteBtn && !getQuoteBtn.hasListener) {
    getQuoteBtn.addEventListener("click", getQuote);
    getQuoteBtn.hasListener = true;
  }
  
  // Close overlay when clicking outside the modal
  const overlay = document.getElementById("bet-overlay");
  if (overlay && !overlay.hasListener) {
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) {
        closeBetOverlay();
      }
    });
    overlay.hasListener = true;
  }
}

// Helper function to hide market section
function hideMarketSection() {
  const header = document.querySelector(".market-header");
  const options = document.querySelector(".market-options");
  const addBtn = document.getElementById("add-to-parlay-btn");
  
  if (header) header.style.display = "none";
  if (options) options.style.display = "none";
  if (addBtn) addBtn.style.display = "none";
}

// Helper function to show market section
function showMarketSection() {
  const header = document.querySelector(".market-header");
  const options = document.querySelector(".market-options");
  const addBtn = document.getElementById("add-to-parlay-btn");
  
  if (header) header.style.display = "flex";
  if (options) options.style.display = "block";
  if (addBtn) addBtn.style.display = "block";
}

document.addEventListener("DOMContentLoaded", init);


