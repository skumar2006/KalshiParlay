/**
 * Popup Script
 * Main frontend logic for the Chrome extension popup
 */

// Import constants (Note: Chrome extensions don't support ES modules in content scripts)
// Using inline constants for now
const BACKEND_BASE_URL = "http://localhost:4000";
const MIN_BETS_FOR_PARLAY = 2;

// Global state
let currentMarket = null;
let selectedOption = null;
let parlayBets = [];
let userId = null;
let currentEnvironment = 'production'; // 'demo' or 'production'

// Generate or retrieve userId from chrome.storage (environment-specific)
async function getUserId(environment = 'production') {
  const storageKey = `userId_${environment}`;
  
  const result = await chrome.storage.local.get([storageKey]);
  
  if (result[storageKey]) {
    return result[storageKey];
  } else {
    // Generate a new unique ID for this environment
    const newUserId = `user_${environment}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    await chrome.storage.local.set({ [storageKey]: newUserId });
    return newUserId;
  }
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

/**
 * Detect if URL is a Kalshi market page (production or demo)
 * @param {string} url - URL to check
 * @returns {boolean} True if it's a Kalshi market URL
 */
function isKalshiMarketUrl(url) {
  if (!url) return false;
  try {
    const u = new URL(url);
    const isKalshiDomain = 
      u.host === "kalshi.com" || 
      u.host === "www.kalshi.com" ||
      u.host === "demo.kalshi.co";
    return isKalshiDomain && u.pathname.startsWith("/markets");
  } catch (e) {
    return false;
  }
}

/**
 * Detect which Kalshi environment (demo or production)
 * @param {string} url - URL to check
 * @returns {string} 'demo' or 'production'
 */
function getKalshiEnvironment(url) {
  if (!url) return 'production';
  try {
    const u = new URL(url);
    if (u.host === "demo.kalshi.co") {
      return 'demo';
    }
    return 'production';
  } catch (e) {
    return 'production';
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
    if (parlayBets.length < MIN_BETS_FOR_PARLAY) {
      placeBtn.disabled = true;
      placeBtn.title = `Add at least ${MIN_BETS_FOR_PARLAY} bets to place a parlay`;
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
    // Fallback: use search on Kalshi with the market ID (use correct environment)
    const baseUrl = currentEnvironment === 'demo' 
      ? 'https://demo.kalshi.co' 
      : 'https://kalshi.com';
    const searchUrl = `${baseUrl}/markets?q=${encodeURIComponent(marketId)}`;
    chrome.tabs.create({ url: searchUrl });
  }
}

async function removeBetFromParlay(betId) {
  if (!betId) return;
  
  try {
    const uid = await getUserId(currentEnvironment);
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
  
  // Check if already in parlay (only check bets from current environment)
  const alreadyAdded = parlayBets.some(bet => 
    bet.marketId === currentMarket.id && 
    bet.optionId === selectedOption.id &&
    bet.environment === currentEnvironment
  );
  
  if (alreadyAdded) {
    alert("This bet is already in your parlay!");
    return;
  }
  
  // Prevent mixing demo and production bets
  if (parlayBets.length > 0 && parlayBets[0].environment !== currentEnvironment) {
    const otherEnv = parlayBets[0].environment === 'demo' ? 'demo' : 'production';
    alert(`Cannot mix bets from different environments!\n\nYou have bets from ${otherEnv} environment.\nPlease clear your parlay or switch to the ${otherEnv} site.`);
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
    ticker: selectedOption.ticker || selectedOption.id || null, // Kalshi ticker for API trading
    environment: currentEnvironment // Store environment with bet
  };
  
  try {
    const uid = await getUserId(currentEnvironment);
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
    const uid = await getUserId(currentEnvironment);
    
    console.log("[Payment] Creating Stripe checkout session...");
    
    // Create Stripe checkout session
    const res = await fetch(`${BACKEND_BASE_URL}/api/create-checkout-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: uid,
        environment: currentEnvironment, // Include environment
        stake: quote.stake,
        parlayBets: parlayBets.map(bet => ({ ...bet, environment: currentEnvironment })),
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
  if (parlayBets.length < MIN_BETS_FOR_PARLAY) {
    alert(`You need at least ${MIN_BETS_FOR_PARLAY} bets to place a parlay!`);
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

  // Detect environment (demo or production)
  currentEnvironment = getKalshiEnvironment(tab.url);
  console.log(`Detected environment: ${currentEnvironment}`);

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
  
  // Load parlay history
  await loadParlayHistory();
  
  // Load wallet balance
  await loadWalletBalance();
}

// Helper function to load parlay and set up event listeners
async function loadAndRenderParlay() {
  // Load parlay bets from database (filter by current environment)
  try {
    const uid = await getUserId(currentEnvironment);
    const res = await fetch(`${BACKEND_BASE_URL}/api/parlay/${uid}?environment=${currentEnvironment}`);
    
    if (res.ok) {
      const data = await res.json();
      // Filter bets to only show those from current environment
      const allBets = data.bets || [];
      parlayBets = allBets.filter(bet => bet.environment === currentEnvironment);
      console.log(`Loaded ${parlayBets.length} parlay bets for ${currentEnvironment} environment:`, parlayBets);
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
  
  // Refresh parlay history button
  const refreshBtn = document.getElementById("refresh-parlays-btn");
  if (refreshBtn && !refreshBtn.hasListener) {
    refreshBtn.addEventListener("click", () => {
      loadParlayHistory();
    });
    refreshBtn.hasListener = true;
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

// Load and display parlay history
async function loadParlayHistory() {
  const container = document.getElementById("parlay-history-container");
  if (!container) return;
  
  try {
    container.innerHTML = '<div class="loading-parlays">Loading...</div>';
    
    const uid = await getUserId(currentEnvironment);
    const res = await fetch(`${BACKEND_BASE_URL}/api/parlay-history/${uid}`);
    
    if (!res.ok) {
      throw new Error(`Failed to load parlay history: ${res.status}`);
    }
    
    const data = await res.json();
    const parlays = data.parlays || [];
    
    if (parlays.length === 0) {
      container.innerHTML = '<div class="empty-parlay-history">No parlays yet. Place your first bet!</div>';
      return;
    }
    
    // Filter by current environment
    const filteredParlays = parlays.filter(p => {
      const parlayData = typeof p.parlay_data === 'string' ? JSON.parse(p.parlay_data) : p.parlay_data || [];
      return parlayData.length > 0 && parlayData[0].environment === currentEnvironment;
    });
    
    if (filteredParlays.length === 0) {
      container.innerHTML = `<div class="empty-parlay-history">No parlays for ${currentEnvironment} environment yet.</div>`;
      return;
    }
    
    container.innerHTML = '';
    
    filteredParlays.forEach(parlay => {
      const parlayCard = createParlayHistoryCard(parlay);
      container.appendChild(parlayCard);
    });
    
  } catch (err) {
    console.error("Failed to load parlay history:", err);
    container.innerHTML = '<div class="error-parlay-history">Failed to load parlay history. Please try again.</div>';
  }
}

function createParlayHistoryCard(parlay) {
  const card = document.createElement("div");
  card.className = "parlay-history-card";
  
  const parlayData = typeof parlay.parlay_data === 'string' ? JSON.parse(parlay.parlay_data) : parlay.parlay_data || [];
  const status = parlay.parlay_status || 'pending';
  const legOutcomes = parlay.legOutcomes || [];
  const claimableAmount = parseFloat(parlay.claimable_amount || 0);
  const claimed = !!parlay.claimed_at;
  
  // Status badge
  const statusBadge = document.createElement("div");
  statusBadge.className = `parlay-status-badge status-${status}`;
  statusBadge.textContent = status.toUpperCase();
  
  // Header
  const header = document.createElement("div");
  header.className = "parlay-history-header";
  
  const headerLeft = document.createElement("div");
  headerLeft.className = "parlay-history-header-left";
  
  const date = document.createElement("div");
  date.className = "parlay-history-date";
  const completedDate = new Date(parlay.completed_at);
  date.textContent = completedDate.toLocaleDateString() + ' ' + completedDate.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
  
  const stake = document.createElement("div");
  stake.className = "parlay-history-stake";
  stake.textContent = `Stake: $${parseFloat(parlay.stake).toFixed(2)}`;
  
  headerLeft.appendChild(date);
  headerLeft.appendChild(stake);
  
  header.appendChild(headerLeft);
  header.appendChild(statusBadge);
  
  // Legs
  const legsContainer = document.createElement("div");
  legsContainer.className = "parlay-history-legs";
  
  parlayData.forEach((leg, index) => {
    const legItem = document.createElement("div");
    legItem.className = "parlay-history-leg";
    
    const legOutcome = legOutcomes.find(o => o.leg_number === index + 1);
    const legStatus = legOutcome?.outcome || 'pending';
    const legSettled = legOutcome?.market_status === 'settled';
    
    if (legSettled) {
      legItem.classList.add(`leg-${legStatus}`);
    } else {
      legItem.classList.add('leg-pending');
    }
    
    const legIcon = document.createElement("div");
    legIcon.className = "parlay-history-leg-icon";
    if (leg.imageUrl) {
      const img = document.createElement("img");
      img.src = leg.imageUrl;
      img.alt = "";
      legIcon.appendChild(img);
    }
    
    const legInfo = document.createElement("div");
    legInfo.className = "parlay-history-leg-info";
    
    const legTitle = document.createElement("div");
    legTitle.className = "parlay-history-leg-title";
    legTitle.textContent = leg.marketTitle;
    
    const legOption = document.createElement("div");
    legOption.className = "parlay-history-leg-option";
    legOption.textContent = leg.optionLabel;
    
    legInfo.appendChild(legTitle);
    legInfo.appendChild(legOption);
    
    const legStatusIcon = document.createElement("div");
    legStatusIcon.className = "parlay-history-leg-status";
    if (legSettled) {
      legStatusIcon.textContent = legStatus === 'win' ? '✓' : '✗';
      legStatusIcon.classList.add(legStatus === 'win' ? 'status-win' : 'status-loss');
    } else {
      legStatusIcon.textContent = '⏳';
      legStatusIcon.classList.add('status-pending');
    }
    
    legItem.appendChild(legIcon);
    legItem.appendChild(legInfo);
    legItem.appendChild(legStatusIcon);
    
    legsContainer.appendChild(legItem);
  });
  
  // Footer
  const footer = document.createElement("div");
  footer.className = "parlay-history-footer";
  
  const payoutInfo = document.createElement("div");
  payoutInfo.className = "parlay-history-payout";
  payoutInfo.innerHTML = `
    <span>Potential Payout:</span>
    <span class="payout-amount">$${parseFloat(parlay.payout).toFixed(2)}</span>
  `;
  
  footer.appendChild(payoutInfo);
  
  // Claim button (if won and not claimed)
  if (status === 'won' && claimableAmount > 0 && !claimed) {
    const claimBtn = document.createElement("button");
    claimBtn.className = "claim-winnings-btn";
    claimBtn.textContent = `Claim $${claimableAmount.toFixed(2)}`;
    claimBtn.onclick = () => claimWinnings(parlay.session_id, claimableAmount);
    footer.appendChild(claimBtn);
  } else if (status === 'won' && claimed) {
    const claimedBadge = document.createElement("div");
    claimedBadge.className = "claimed-badge";
    claimedBadge.textContent = "✓ Claimed";
    footer.appendChild(claimedBadge);
  }
  
  // Assemble card
  card.appendChild(header);
  card.appendChild(legsContainer);
  card.appendChild(footer);
  
  return card;
}

async function claimWinnings(sessionId, amount) {
  if (!confirm(`Claim $${amount.toFixed(2)} in winnings?`)) {
    return;
  }
  
  try {
    const res = await fetch(`${BACKEND_BASE_URL}/api/claim-winnings/${sessionId}`, {
      method: 'POST'
    });
    
    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(error.error || `Failed to claim: ${res.status}`);
    }
    
    const data = await res.json();
    alert(`Success! $${amount.toFixed(2)} has been added to your account balance.`);
    
    // Reload parlay history
    await loadParlayHistory();
    
    // Reload wallet balance if there's a wallet display
    await loadWalletBalance();
    
  } catch (err) {
    console.error("Failed to claim winnings:", err);
    alert(`Failed to claim winnings: ${err.message}`);
  }
}

async function loadWalletBalance() {
  try {
    const uid = await getUserId(currentEnvironment);
    const res = await fetch(`${BACKEND_BASE_URL}/api/wallet/${uid}`);
    
    if (res.ok) {
      const data = await res.json();
      const balance = parseFloat(data.balance || 0);
      
      // Update wallet display if it exists
      const walletDisplay = document.getElementById("wallet-balance");
      if (walletDisplay) {
        walletDisplay.textContent = `$${balance.toFixed(2)}`;
      }
    }
  } catch (err) {
    console.error("Failed to load wallet balance:", err);
  }
}

document.addEventListener("DOMContentLoaded", init);


