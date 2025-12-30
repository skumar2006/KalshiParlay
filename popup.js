/**
 * Popup Script
 * Main frontend logic for the Chrome extension popup
 */

// Import constants (Note: Chrome extensions don't support ES modules in content scripts)
// Using inline constants for now
let BACKEND_BASE_URL = "http://localhost:4000"; // Will be updated from config
const MIN_BETS_FOR_PARLAY = 2;

// Supabase configuration - loaded from backend config endpoint
let SUPABASE_URL = null;
let SUPABASE_ANON_KEY = null;
let supabase = null;

// Load backend URL and Supabase config from backend
async function loadBackendConfig() {
  try {
    // FORCE localhost for development
    BACKEND_BASE_URL = "http://localhost:4000";
    console.log(`[Config] Using localhost: ${BACKEND_BASE_URL}`);
    
    // Clear any stored Railway URL
    await chrome.storage.sync.remove('backendUrl');
    
    // Try localhost directly
    const res = await fetch(`${BACKEND_BASE_URL}/api/config`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    if (!res.ok) {
      throw new Error(`Failed to load config: ${res.status}`);
    }
    
    const backendConfig = await res.json();
    console.log('[Config] Received config:', { 
      hasSupabaseUrl: !!backendConfig.supabaseUrl,
      hasSupabaseAnonKey: !!backendConfig.supabaseAnonKey,
      backendUrl: backendConfig.backendUrl 
    });
    
    SUPABASE_URL = backendConfig.supabaseUrl;
    SUPABASE_ANON_KEY = backendConfig.supabaseAnonKey;
    
    // Don't update BACKEND_BASE_URL from config - keep localhost
    // The backend config might return a Railway URL, but we want to stay on localhost
    
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      console.error('[Config] ❌ Supabase credentials missing from backend config');
      console.error('[Config] Received:', backendConfig);
      return false;
    }
    
    console.log('[Config] ✅ Supabase credentials loaded successfully');
    return true;
  } catch (err) {
    console.error('[Config] ❌ Failed to load backend config:', err);
    console.error('[Config] Error details:', {
      message: err.message,
      stack: err.stack
    });
    return false;
  }
}

// Alias for backward compatibility
async function loadSupabaseConfig() {
  return loadBackendConfig();
}

// Initialize Supabase after scripts load
async function initSupabase() {
  // First, load config from backend
  const configLoaded = await loadBackendConfig();
  if (!configLoaded) {
    console.error('Failed to load Supabase config from backend');
    return false;
  }
  
  if (typeof window === 'undefined' || !window.supabase) {
    console.warn('Supabase library not loaded. Make sure supabase.js is included in popup.html');
    return false;
  }
  
  try {
    supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false
      }
    });
    console.log('Supabase client initialized successfully');
    return true;
  } catch (err) {
    console.error('Error initializing Supabase client:', err);
    return false;
  }
}

// Helper functions for loading states
function showLoading(element) {
  if (element) {
    element.classList.add('loading');
  }
}

function hideLoading(element) {
  if (element) {
    element.classList.remove('loading');
  }
}

// Track when loading started to ensure minimum display time
let loadingStartTime = Date.now();
const MIN_LOADING_TIME = 1000; // 1 second minimum
let initialLoadingHidden = false;

function hideInitialLoading() {
  if (initialLoadingHidden) return;
  initialLoadingHidden = true;
  
  const initialLoading = document.getElementById('initial-loading');
  if (!initialLoading) return;
  
  const elapsed = Date.now() - loadingStartTime;
  const remainingTime = Math.max(0, MIN_LOADING_TIME - elapsed);
  
  setTimeout(() => {
    initialLoading.classList.add('hidden');
    setTimeout(() => {
      initialLoading.style.display = 'none';
    }, 200); // Faster fade out
  }, remainingTime);
}

// Main initialization function - ensures Supabase is ready before app init
async function initializeApp() {
  // Track loading start time
  loadingStartTime = Date.now();
  
  // CRITICAL: Hide loading screen immediately so login overlay can show
  hideInitialLoading();
  
  // CRITICAL: Show login overlay IMMEDIATELY before anything else
  // This ensures users can always access the login page
  const loginOverlay = document.getElementById('login-overlay');
  const appContent = document.querySelector('.app');
  
  console.log('initializeApp: loginOverlay found?', !!loginOverlay);
  console.log('initializeApp: appContent found?', !!appContent);
  
  // Force login overlay to be visible and app to be hidden
  if (loginOverlay) {
    loginOverlay.classList.remove('hidden');
    loginOverlay.style.display = 'flex'; // Force display to override any CSS
    loginOverlay.style.visibility = 'visible';
    loginOverlay.style.opacity = '1';
    loginOverlay.style.zIndex = '1000';
    loginOverlay.style.position = 'fixed';
    loginOverlay.style.top = '0';
    loginOverlay.style.left = '0';
    loginOverlay.style.right = '0';
    loginOverlay.style.bottom = '0';
    loginOverlay.style.width = '100%';
    loginOverlay.style.height = '100%';
    loginOverlay.style.background = 'rgba(0, 0, 0, 0.7)';
    console.log('initializeApp: Forced login overlay visible');
    console.log('initializeApp: Login overlay computed display:', window.getComputedStyle(loginOverlay).display);
    console.log('initializeApp: Login overlay position:', loginOverlay.getBoundingClientRect());
    console.log('initializeApp: Body dimensions:', document.body.offsetWidth, 'x', document.body.offsetHeight);
    console.log('initializeApp: Window dimensions:', window.innerWidth, 'x', window.innerHeight);
  } else {
    console.error('initializeApp: Login overlay element NOT FOUND!');
  }
  if (appContent) {
    appContent.style.display = 'none';
  }
  
  // Now setup auth UI (which will set up event listeners)
  // setupAuthUI returns the updateUIForAuth function
  const updateUIForAuth = setupAuthUI();
  
  // Double-check login overlay is visible right after setup
  if (loginOverlay) {
    loginOverlay.classList.remove('hidden');
    loginOverlay.style.display = 'flex';
    loginOverlay.style.visibility = 'visible';
    loginOverlay.style.opacity = '1';
    loginOverlay.style.zIndex = '1000';
    console.log('initializeApp: Double-checked login overlay visibility after setupAuthUI');
  }
  
  // Wait for Supabase to initialize
  const supabaseReady = await initSupabase();
  
  if (!supabaseReady) {
    console.error('Failed to initialize Supabase. Please check your backend server and .env configuration.');
    // Show error in login form if available
    const loginError = document.getElementById('login-error-message');
    if (loginError) {
      loginError.textContent = '⚠️ Failed to connect to backend. Make sure your server is running and SUPABASE_URL/SUPABASE_ANON_KEY are set in .env';
      loginError.classList.remove('hidden');
      loginError.style.color = '#ff6b6b';
    }
    // Ensure login overlay is still visible
    if (loginOverlay) {
      loginOverlay.classList.remove('hidden');
      loginOverlay.style.display = 'flex';
    }
    return;
  }
  
  // Now that Supabase is ready, trigger an initial auth check
  // The auth state change listener is already set up in setupAuthUI
  // But we need to call updateUIForAuth to check the current auth state
  if (updateUIForAuth) {
    // Trigger initial auth check now that Supabase is ready
    await updateUIForAuth();
  }
  
  // Now proceed with app initialization (which will check auth and show/hide UI accordingly)
  await init();
}

// CRITICAL: Show login overlay IMMEDIATELY, synchronously, before anything else
// This must happen before any async operations
(function showLoginOverlayImmediately() {
  const loginOverlay = document.getElementById('login-overlay');
  const appContent = document.querySelector('.app');
  
  if (loginOverlay) {
    loginOverlay.classList.remove('hidden');
    loginOverlay.style.cssText = 'display: flex !important; visibility: visible !important; opacity: 1 !important; position: fixed !important; top: 0 !important; left: 0 !important; right: 0 !important; bottom: 0 !important; width: 100% !important; height: 100% !important; z-index: 1000 !important; background: rgba(0, 0, 0, 0.7) !important;';
  }
  if (appContent) {
    appContent.style.display = 'none';
  }
})();

// Initialize when DOM is ready (scripts should be loaded by then)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeApp);
} else {
  // DOM already loaded
  initializeApp();
}

// Global state
let currentMarket = null;
let selectedOption = null;
let parlayBets = [];
let userId = null;
let visibleOptionsCount = 3; // Number of options to show initially
let currentEnvironment = 'production'; // 'demo' or 'production'

// Get authenticated user ID (UUID from Supabase Auth)
async function getUserId(environment = 'production') {
  if (!supabase) {
    throw new Error('Supabase client not initialized. Please check SUPABASE_URL and SUPABASE_ANON_KEY.');
  }
  
  const { data: { session }, error } = await supabase.auth.getSession();
  
  if (error) {
    console.error('Error getting session:', error);
    throw error;
  }
  
  if (!session || !session.user) {
    throw new Error('User not authenticated');
  }
  
  // CRITICAL: Verify user has an email (user must exist in Supabase)
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user || !user.email) {
    // User deleted or no email - sign them out
    console.warn('User has no email or account deleted - signing out');
    await supabase.auth.signOut();
    throw new Error('User not authenticated - account no longer exists');
  }
  
  return user.id; // UUID from Supabase Auth
}

// Auth functions
async function checkAuthStatus() {
  if (!supabase) {
    console.warn('Supabase not initialized - user not authenticated');
    return false;
  }
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      return false;
    }
    
    // CRITICAL: Verify user has an email (user must exist in Supabase)
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user || !user.email) {
      // User deleted or no email - sign them out
      console.warn('User has no email or account deleted - signing out');
      await supabase.auth.signOut();
      return false;
    }
    
    return true;
  } catch (err) {
    console.error('Error checking auth status:', err);
    return false;
  }
}

async function getCurrentUser() {
  if (!supabase) return null;
  try {
    const { data: { user } } = await supabase.auth.getUser();
    return user;
  } catch (err) {
    console.error('Error getting current user:', err);
    return null;
  }
}

async function login(email, password) {
  if (!supabase) throw new Error('Supabase not initialized');
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  });
  return { data, error };
}

async function signup(email, password) {
  if (!supabase) throw new Error('Supabase not initialized');
  
  // Get backend URL for email redirect (use production URL)
  const backendUrl = BACKEND_BASE_URL || 'https://kalshiparlay-production.up.railway.app';
  
  // Attempt signup - Supabase handles duplicates securely
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${backendUrl}/auth/callback`
    }
  });
  
  // Supabase returns success even for existing emails (security feature to prevent email enumeration)
  // However, we can detect existing accounts by checking the response structure:
  // - If user.email_confirmed_at is set AND no session was created, account already exists
  // - If user.email_confirmed_at is null/undefined, it's a new unconfirmed account
  if (!error && data?.user) {
    // Key indicator: If user has email_confirmed_at set, they already existed and were confirmed
    // Supabase won't create a duplicate, so this means the account already exists
    if (data.user.email_confirmed_at && !data.session) {
      return {
        data: null,
        error: {
          message: 'An account with this email already exists. Please login instead.',
          code: 'user_already_exists'
        }
      };
    }
    
    // If no session was created and email_confirmed_at is null, it's either:
    // 1. New unconfirmed user (needs email confirmation) - SUCCESS
    // 2. Existing unconfirmed user (will receive another confirmation email) - Still OK
    // We show success message in both cases
  }
  
  return { data, error };
}

async function logout() {
  if (!supabase) return;
  const { error } = await supabase.auth.signOut();
  if (error) {
    console.error('Logout error:', error);
  }
  return { error };
}

// Helper function to add auth headers to fetch requests
async function getAuthHeaders() {
  if (!supabase) return { 'Content-Type': 'application/json' };
  
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      throw new Error('No active session');
    }
    
    return {
      'Authorization': `Bearer ${session.access_token}`,
      'Content-Type': 'application/json'
    };
  } catch (err) {
    console.error('Error getting auth headers:', err);
    return { 'Content-Type': 'application/json' };
  }
}

// Helper function to make authenticated fetch requests
async function authenticatedFetch(url, options = {}) {
  const headers = await getAuthHeaders();
  const mergedOptions = {
    ...options,
    headers: {
      ...headers,
      ...(options.headers || {})
    }
  };
  return fetch(url, mergedOptions);
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

  console.log(`[renderOptions] Rendering ${contracts?.length || 0} contracts`);
  if (contracts && contracts.length > 0) {
    console.log(`[renderOptions] First contract label: "${contracts[0].label}"`);
  }

  container.innerHTML = "";

  if (!Array.isArray(contracts) || contracts.length === 0) {
    const row = document.createElement("div");
    row.className = "option-row placeholder";
    row.textContent = "No options found for this market.";
    container.appendChild(row);
    return;
  }

  // Check if contracts are in new format (with yes/no) or old format (flat array)
  const isNewFormat = contracts.length > 0 && contracts[0].hasOwnProperty('yes') && contracts[0].hasOwnProperty('no');
  
  if (isNewFormat) {
    // Sort contracts by YES probability (highest to lowest)
    const sortedContracts = [...contracts].sort((a, b) => {
      const aProb = a.yes?.prob || a.yes?.price || 0;
      const bProb = b.yes?.prob || b.yes?.price || 0;
      return bProb - aProb; // Descending order
    });
    
    // Determine how many to show
    const totalOptions = sortedContracts.length;
    const optionsToShow = Math.min(visibleOptionsCount, totalOptions);
    const optionsToRender = sortedContracts.slice(0, optionsToShow);
    
    // Render visible options
    optionsToRender.forEach((option) => {
      const optionCard = document.createElement("div");
      optionCard.className = "option-card";
      
      // Add option image if available
      if (option.imageUrl) {
        const optionIcon = document.createElement("div");
        optionIcon.className = "option-card-icon";
        const img = document.createElement("img");
        img.src = option.imageUrl;
        img.alt = option.label || "";
        img.onerror = function() {
          // Hide icon if image fails to load
          optionIcon.style.display = "none";
        };
        optionIcon.appendChild(img);
        optionCard.appendChild(optionIcon);
      }
      
      const label = document.createElement("div");
      label.className = "option-card-label";
      label.textContent = option.label || "Unknown";
      
      const buttonsContainer = document.createElement("div");
      buttonsContainer.className = "option-buttons";
      
      // YES button
      if (option.yes) {
        const yesBtn = document.createElement("button");
        yesBtn.className = "option-btn option-btn-yes";
        yesBtn.dataset.contractId = option.yes.id;
        yesBtn.dataset.side = "YES";
        
        const yesLabel = document.createElement("span");
        yesLabel.className = "option-btn-label";
        yesLabel.textContent = "YES";
        
        const yesProb = document.createElement("span");
        yesProb.className = "option-btn-prob";
        yesProb.textContent = typeof option.yes.prob === "number" 
          ? `${option.yes.prob.toFixed(1)}%` 
          : option.yes.price != null 
            ? `${option.yes.price.toFixed(1)}%` 
            : "–";
        
        yesBtn.appendChild(yesLabel);
        yesBtn.appendChild(yesProb);
        yesBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          selectOption(option.yes, option.label, option);
        });
        
        buttonsContainer.appendChild(yesBtn);
      }
      
      // NO button
      if (option.no) {
        const noBtn = document.createElement("button");
        noBtn.className = "option-btn option-btn-no";
        noBtn.dataset.contractId = option.no.id;
        noBtn.dataset.side = "NO";
        
        const noLabel = document.createElement("span");
        noLabel.className = "option-btn-label";
        noLabel.textContent = "NO";
        
        const noProb = document.createElement("span");
        noProb.className = "option-btn-prob";
        noProb.textContent = typeof option.no.prob === "number" 
          ? `${option.no.prob.toFixed(1)}%` 
          : option.no.price != null 
            ? `${option.no.price.toFixed(1)}%` 
            : "–";
        
        noBtn.appendChild(noLabel);
        noBtn.appendChild(noProb);
        noBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          selectOption(option.no, option.label, option);
        });
        
        buttonsContainer.appendChild(noBtn);
      }
      
      optionCard.appendChild(label);
      optionCard.appendChild(buttonsContainer);
      container.appendChild(optionCard);
    });
    
    // Add "Show more" button if there are more options to show
    if (totalOptions > visibleOptionsCount) {
      const showMoreBtn = document.createElement("button");
      showMoreBtn.className = "show-more-btn";
      showMoreBtn.textContent = "Show more";
      showMoreBtn.addEventListener("click", () => {
        // Show 3-5 more options
        visibleOptionsCount = Math.min(visibleOptionsCount + 5, totalOptions);
        renderOptions(contracts); // Re-render with new count
      });
      container.appendChild(showMoreBtn);
    }
  } else {
    // Old format: flat array of contracts (backward compatibility)
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
        typeof c.prob === "number" ? `${c.prob.toFixed(1)}%` : c.price != null ? `${c.price.toFixed(1)}%` : "–";

      row.appendChild(label);
      row.appendChild(percent);
      
      // Add click handler
      row.addEventListener("click", () => selectOption(c));
      
      container.appendChild(row);
    });
  }
}

function selectOption(contract, optionLabel = null, parentOption = null) {
  // Deselect all options (both old and new format)
  document.querySelectorAll(".option-row").forEach(row => {
    row.classList.remove("selected");
  });
  document.querySelectorAll(".option-btn").forEach(btn => {
    btn.classList.remove("selected");
  });
  
  // Select clicked option
  const element = document.querySelector(`[data-contract-id="${contract.id}"]`);
  if (element) {
    element.classList.add("selected");
  }
  
  // Store selected option with enhanced label and imageUrl from parent option
  selectedOption = {
    ...contract,
    optionLabel: optionLabel || contract.label,
    displayLabel: optionLabel ? `${optionLabel} ${contract.side || ''}` : contract.label,
    imageUrl: parentOption?.imageUrl || null // Include imageUrl from parent option
  };
  
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
    
    // Try option image first, then market image, then text fallback
    const tryImage = (imageUrl, isFallback = false) => {
      if (!imageUrl) {
        if (!isFallback) {
          // Try market image if option image doesn't exist
          return tryImage(bet.marketImageUrl, true);
        }
        // No images available - show text
        const titleText = document.createElement("div");
        titleText.className = "parlay-item-icon-text";
        titleText.textContent = bet.marketTitle.charAt(0).toUpperCase();
        icon.appendChild(titleText);
        return;
      }
      
      const img = document.createElement("img");
      img.src = imageUrl;
      img.alt = "";
      img.onerror = () => {
        img.style.display = "none";
        if (!isFallback && bet.marketImageUrl) {
          // Try market image if option image fails
          tryImage(bet.marketImageUrl, true);
        } else {
          // Both images failed or no market image - show text
          const titleText = document.createElement("div");
          titleText.className = "parlay-item-icon-text";
          titleText.textContent = bet.marketTitle.charAt(0).toUpperCase();
          icon.appendChild(titleText);
        }
      };
      icon.appendChild(img);
    };
    
    tryImage(bet.imageUrl);
    
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
    const deleteIcon = document.createElement("img");
    deleteIcon.src = "public/close.svg";
    deleteIcon.alt = "Delete";
    deleteIcon.style.width = "14px";
    deleteIcon.style.height = "14px";
    deleteIcon.style.filter = "brightness(0) invert(1)"; // Make icon white for red background
    deleteBtn.appendChild(deleteIcon);
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
    const res = await authenticatedFetch(`${BACKEND_BASE_URL}/api/parlay/${uid}/${betId}`, {
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
    showNotification("Failed to remove bet. Please try again.", 'error');
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
    showNotification("This bet is already in your parlay!", 'error');
    return;
  }
  
  // Prevent mixing demo and production bets
  if (parlayBets.length > 0 && parlayBets[0].environment !== currentEnvironment) {
    const otherEnv = parlayBets[0].environment === 'demo' ? 'demo' : 'production';
    showNotification(`Cannot mix bets from different environments!\n\nYou have bets from ${otherEnv} environment.\nPlease clear your parlay or switch to the ${otherEnv} site.`, 'error');
    return;
  }
  
  // Get the current tab URL to store with the bet
  const tab = await getActiveTab();
  const marketUrl = tab?.url || '';
  
  const newBet = {
    marketId: currentMarket.id,
    marketTitle: currentMarket.title,
    marketUrl: marketUrl,
    imageUrl: selectedOption.imageUrl || null, // Option-specific image
    marketImageUrl: currentMarket.imageUrl || null, // Market image as fallback
    optionId: selectedOption.id,
    optionLabel: selectedOption.displayLabel || selectedOption.optionLabel || selectedOption.label,
    prob: selectedOption.prob,
    ticker: selectedOption.ticker || selectedOption.id || null, // Kalshi ticker for API trading
    side: selectedOption.side || null, // YES or NO
    environment: currentEnvironment // Store environment with bet
  };
  
  try {
    const uid = await getUserId(currentEnvironment);
    const res = await authenticatedFetch(`${BACKEND_BASE_URL}/api/parlay/${uid}`, {
      method: 'POST',
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
    document.querySelectorAll(".option-btn").forEach(btn => {
      btn.classList.remove("selected");
    });
    selectedOption = null;
    
    const addBtn = document.getElementById("add-to-parlay-btn");
    if (addBtn) {
      addBtn.disabled = true;
    }
  } catch (err) {
    console.error("Failed to add bet to parlay:", err);
    showNotification("Failed to add bet to parlay. Please try again.", 'error');
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
      
      // Try option image first, then market image, then text fallback
      const tryImage = (imageUrl, isFallback = false) => {
        if (!imageUrl) {
          if (!isFallback) {
            // Try market image if option image doesn't exist
            return tryImage(bet.marketImageUrl, true);
          }
          // No images available - show text
          const titleText = document.createElement("div");
          titleText.className = "parlay-item-icon-text";
          titleText.textContent = bet.marketTitle.charAt(0).toUpperCase();
          icon.appendChild(titleText);
          return;
        }
        
        const img = document.createElement("img");
        img.src = imageUrl;
        img.alt = "";
        img.onerror = () => {
          img.style.display = "none";
          if (!isFallback && bet.marketImageUrl) {
            // Try market image if option image fails
            tryImage(bet.marketImageUrl, true);
          } else {
            // Both images failed or no market image - show text
            const titleText = document.createElement("div");
            titleText.className = "parlay-item-icon-text";
            titleText.textContent = bet.marketTitle.charAt(0).toUpperCase();
            icon.appendChild(titleText);
          }
        };
        icon.appendChild(img);
      };
      
      tryImage(bet.imageUrl);
      
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
  
  // Hide any error messages
  hideBetError();
  
  // Show overlay
  overlay.classList.remove("hidden");
}

function closeBetOverlay() {
  const overlay = document.getElementById("bet-overlay");
  if (overlay) {
    overlay.classList.add("hidden");
  }
  // Hide error when closing overlay
  hideBetError();
}

function showBetError(message) {
  const errorEl = document.getElementById("bet-error-message");
  const errorText = document.getElementById("bet-error-text");
  if (errorEl && errorText) {
    errorText.textContent = message;
    errorEl.classList.remove("hidden");
    // Scroll error into view
    errorEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function hideBetError() {
  const errorEl = document.getElementById("bet-error-message");
  if (errorEl) {
    errorEl.classList.add("hidden");
  }
}

// Show success message in bet overlay
function showBetSuccess(message) {
  const errorEl = document.getElementById("bet-error-message");
  const errorText = document.getElementById("bet-error-text");
  if (errorEl && errorText) {
    errorEl.style.background = "#dfd";
    errorEl.style.borderColor = "#ada";
    errorEl.style.color = "#3a3";
    errorText.textContent = message;
    errorEl.classList.remove("hidden");
    errorEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    
    // Reset styling after 5 seconds
    setTimeout(() => {
      errorEl.style.background = "";
      errorEl.style.borderColor = "";
      errorEl.style.color = "";
      hideBetError();
    }, 5000);
  }
}

// Show notification message (for non-overlay contexts)
function showNotification(message, type = 'info') {
  // Create notification element if it doesn't exist
  let notification = document.getElementById("global-notification");
  if (!notification) {
    notification = document.createElement("div");
    notification.id = "global-notification";
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: ${type === 'error' ? '#fee' : type === 'success' ? '#dfd' : '#eef'};
      border: 1px solid ${type === 'error' ? '#fcc' : type === 'success' ? '#ada' : '#ccd'};
      color: ${type === 'error' ? '#c33' : type === 'success' ? '#3a3' : '#333'};
      padding: 12px 16px;
      border-radius: 8px;
      box-shadow: 0 4px 6px rgba(0,0,0,0.1);
      z-index: 10000;
      max-width: 300px;
      font-size: 14px;
    `;
    document.body.appendChild(notification);
  }
  
  notification.textContent = message;
  notification.style.display = 'block';
  
  // Auto-hide after 5 seconds
  setTimeout(() => {
    notification.style.display = 'none';
  }, 5000);
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
    showBetError("Please enter a valid stake amount");
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
    const res = await authenticatedFetch(`${BACKEND_BASE_URL}/api/quote`, {
      method: 'POST',
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
    showBetError(`Failed to get quote: ${err.message}\n\nPlease try again.`);
    
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
    
    // Hide any previous errors
    hideBetError();
    
    // Check wallet balance first - show error immediately if insufficient
    let balance;
    try {
      balance = await loadWalletBalance();
      if (balance === undefined || balance === null || isNaN(balance)) {
        throw new Error("Could not load wallet balance");
      }
    } catch (balanceErr) {
      console.error("[Parlay] Failed to load balance:", balanceErr);
      showBetError(`❌ Error Loading Balance\n\nCould not check your wallet balance. Please refresh and try again.`);
      return;
    }
    
    if (balance < quote.stake) {
      showBetError(`❌ Insufficient Credits\n\nYou have: $${balance.toFixed(2)}\nNeed: $${quote.stake.toFixed(2)}\n\nPlease buy more credits to place this bet.`);
      return;
    }
    
    // Hide error before attempting to place bet
    hideBetError();
    
    console.log("[Parlay] Placing parlay bet using credits...");
    
    let res;
    let errorData;
    
    try {
      // Place parlay using credits
      res = await authenticatedFetch(`${BACKEND_BASE_URL}/api/place-parlay`, {
        method: 'POST',
        body: JSON.stringify({
          userId: uid,
          environment: currentEnvironment,
          stake: quote.stake,
          parlayBets: parlayBets.map(bet => ({ ...bet, environment: currentEnvironment })),
          quote: quote
        })
      });
      
      // Try to parse error response
      if (!res.ok) {
        try {
          errorData = await res.json();
        } catch (parseErr) {
          // If JSON parsing fails, use status text
          errorData = { error: `Server error: ${res.status} ${res.statusText}` };
        }
        
        // Show user-friendly error message in overlay
        const errorMessage = errorData.error || errorData.details || `Failed to place bet (${res.status})`;
        showBetError(`❌ ${errorMessage}\n\nPlease check your balance and try again.`);
        return;
      }
    } catch (fetchErr) {
      // Network or fetch error
      console.error("[Parlay] Fetch error:", fetchErr);
      showBetError(`❌ Connection Error\n\nFailed to connect to server. Please check your internet connection and try again.`);
      return;
    }
    
    // Parse successful response
    let data;
    try {
      data = await res.json();
    } catch (parseErr) {
      console.error("[Parlay] Failed to parse response:", parseErr);
      showBetError(`❌ Server Error\n\nReceived invalid response from server. Please try again.`);
      return;
    }
    
    console.log("[Parlay] Bet placed successfully:", data);
    
    // Refresh wallet balance
    await loadWalletBalance();
    
    // Close the overlay
    closeBetOverlay();
    
    // Show success notification (non-blocking, no browser alert)
    showNotification(`✅ Parlay bet placed! Stake: $${quote.stake.toFixed(2)}, Potential Payout: $${data.payout.toFixed(2)}`, 'success');
    
  } catch (err) {
    // Catch any unexpected errors
    console.error("[Parlay] Unexpected error:", err);
    showBetError(`❌ Error\n\n${err.message || 'An unexpected error occurred. Please try again.'}`);
  }
}

async function placeBet() {
  if (parlayBets.length === 0) return;
  
  // Require at least 2 bets for a parlay
  if (parlayBets.length < MIN_BETS_FOR_PARLAY) {
    showNotification(`You need at least ${MIN_BETS_FOR_PARLAY} bets to place a parlay!`, 'error');
    return;
  }
  
  // Show the bet overlay instead of clearing immediately
  showBetOverlay();
}

// Setup auth UI and check authentication
function setupAuthUI() {
  const loginOverlay = document.getElementById('login-overlay');
  const emailInput = document.getElementById('email-input');
  const passwordInput = document.getElementById('password-input');
  const loginBtn = document.getElementById('login-btn');
  const signupBtn = document.getElementById('signup-btn');
  const logoutBtn = document.getElementById('logout-btn');
  const closeLoginBtn = document.getElementById('close-login-btn');
  const loginError = document.getElementById('login-error-message');
  const loginForm = document.getElementById('login-form');
  const userInfo = document.getElementById('user-info');
  const userEmailSpan = document.getElementById('user-email');
  const appContent = document.querySelector('.app');
  
  // Show/hide app content based on auth status
  async function updateUIForAuth() {
    // If Supabase is not configured yet, just show login overlay
    // Don't disable buttons - Supabase might still be initializing
    if (!supabase) {
      // Show login overlay but keep buttons enabled
      if (loginOverlay) {
        loginOverlay.classList.remove('hidden');
        loginOverlay.style.display = 'flex';
        loginOverlay.style.visibility = 'visible';
        loginOverlay.style.opacity = '1';
        console.log('Showing login overlay (no supabase)');
      }
      if (appContent) appContent.style.display = 'none';
      // Don't disable buttons - allow user to try logging in
      // Supabase will initialize when they try
      return;
    }
    
    try {
      const isAuthenticated = await checkAuthStatus();
      
      // Hide loading screen as soon as we know auth status
      hideInitialLoading();
      
      if (isAuthenticated) {
        // Hide login modal completely, show app content
        if (loginOverlay) {
          loginOverlay.classList.add('hidden');
          loginOverlay.style.display = 'none'; // Force hide
          console.log('Hiding login overlay (authenticated)');
        }
        if (appContent) {
          appContent.style.display = 'block';
        }
        
        // Hide login form and user info inside modal (since modal is hidden)
        if (loginForm) loginForm.classList.add('hidden');
        if (userInfo) userInfo.classList.add('hidden');
      } else {
        // Show login modal, hide app content
        console.log('User not authenticated - forcing login overlay visible');
        if (loginOverlay) {
          loginOverlay.classList.remove('hidden');
          loginOverlay.style.display = 'flex'; // Force show
          loginOverlay.style.visibility = 'visible';
          loginOverlay.style.opacity = '1';
          loginOverlay.style.zIndex = '1000';
          console.log('Login overlay element:', loginOverlay);
          console.log('Login overlay computed style:', window.getComputedStyle(loginOverlay).display);
        } else {
          console.error('Login overlay element not found!');
        }
        if (appContent) {
          appContent.style.display = 'none';
        }
        // Show login form, hide user info
        if (loginForm) loginForm.classList.remove('hidden');
        if (userInfo) userInfo.classList.add('hidden');
        if (loginError) loginError.classList.add('hidden');
      }
    } catch (err) {
      console.error('Error in updateUIForAuth:', err);
      // On error, show login overlay
      if (loginOverlay) {
        loginOverlay.classList.remove('hidden');
        loginOverlay.style.display = 'flex';
        loginOverlay.style.visibility = 'visible';
        loginOverlay.style.opacity = '1';
      }
      if (appContent) appContent.style.display = 'none';
    }
  }
  
  // Login handler
  if (loginBtn) {
    loginBtn.addEventListener('click', async () => {
      const email = emailInput?.value.trim() || '';
      const password = passwordInput?.value || '';
      
      if (!email || !password) {
        if (loginError) {
          loginError.textContent = 'Please enter email and password';
          loginError.classList.remove('hidden');
        }
        return;
      }
      
      if (loginError) loginError.classList.add('hidden');
      loginBtn.disabled = true;
      loginBtn.textContent = 'Logging in...';
      
      try {
        const { error } = await login(email, password);
        if (error) {
          if (loginError) {
            loginError.textContent = error.message;
            loginError.classList.remove('hidden');
          }
          loginBtn.disabled = false;
          loginBtn.textContent = 'Login';
        } else {
          // Update UI immediately after successful login
          await updateUIForAuth();
          // Small delay to ensure UI updates, then reload
          setTimeout(() => {
            window.location.reload();
          }, 100);
        }
      } catch (err) {
        if (loginError) {
          loginError.textContent = err.message || 'Login failed';
          loginError.classList.remove('hidden');
        }
        loginBtn.disabled = false;
        loginBtn.textContent = 'Login';
      }
    });
  }
  
  // Signup handler
  if (signupBtn) {
    let isSigningUp = false; // Prevent double-clicks
    signupBtn.addEventListener('click', async () => {
      // Prevent double-clicks
      if (isSigningUp) {
        return;
      }
      
      const email = emailInput?.value.trim() || '';
      const password = passwordInput?.value || '';
      
      if (!email || !password) {
        if (loginError) {
          loginError.textContent = 'Please enter email and password';
          loginError.classList.remove('hidden');
        }
        return;
      }
      
      if (password.length < 6) {
        if (loginError) {
          loginError.textContent = 'Password must be at least 6 characters';
          loginError.classList.remove('hidden');
        }
        return;
      }
      
      if (loginError) loginError.classList.add('hidden');
      isSigningUp = true;
      signupBtn.disabled = true;
      signupBtn.textContent = 'Signing up...';
      
      try {
        const { data, error } = await signup(email, password);
        if (error) {
          // Check for duplicate email error or our custom error
          let errorMessage = error.message;
          const errorMsgLower = error.message?.toLowerCase() || '';
          
          if (error.code === 'user_already_exists' ||
              errorMsgLower.includes('already registered') || 
              errorMsgLower.includes('user already exists') ||
              errorMsgLower.includes('email address is already in use') ||
              errorMsgLower.includes('email already registered') ||
              error.status === 422 ||
              error.code === 'signup_disabled') {
            errorMessage = 'An account with this email already exists. Please login instead.';
          }
          
          if (loginError) {
            loginError.textContent = errorMessage;
            loginError.classList.remove('hidden');
            loginError.style.color = '#ff6b6b';
          }
          isSigningUp = false;
          signupBtn.disabled = false;
          signupBtn.textContent = 'Sign Up';
        } else {
          // Check if this is actually a new user or existing one
          if (data?.user) {
            // CRITICAL: If user has email_confirmed_at set, they already existed
            // Supabase returns the existing user object but doesn't create a duplicate
            if (data.user.email_confirmed_at) {
              // User already exists and is confirmed - this is a duplicate signup attempt
              if (loginError) {
                loginError.textContent = 'An account with this email already exists. Please login instead.';
                loginError.classList.remove('hidden');
                loginError.style.color = '#ff6b6b';
              }
            } else if (!data.session) {
              // No session means either:
              // 1. New unconfirmed user (needs email confirmation) - SUCCESS
              // 2. Existing unconfirmed user (will receive another confirmation email) - Still OK
              // We show success message in both cases
              if (loginError) {
                loginError.textContent = 'Account created! Check your email to confirm, then login.';
                loginError.classList.remove('hidden');
                loginError.style.color = '#00b894';
              }
            } else {
              // Session exists - user created and auto-confirmed (email confirmation disabled)
              if (loginError) {
                loginError.textContent = 'Account created successfully!';
                loginError.classList.remove('hidden');
                loginError.style.color = '#00b894';
              }
            }
          } else {
            // No user returned - this shouldn't happen but handle it
            if (loginError) {
              loginError.textContent = 'Account may already exist. Please try logging in instead.';
              loginError.classList.remove('hidden');
              loginError.style.color = '#ff6b6b';
            }
          }
          isSigningUp = false;
          signupBtn.disabled = false;
          signupBtn.textContent = 'Sign Up';
        }
      } catch (err) {
        if (loginError) {
          loginError.textContent = err.message || 'Signup failed';
          loginError.classList.remove('hidden');
        }
        isSigningUp = false;
        signupBtn.disabled = false;
        signupBtn.textContent = 'Sign Up';
      }
    });
  }
  
  // Logout handler (from login modal - shouldn't be visible when logged in)
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      try {
        // Logout
        await logout();
        
        // Explicitly show login overlay and hide app content
        const loginOverlay = document.getElementById('login-overlay');
        const appContent = document.querySelector('.app');
        
        if (loginOverlay) {
          loginOverlay.classList.remove('hidden');
          loginOverlay.style.display = 'flex';
          loginOverlay.style.visibility = 'visible';
          loginOverlay.style.opacity = '1';
        }
        if (appContent) {
          appContent.style.display = 'none';
        }
        
        // Update UI - this will handle showing the login form
        await updateUIForAuth();
      } catch (err) {
        console.error('Logout error:', err);
        // Still show login overlay on error
        const loginOverlay = document.getElementById('login-overlay');
        const appContent = document.querySelector('.app');
        if (loginOverlay) {
          loginOverlay.classList.remove('hidden');
          loginOverlay.style.display = 'flex';
          loginOverlay.style.visibility = 'visible';
          loginOverlay.style.opacity = '1';
        }
        if (appContent) {
          appContent.style.display = 'none';
        }
        await updateUIForAuth();
      }
    });
  }
  
  // Close login modal handler - don't allow closing if not authenticated
  if (closeLoginBtn) {
    closeLoginBtn.addEventListener('click', async () => {
      const isAuth = await checkAuthStatus();
      if (!isAuth && loginOverlay) {
        loginOverlay.classList.remove('hidden');
      }
    });
  }
  
  // Profile button handler
  const profileBtn = document.getElementById('profile-btn');
  const profileOverlay = document.getElementById('profile-overlay');
  const closeProfileBtn = document.getElementById('close-profile-btn');
  const profileEmail = document.getElementById('profile-email');
  const profileLogoutBtn = document.getElementById('profile-logout-btn');
  
  if (profileBtn) {
    profileBtn.addEventListener('click', async () => {
      // Show profile overlay immediately
      if (profileOverlay) {
        profileOverlay.classList.remove('hidden');
        const modalBody = profileOverlay.querySelector('.bet-modal-body');
        showLoading(modalBody);
      }
      
      try {
      // Update email in profile overlay
      const user = await getCurrentUser();
      if (user && profileEmail) {
        profileEmail.textContent = user.email || 'Not available';
      }
      // Load wallet balance for profile display
      await loadWalletBalance();
      // Show main profile view
      showProfileMainView();
      } finally {
        // Hide loading after data is loaded
      if (profileOverlay) {
          const modalBody = profileOverlay.querySelector('.bet-modal-body');
          hideLoading(modalBody);
        }
      }
    });
  }
  
  if (closeProfileBtn) {
    closeProfileBtn.addEventListener('click', () => {
      // Reset to main view before closing
      showProfileMainView();
      if (profileOverlay) {
        profileOverlay.classList.add('hidden');
      }
    });
  }
  
  if (profileLogoutBtn) {
    profileLogoutBtn.addEventListener('click', async () => {
      try {
        // Close profile overlay first
        if (profileOverlay) {
          profileOverlay.classList.add('hidden');
        }
        
        // Logout
        await logout();
        
        // Explicitly show login overlay and hide app content
        const loginOverlay = document.getElementById('login-overlay');
        const appContent = document.querySelector('.app');
        
        if (loginOverlay) {
          loginOverlay.classList.remove('hidden');
          loginOverlay.style.display = 'flex';
          loginOverlay.style.visibility = 'visible';
          loginOverlay.style.opacity = '1';
        }
        if (appContent) {
          appContent.style.display = 'none';
        }
        
        // Update UI - this will handle showing the login form
        await updateUIForAuth();
      } catch (err) {
        console.error('Logout error:', err);
        // Still show login overlay on error
        const loginOverlay = document.getElementById('login-overlay');
        const appContent = document.querySelector('.app');
        if (loginOverlay) {
          loginOverlay.classList.remove('hidden');
          loginOverlay.style.display = 'flex';
          loginOverlay.style.visibility = 'visible';
          loginOverlay.style.opacity = '1';
        }
        if (appContent) {
          appContent.style.display = 'none';
        }
        await updateUIForAuth();
      }
    });
  }
  
  // Menu button handler
  const menuBtn = document.getElementById('menu-btn');
  const menuOverlay = document.getElementById('menu-overlay');
  const closeMenuBtn = document.getElementById('close-menu-btn');
  
  // Menu overlay view management
  if (menuBtn) {
    menuBtn.addEventListener('click', () => {
      // Show main menu view
      showMenuMainView();
      if (menuOverlay) {
        menuOverlay.classList.remove('hidden');
      }
    });
  }
  
  if (closeMenuBtn) {
    closeMenuBtn.addEventListener('click', () => {
      // Reset to main view before closing
      showMenuMainView();
      if (menuOverlay) {
        menuOverlay.classList.add('hidden');
      }
    });
  }
  
  // Menu back button
  const menuBackBtn = document.getElementById('menu-back-btn');
  if (menuBackBtn) {
    menuBackBtn.addEventListener('click', () => {
      showMenuMainView();
    });
  }
  
  // Menu navigation buttons
  const menuCurrentParlaysBtn = document.getElementById('menu-current-parlays-btn');
  if (menuCurrentParlaysBtn) {
    menuCurrentParlaysBtn.addEventListener('click', async () => {
      showMenuCurrentParlaysView();
      // Show loading state
      const container = document.getElementById('menu-parlay-container');
      if (container) {
        container.innerHTML = '<div class="section-loading"><div class="loading-spinner"></div>Loading current parlays...</div>';
      }
      await loadAndRenderCurrentParlays();
    });
  }
  
  const menuParlayHistoryBtn = document.getElementById('menu-parlay-history-btn');
  if (menuParlayHistoryBtn) {
    menuParlayHistoryBtn.addEventListener('click', async () => {
      showMenuParlayHistoryView();
      // Show loading state
      const container = document.getElementById('menu-parlay-history-container');
      if (container) {
        container.innerHTML = '<div class="section-loading"><div class="loading-spinner"></div>Loading parlay history...</div>';
      }
      await loadAndRenderMenuParlayHistory();
    });
  }
  
  // Refresh buttons
  const menuRefreshParlayHistoryBtn = document.getElementById('menu-refresh-parlay-history-btn');
  if (menuRefreshParlayHistoryBtn) {
    menuRefreshParlayHistoryBtn.addEventListener('click', async () => {
      await loadAndRenderMenuParlayHistory();
    });
  }
  
  // Close overlays when clicking outside (on the overlay background)
  if (profileOverlay) {
    profileOverlay.addEventListener('click', (e) => {
      if (e.target === profileOverlay) {
        // Reset to main view before closing
        showProfileMainView();
        profileOverlay.classList.add('hidden');
      }
    });
  }
  
  if (menuOverlay) {
    menuOverlay.addEventListener('click', (e) => {
      if (e.target === menuOverlay) {
        // Reset to main view before closing
        showMenuMainView();
        menuOverlay.classList.add('hidden');
      }
    });
  }
  
  // Check auth on load
  updateUIForAuth();
  
  // Listen for auth state changes
  if (supabase) {
    supabase.auth.onAuthStateChange((event, session) => {
      console.log('Auth state changed:', event, session ? 'has session' : 'no session');
      const loginOverlay = document.getElementById('login-overlay');
      const appContent = document.querySelector('.app');
      
      if (event === 'SIGNED_OUT' || (event === 'INITIAL_SESSION' && !session)) {
        // Explicitly show login overlay on sign out or when no initial session
        if (loginOverlay) {
          loginOverlay.classList.remove('hidden');
          loginOverlay.style.display = 'flex';
          loginOverlay.style.visibility = 'visible';
          loginOverlay.style.opacity = '1';
        }
        if (appContent) {
          appContent.style.display = 'none';
        }
        // Show login form, hide user info
        const loginForm = document.getElementById('login-form');
        const userInfo = document.getElementById('user-info');
        if (loginForm) loginForm.classList.remove('hidden');
        if (userInfo) userInfo.classList.add('hidden');
      }
      
      updateUIForAuth();
    });
  }
  
  return updateUIForAuth; // Return function so init can wait for auth check
}

async function init() {
  try {
    // Auth UI is already set up in initializeApp() - just check authentication
    const isAuthenticated = await checkAuthStatus();
    
    if (!isAuthenticated) {
      // Don't initialize app if not authenticated
      // Login modal should already be showing from setupAuthUI in initializeApp()
      console.log('User not authenticated - showing login modal');
      // Hide loading screen immediately
      hideInitialLoading();
      // Ensure login overlay is visible and app is hidden
      const loginOverlay = document.getElementById('login-overlay');
      const appContent = document.querySelector('.app');
      if (loginOverlay) loginOverlay.classList.remove('hidden');
      if (appContent) appContent.style.display = 'none';
      return;
    }
    
    console.log('User authenticated - initializing app');
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

  // Show loading state for market options
  const optionsContainer = document.getElementById('options-container');
  if (optionsContainer) {
    optionsContainer.innerHTML = '<div class="section-loading"><div class="loading-spinner"></div>Loading market data...</div>';
  }

  // First try: backend API (preferred, richer data).
  let backendSuccess = false;
  try {
    const res = await authenticatedFetch(`${BACKEND_BASE_URL}/api/kalshi/market/${marketId}`);
    
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
    console.log(`[init] Rendering ${currentMarket.contracts.length} contracts from API`);
    visibleOptionsCount = 3; // Reset to initial count when loading new market
    renderOptions(currentMarket.contracts);
    backendSuccess = true;
  } catch (err) {
    console.error("Failed to load market from backend, falling back to DOM", err);
  }

  // Always try to get the title, image, and option names from the DOM (prioritize actual webpage content)
  // Only attempt this if we're on a Kalshi page
  if (isKalshiMarketUrl(tab.url)) {
    try {
      console.log("Attempting to get title, image, and option names from DOM...");
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
        
        // Option names now come from API - no DOM enhancement needed
        // (Removed DOM option name extraction to avoid overwriting API data)
      } else {
        console.log("❌ No response from content script");
      }
    } catch (err) {
      // Only log as error if it's not the expected "Receiving end does not exist" error
      // This error is expected when content script hasn't loaded yet or page doesn't match
      if (err.message && err.message.includes("Receiving end does not exist")) {
        console.log("ℹ️ Content script not available (this is normal if page hasn't reloaded after extension update)");
      } else {
        console.warn("⚠️ Failed to communicate with content script:", err.message || err);
        console.log("Make sure you've reloaded the Kalshi page after updating the extension.");
      }
    }
  }

  // Only render options if backend didn't already do it
  if (!backendSuccess) {
    renderOptions([]);
  }
  
    // Always load and show parlay at the end
    await loadAndRenderParlay();
    
    // Load wallet balance
  await loadWalletBalance();
  
  // Stripe Connect removed - using Coinbase CDP for payments now
  } catch (err) {
    console.error('Error in init function:', err);
    // Ensure login overlay is visible on error
    const loginOverlay = document.getElementById('login-overlay');
    const appContent = document.querySelector('.app');
    if (loginOverlay) loginOverlay.classList.remove('hidden');
    if (appContent) appContent.style.display = 'none';
    
    // Show error in login form if available
    const loginError = document.getElementById('login-error-message');
    if (loginError) {
      loginError.textContent = `Error: ${err.message || 'Failed to initialize extension'}`;
      loginError.classList.remove('hidden');
      loginError.style.color = '#ff6b6b';
    }
  }
}

// Helper function to load parlay and set up event listeners
async function loadAndRenderParlay() {
  // Load parlay bets from database (filter by current environment)
  try {
    const uid = await getUserId(currentEnvironment);
    const res = await authenticatedFetch(`${BACKEND_BASE_URL}/api/parlay/${uid}?environment=${currentEnvironment}`);
    
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
  // Wallet refresh button
  // Refresh wallet button (main and profile)
  const refreshWalletBtn = document.getElementById("refresh-wallet-btn");
  if (refreshWalletBtn && !refreshWalletBtn.hasListener) {
    refreshWalletBtn.addEventListener("click", () => {
      loadWalletBalance();
    });
    refreshWalletBtn.hasListener = true;
  }
  
  const profileRefreshWalletBtn = document.getElementById("profile-refresh-wallet-btn");
  if (profileRefreshWalletBtn && !profileRefreshWalletBtn.hasListener) {
    profileRefreshWalletBtn.addEventListener("click", () => {
      loadWalletBalance();
    });
    profileRefreshWalletBtn.hasListener = true;
  }
  
  // Stripe Connect buttons removed - using Coinbase CDP for payments now
  
  // Withdraw button
  // Withdraw button (main and profile)
  const withdrawBtn = document.getElementById("withdraw-btn");
  if (withdrawBtn && !withdrawBtn.hasListener) {
    withdrawBtn.addEventListener("click", showWithdrawOverlay);
    withdrawBtn.hasListener = true;
  }
  
  const profileWithdrawBtn = document.getElementById("profile-withdraw-btn");
  if (profileWithdrawBtn && !profileWithdrawBtn.hasListener) {
    profileWithdrawBtn.addEventListener("click", () => {
      showProfileWithdrawView();
    });
    profileWithdrawBtn.hasListener = true;
  }
  
  // Profile back button
  const profileBackBtn = document.getElementById("profile-back-btn");
  if (profileBackBtn && !profileBackBtn.hasListener) {
    profileBackBtn.addEventListener("click", () => {
      showProfileMainView();
    });
    profileBackBtn.hasListener = true;
  }
  
  // Profile buy credits amount input
  const profileBuyCreditsAmountInput = document.getElementById("profile-buy-credits-amount-input");
  if (profileBuyCreditsAmountInput && !profileBuyCreditsAmountInput.hasListener) {
    profileBuyCreditsAmountInput.addEventListener("input", (e) => {
      const amount = parseFloat(e.target.value) || 0;
      const confirmBtn = document.getElementById("profile-confirm-buy-credits-btn");
      if (confirmBtn) {
        confirmBtn.disabled = amount < 5 || amount > 1000;
      }
    });
    profileBuyCreditsAmountInput.hasListener = true;
  }
  
  // Profile withdraw amount input
  const profileWithdrawAmountInput = document.getElementById("profile-withdraw-amount-input");
  if (profileWithdrawAmountInput && !profileWithdrawAmountInput.hasListener) {
    profileWithdrawAmountInput.addEventListener("input", (e) => {
      const amount = parseFloat(e.target.value) || 0;
      const confirmBtn = document.getElementById("profile-confirm-withdraw-btn");
      if (confirmBtn) {
        confirmBtn.disabled = amount <= 0;
      }
    });
    profileWithdrawAmountInput.hasListener = true;
  }
  
  // Profile confirm buy credits button
  const profileConfirmBuyCreditsBtn = document.getElementById("profile-confirm-buy-credits-btn");
  if (profileConfirmBuyCreditsBtn && !profileConfirmBuyCreditsBtn.hasListener) {
    profileConfirmBuyCreditsBtn.addEventListener("click", handleProfileBuyCredits);
    profileConfirmBuyCreditsBtn.hasListener = true;
  }
  
  // Profile confirm withdraw button
  const profileConfirmWithdrawBtn = document.getElementById("profile-confirm-withdraw-btn");
  if (profileConfirmWithdrawBtn && !profileConfirmWithdrawBtn.hasListener) {
    profileConfirmWithdrawBtn.addEventListener("click", handleProfileWithdraw);
    profileConfirmWithdrawBtn.hasListener = true;
  }
  
  // Stripe Connect button removed - using Coinbase CDP for payments now
  
  // Close withdraw overlay button
  const closeWithdrawBtn = document.getElementById("close-withdraw-btn");
  if (closeWithdrawBtn && !closeWithdrawBtn.hasListener) {
    closeWithdrawBtn.addEventListener("click", closeWithdrawOverlay);
    closeWithdrawBtn.hasListener = true;
  }
  
  // Withdraw amount input
  const withdrawAmountInput = document.getElementById("withdraw-amount-input");
  if (withdrawAmountInput && !withdrawAmountInput.hasListener) {
    withdrawAmountInput.addEventListener("input", (e) => {
      const amount = parseFloat(e.target.value) || 0;
      const confirmBtn = document.getElementById("confirm-withdraw-btn");
      if (confirmBtn) {
        confirmBtn.disabled = amount <= 0;
      }
    });
    withdrawAmountInput.hasListener = true;
  }
  
  // Confirm withdraw button
  const confirmWithdrawBtn = document.getElementById("confirm-withdraw-btn");
  if (confirmWithdrawBtn && !confirmWithdrawBtn.hasListener) {
    confirmWithdrawBtn.addEventListener("click", handleWithdraw);
    confirmWithdrawBtn.hasListener = true;
  }
  
  // Close withdraw overlay when clicking outside
  const withdrawOverlay = document.getElementById("withdraw-overlay");
  if (withdrawOverlay && !withdrawOverlay.hasListener) {
    withdrawOverlay.addEventListener("click", (e) => {
      if (e.target === withdrawOverlay) {
        closeWithdrawOverlay();
      }
    });
    withdrawOverlay.hasListener = true;
  }
  
  // Buy credits button (main and profile)
  const buyCreditsBtn = document.getElementById("buy-credits-btn");
  if (buyCreditsBtn && !buyCreditsBtn.hasListener) {
    buyCreditsBtn.addEventListener("click", showBuyCreditsOverlay);
    buyCreditsBtn.hasListener = true;
  }
  
  // Top Up Account button (profile) - directly opens Coinbase onramp
  const profileTopUpBtn = document.getElementById("profile-top-up-btn");
  if (profileTopUpBtn && !profileTopUpBtn.hasListener) {
    profileTopUpBtn.addEventListener("click", async () => {
      await handleTopUpAccount();
    });
    profileTopUpBtn.hasListener = true;
  }
  
  const profileBuyCreditsBtn = document.getElementById("profile-buy-credits-btn");
  if (profileBuyCreditsBtn && !profileBuyCreditsBtn.hasListener) {
    profileBuyCreditsBtn.addEventListener("click", () => {
      showProfileBuyCreditsView();
    });
    profileBuyCreditsBtn.hasListener = true;
  }
  
  // Close buy credits overlay button
  const closeBuyCreditsBtn = document.getElementById("close-buy-credits-btn");
  if (closeBuyCreditsBtn && !closeBuyCreditsBtn.hasListener) {
    closeBuyCreditsBtn.addEventListener("click", closeBuyCreditsOverlay);
    closeBuyCreditsBtn.hasListener = true;
  }
  
  // Buy credits amount input
  const buyCreditsAmountInput = document.getElementById("buy-credits-amount-input");
  if (buyCreditsAmountInput && !buyCreditsAmountInput.hasListener) {
    buyCreditsAmountInput.addEventListener("input", (e) => {
      const amount = parseFloat(e.target.value) || 0;
      const confirmBtn = document.getElementById("confirm-buy-credits-btn");
      if (confirmBtn) {
        confirmBtn.disabled = amount < 5 || amount > 1000;
      }
    });
    buyCreditsAmountInput.hasListener = true;
  }
  
  // Confirm buy credits button
  const confirmBuyCreditsBtn = document.getElementById("confirm-buy-credits-btn");
  if (confirmBuyCreditsBtn && !confirmBuyCreditsBtn.hasListener) {
    confirmBuyCreditsBtn.addEventListener("click", handleBuyCredits);
    confirmBuyCreditsBtn.hasListener = true;
  }
  
  // Close buy credits overlay when clicking outside
  const buyCreditsOverlay = document.getElementById("buy-credits-overlay");
  if (buyCreditsOverlay && !buyCreditsOverlay.hasListener) {
    buyCreditsOverlay.addEventListener("click", (e) => {
      if (e.target === buyCreditsOverlay) {
        closeBuyCreditsOverlay();
      }
    });
    buyCreditsOverlay.hasListener = true;
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
    const res = await authenticatedFetch(`${BACKEND_BASE_URL}/api/parlay-history/${uid}`);
    
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
    
    // Check status for pending parlays automatically
    const pendingParlays = filteredParlays.filter(p => {
      const status = p.parlay_status || 'pending';
      return status === 'pending';
    });
    
    // Check status for pending parlays in parallel
    if (pendingParlays.length > 0) {
      console.log(`Checking status for ${pendingParlays.length} pending parlays...`);
      await Promise.allSettled(
        pendingParlays.map(parlay => checkParlayStatusAndRefresh(parlay.session_id))
      );
      // Reload history after status checks
      const res = await authenticatedFetch(`${BACKEND_BASE_URL}/api/parlay-history/${uid}`);
      if (res.ok) {
        const data = await res.json();
        const updatedParlays = data.parlays || [];
        const filteredUpdated = updatedParlays.filter(p => {
          const parlayData = typeof p.parlay_data === 'string' ? JSON.parse(p.parlay_data) : p.parlay_data || [];
          return parlayData.length > 0 && parlayData[0].environment === currentEnvironment;
        });
        filteredParlays.length = 0;
        filteredParlays.push(...filteredUpdated);
      }
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

// Helper function to check parlay status and refresh UI
async function checkParlayStatusAndRefresh(sessionId) {
  try {
    console.log(`Checking status for parlay ${sessionId}...`);
    const res = await authenticatedFetch(`${BACKEND_BASE_URL}/api/parlay-status/${sessionId}`);
    if (res.ok) {
      const data = await res.json();
      console.log(`Status check for ${sessionId}:`, data);
      
      // If status changed from pending, log it
      if (data.status && data.status !== 'pending') {
        console.log(`✅ Parlay ${sessionId} status updated to: ${data.status}`);
      }
      
      return data;
    } else {
      const errorData = await res.json().catch(() => ({}));
      console.error(`Failed to check status for ${sessionId}:`, res.status, errorData);
      throw new Error(`Status check failed: ${res.status}`);
    }
  } catch (err) {
    console.error(`Error checking status for parlay ${sessionId}:`, err);
    throw err;
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
  
  // Header right - status badge and refresh button
  const headerRight = document.createElement("div");
  headerRight.className = "parlay-history-header-right";
  headerRight.appendChild(statusBadge);
  
  // Refresh button for pending parlays - add to header right
  if (status === 'pending') {
    const refreshBtn = document.createElement("button");
    refreshBtn.className = "refresh-status-btn";
    
    // Create icon element
    const icon = document.createElement("img");
    icon.src = "public/refresh.svg";
    icon.alt = "Refresh";
    icon.className = "refresh-icon";
    
    refreshBtn.appendChild(icon);
    
    refreshBtn.onclick = async () => {
      refreshBtn.disabled = true;
      try {
        await checkParlayStatusAndRefresh(parlay.session_id);
        // Reload the parlay history to show updated status
        await loadParlayHistory();
      } catch (err) {
        console.error("Error refreshing status:", err);
        alert("Failed to refresh status. Please try again.");
      } finally {
        refreshBtn.disabled = false;
      }
    };
    
    headerRight.appendChild(refreshBtn);
  }
  
  header.appendChild(headerLeft);
  header.appendChild(headerRight);
  
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
    
    // Try option image first, then market image, then text fallback
    const tryImage = (imageUrl, isFallback = false) => {
      if (!imageUrl) {
        if (!isFallback) {
          // Try market image if option image doesn't exist
          return tryImage(leg.marketImageUrl, true);
        }
        // No images available - show text
        const titleText = document.createElement("div");
        titleText.className = "parlay-item-icon-text";
        titleText.textContent = (leg.marketTitle || leg.title || "").charAt(0).toUpperCase();
        legIcon.appendChild(titleText);
        return;
      }
      
      const img = document.createElement("img");
      img.src = imageUrl;
      img.alt = "";
      img.onerror = () => {
        img.style.display = "none";
        if (!isFallback && leg.marketImageUrl) {
          // Try market image if option image fails
          tryImage(leg.marketImageUrl, true);
        } else {
          // Both images failed or no market image - show text
          const titleText = document.createElement("div");
          titleText.className = "parlay-item-icon-text";
          titleText.textContent = (leg.marketTitle || leg.title || "").charAt(0).toUpperCase();
          legIcon.appendChild(titleText);
        }
      };
      legIcon.appendChild(img);
    };
    
    tryImage(leg.imageUrl);
    
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
    const claimText = `Claim $${claimableAmount.toFixed(2)}`;
    claimBtn.textContent = claimText;
    claimBtn.setAttribute('data-original-text', claimText); // Store original text for error recovery
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
  // Find and disable the specific claim button for this parlay to prevent double-claiming
  const claimButtons = document.querySelectorAll('.claim-winnings-btn');
  const buttonTexts = new Map();
  
  // Store original text and disable all claim buttons immediately
  claimButtons.forEach(btn => {
    buttonTexts.set(btn, btn.textContent);
    btn.disabled = true;
    btn.textContent = 'Claiming...';
  });
  
  try {
    const res = await authenticatedFetch(`${BACKEND_BASE_URL}/api/claim-winnings/${sessionId}`, {
      method: 'POST'
    });
    
    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(error.error || `Failed to claim: ${res.status}`);
    }
    
    const data = await res.json();
    showNotification(`✅ Success! $${amount.toFixed(2)} has been added to your account balance.`, 'success');
    
    // Immediately reload parlay history to refresh with latest database data
    // This ensures the UI shows the updated claimed status and prevents double-claiming
    // The button will be removed/replaced by the refresh since claimed_at will be set
    await loadParlayHistory();
    
    // Reload wallet balance to show updated balance
    await loadWalletBalance();
    
  } catch (err) {
    console.error("Failed to claim winnings:", err);
    showNotification(`❌ Failed to claim winnings: ${err.message}`, 'error');
    
    // Re-enable buttons on error - restore original text
    claimButtons.forEach(btn => {
      btn.disabled = false;
      btn.textContent = buttonTexts.get(btn) || 'Claim Winnings';
    });
  }
}

// Stripe Connect functions removed - using Coinbase CDP for payments now

async function loadWalletBalance() {
  try {
    const uid = await getUserId(currentEnvironment);
    const res = await authenticatedFetch(`${BACKEND_BASE_URL}/api/wallet/${uid}`);
    
    if (res.ok) {
      const data = await res.json();
      const balance = parseFloat(data.balance || 0);
      
      // Update profile wallet balance display
      const profileWalletDisplay = document.getElementById("profile-wallet-balance");
      if (profileWalletDisplay) {
        profileWalletDisplay.textContent = `$${balance.toFixed(2)}`;
      }
      
      // Update profile buy credits balance
      const profileBuyCreditsBalanceDisplay = document.getElementById("profile-buy-credits-current-balance");
      if (profileBuyCreditsBalanceDisplay) {
        profileBuyCreditsBalanceDisplay.textContent = `$${balance.toFixed(2)}`;
      }
      
      // Update profile withdraw balance
      const profileModalWalletDisplay = document.getElementById("profile-modal-wallet-balance");
      if (profileModalWalletDisplay) {
        profileModalWalletDisplay.textContent = `$${balance.toFixed(2)}`;
      }
      
      // Update modal wallet balance (for old overlays if they still exist)
      const modalWalletDisplay = document.getElementById("modal-wallet-balance");
      if (modalWalletDisplay) {
        modalWalletDisplay.textContent = `$${balance.toFixed(2)}`;
      }
      
      // Update buy credits modal balance (for old overlay if it still exists)
      const buyCreditsBalanceDisplay = document.getElementById("buy-credits-current-balance");
      if (buyCreditsBalanceDisplay) {
        buyCreditsBalanceDisplay.textContent = `$${balance.toFixed(2)}`;
      }
      
      // Log wallet address if available (for debugging)
      if (data.crypto_wallet_address) {
        console.log(`[Wallet] Balance: $${balance.toFixed(2)}, Address: ${data.crypto_wallet_address}`);
      }
      
      // Log wallet address if available (for debugging)
      if (data.crypto_wallet_address) {
        console.log(`[Wallet] Balance: $${balance.toFixed(2)}, Address: ${data.crypto_wallet_address}`);
      }
      
      // Enable/disable withdraw button based on balance (profile and main)
      const profileWithdrawBtn = document.getElementById("profile-withdraw-btn");
      const withdrawBtn = document.getElementById("withdraw-btn");
      
      if (profileWithdrawBtn) {
        profileWithdrawBtn.disabled = balance <= 0;
      }
      if (withdrawBtn) {
        withdrawBtn.disabled = balance <= 0;
      }
      
      // Stripe Connect button visibility removed - using Coinbase CDP for payments now
      
      return balance;
    }
  } catch (err) {
    console.error("Failed to load wallet balance:", err);
    return 0;
  }
}

/**
 * Refresh wallet balance (alias for loadWalletBalance)
 * Used for manual refresh and automatic polling
 */
async function refreshWalletBalance() {
  return loadWalletBalance();
}

// Set up automatic balance polling every 30 seconds
// This ensures balance updates when users deposit via Coinbase onramp
let balancePollInterval = null;

function startBalancePolling() {
  // Clear existing interval if any
  if (balancePollInterval) {
    clearInterval(balancePollInterval);
  }
  
  // Poll every 30 seconds
  balancePollInterval = setInterval(async () => {
    try {
      const uid = await getUserId(currentEnvironment);
      if (uid) {
        await refreshWalletBalance();
      }
    } catch (err) {
      console.warn('[Balance Polling] Failed to refresh balance:', err);
    }
  }, 30000); // 30 seconds
  
  console.log('[Balance Polling] Started automatic balance refresh (every 30s)');
}

function stopBalancePolling() {
  if (balancePollInterval) {
    clearInterval(balancePollInterval);
    balancePollInterval = null;
    console.log('[Balance Polling] Stopped automatic balance refresh');
  }
}

// Start polling when user is logged in
// Check auth state and start polling
if (typeof supabase !== 'undefined' && supabase) {
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN' && session) {
      startBalancePolling();
    } else if (event === 'SIGNED_OUT') {
      stopBalancePolling();
    }
  });
}

// Profile overlay view management
function showProfileMainView() {
  const profileContent = document.getElementById("profile-content");
  const buyCreditsContent = document.getElementById("profile-buy-credits-content");
  const withdrawContent = document.getElementById("profile-withdraw-content");
  const profileFooter = document.getElementById("profile-footer");
  const profileBackBtn = document.getElementById("profile-back-btn");
  const profileHeaderTitle = document.getElementById("profile-header-title");
  
  if (profileContent) profileContent.style.display = "block";
  if (buyCreditsContent) buyCreditsContent.style.display = "none";
  if (withdrawContent) withdrawContent.style.display = "none";
  if (profileFooter) profileFooter.style.display = "none";
  if (profileBackBtn) profileBackBtn.style.display = "none";
  if (profileHeaderTitle) profileHeaderTitle.textContent = "Profile";
}

function showProfileBuyCreditsView() {
  const profileContent = document.getElementById("profile-content");
  const buyCreditsContent = document.getElementById("profile-buy-credits-content");
  const withdrawContent = document.getElementById("profile-withdraw-content");
  const profileFooter = document.getElementById("profile-footer");
  const profileBackBtn = document.getElementById("profile-back-btn");
  const profileHeaderTitle = document.getElementById("profile-header-title");
  const buyCreditsBtn = document.getElementById("profile-confirm-buy-credits-btn");
  const withdrawBtn = document.getElementById("profile-confirm-withdraw-btn");
  
  if (profileContent) profileContent.style.display = "none";
  if (buyCreditsContent) buyCreditsContent.style.display = "block";
  if (withdrawContent) withdrawContent.style.display = "none";
  if (profileFooter) profileFooter.style.display = "block";
  if (buyCreditsBtn) buyCreditsBtn.style.display = "block";
  if (withdrawBtn) withdrawBtn.style.display = "none";
  if (profileBackBtn) profileBackBtn.style.display = "block";
  if (profileHeaderTitle) profileHeaderTitle.textContent = "Buy Credits";
  
  // Load wallet balance
  loadWalletBalance();
  
  // Reset amount input
  const amountInput = document.getElementById("profile-buy-credits-amount-input");
  if (amountInput) {
    amountInput.value = "";
  }
  
  // Reset button
  if (buyCreditsBtn) {
    buyCreditsBtn.disabled = true;
    buyCreditsBtn.textContent = "Continue to Payment";
  }
  
  // Hide error message
  const errorMessage = document.getElementById("profile-buy-credits-error-message");
  if (errorMessage) {
    errorMessage.classList.add("hidden");
  }
}

function showProfileWithdrawView() {
  const profileContent = document.getElementById("profile-content");
  const buyCreditsContent = document.getElementById("profile-buy-credits-content");
  const withdrawContent = document.getElementById("profile-withdraw-content");
  const profileFooter = document.getElementById("profile-footer");
  const profileBackBtn = document.getElementById("profile-back-btn");
  const profileHeaderTitle = document.getElementById("profile-header-title");
  const buyCreditsBtn = document.getElementById("profile-confirm-buy-credits-btn");
  const withdrawBtn = document.getElementById("profile-confirm-withdraw-btn");
  
  if (profileContent) profileContent.style.display = "none";
  if (buyCreditsContent) buyCreditsContent.style.display = "none";
  if (withdrawContent) withdrawContent.style.display = "block";
  if (profileFooter) profileFooter.style.display = "block";
  if (buyCreditsBtn) buyCreditsBtn.style.display = "none";
  if (withdrawBtn) withdrawBtn.style.display = "block";
  if (profileBackBtn) profileBackBtn.style.display = "block";
  if (profileHeaderTitle) profileHeaderTitle.textContent = "Withdraw Funds";
  
  // Load wallet balance
  loadWalletBalance();
  
  // Reset amount input
  const amountInput = document.getElementById("profile-withdraw-amount-input");
  if (amountInput) {
    amountInput.value = "";
  }
  
  // Reset button
  if (withdrawBtn) {
    withdrawBtn.disabled = true;
    withdrawBtn.textContent = "Request Withdrawal";
  }
  
  // Hide error message
  const errorMessage = document.getElementById("profile-withdraw-error-message");
  if (errorMessage) {
    errorMessage.classList.add("hidden");
  }
}

// Menu overlay view management
function showMenuMainView() {
  const menuMainContent = document.getElementById("menu-main-content");
  const menuCurrentParlaysContent = document.getElementById("menu-current-parlays-content");
  const menuParlayHistoryContent = document.getElementById("menu-parlay-history-content");
  const menuBackBtn = document.getElementById("menu-back-btn");
  const menuHeaderTitle = document.getElementById("menu-header-title");
  
  if (menuMainContent) menuMainContent.style.display = "block";
  if (menuCurrentParlaysContent) menuCurrentParlaysContent.style.display = "none";
  if (menuParlayHistoryContent) menuParlayHistoryContent.style.display = "none";
  if (menuBackBtn) menuBackBtn.style.display = "none";
  if (menuHeaderTitle) menuHeaderTitle.textContent = "Menu";
}

function showMenuCurrentParlaysView() {
  const menuMainContent = document.getElementById("menu-main-content");
  const menuCurrentParlaysContent = document.getElementById("menu-current-parlays-content");
  const menuParlayHistoryContent = document.getElementById("menu-parlay-history-content");
  const menuBackBtn = document.getElementById("menu-back-btn");
  const menuHeaderTitle = document.getElementById("menu-header-title");
  
  if (menuMainContent) menuMainContent.style.display = "none";
  if (menuCurrentParlaysContent) menuCurrentParlaysContent.style.display = "block";
  if (menuParlayHistoryContent) menuParlayHistoryContent.style.display = "none";
  if (menuBackBtn) menuBackBtn.style.display = "block";
  if (menuHeaderTitle) menuHeaderTitle.textContent = "Current Parlays";
  
  // Load and render current parlays
  loadAndRenderCurrentParlays();
}

function showMenuParlayHistoryView() {
  const menuMainContent = document.getElementById("menu-main-content");
  const menuCurrentParlaysContent = document.getElementById("menu-current-parlays-content");
  const menuParlayHistoryContent = document.getElementById("menu-parlay-history-content");
  const menuBackBtn = document.getElementById("menu-back-btn");
  const menuHeaderTitle = document.getElementById("menu-header-title");
  
  if (menuMainContent) menuMainContent.style.display = "none";
  if (menuCurrentParlaysContent) menuCurrentParlaysContent.style.display = "none";
  if (menuParlayHistoryContent) menuParlayHistoryContent.style.display = "block";
  if (menuBackBtn) menuBackBtn.style.display = "block";
  if (menuHeaderTitle) menuHeaderTitle.textContent = "Previous Parlay History";
  
  // Load and render parlay history
  loadAndRenderMenuParlayHistory();
}

// Helper function to check if a parlay has any pending legs
function hasPendingLegs(parlay) {
  const legOutcomes = parlay.legOutcomes || [];
  const parlayData = typeof parlay.parlay_data === 'string' ? JSON.parse(parlay.parlay_data) : parlay.parlay_data || [];
  
  // If no leg outcomes, all legs are pending
  if (legOutcomes.length === 0) {
    return parlayData.length > 0;
  }
  
  // Check if any leg is not settled
  for (let i = 0; i < parlayData.length; i++) {
    const legOutcome = legOutcomes.find(o => o.leg_number === i + 1);
    if (!legOutcome || legOutcome.market_status !== 'settled') {
      return true; // At least one leg is pending
    }
  }
  
  return false; // All legs are settled
}

// Load and render current parlays in menu
// Only shows completed parlays that haven't been resolved yet (not the parlay being built)
async function loadAndRenderCurrentParlays() {
  const container = document.getElementById("menu-parlay-container");
  if (!container) return;
  
  try {
    container.innerHTML = '<div class="section-loading"><div class="loading-spinner"></div>Loading current parlays...</div>';
    
    const uid = await getUserId(currentEnvironment);
    
    // Only load completed purchases with pending legs (not bets being built)
    const historyRes = await authenticatedFetch(`${BACKEND_BASE_URL}/api/parlay-history/${uid}`);
    
    container.innerHTML = "";
    
    // Add completed purchases with pending legs
    if (historyRes.ok) {
      const historyData = await historyRes.json();
      const allParlays = historyData.parlays || [];
      
      // Filter by environment and pending legs
      const pendingParlays = allParlays.filter(p => {
        const parlayData = typeof p.parlay_data === 'string' ? JSON.parse(p.parlay_data) : p.parlay_data || [];
        const matchesEnvironment = parlayData.length > 0 && parlayData[0].environment === currentEnvironment;
        return matchesEnvironment && hasPendingLegs(p);
      });
      
      if (pendingParlays.length > 0) {
        // Render completed purchases with pending legs
        pendingParlays.forEach(parlay => {
          const parlayCard = createParlayHistoryCard(parlay);
          container.appendChild(parlayCard);
        });
      }
    }
    
    if (container.children.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-parlay";
      empty.textContent = "No active parlays";
      container.appendChild(empty);
    }
  } catch (err) {
    console.error("Failed to load current parlays:", err);
    container.innerHTML = '<div class="error-parlay-history">Failed to load current parlays. Please try again.</div>';
  }
}

// Load and render parlay history in menu
async function loadAndRenderMenuParlayHistory() {
  const container = document.getElementById("menu-parlay-history-container");
  if (!container) return;
  
  try {
    container.innerHTML = '<div class="section-loading"><div class="loading-spinner"></div>Loading parlay history...</div>';
    
    const uid = await getUserId(currentEnvironment);
    const res = await authenticatedFetch(`${BACKEND_BASE_URL}/api/parlay-history/${uid}`);
    
    if (!res.ok) {
      throw new Error(`Failed to load parlay history: ${res.status}`);
    }
    
    const data = await res.json();
    const parlays = data.parlays || [];
    
    if (parlays.length === 0) {
      container.innerHTML = '<div class="empty-parlay-history">No parlays yet. Place your first bet!</div>';
      return;
    }
    
    // Filter by current environment AND only show fully settled parlays (no pending legs)
    const filteredParlays = parlays.filter(p => {
      const parlayData = typeof p.parlay_data === 'string' ? JSON.parse(p.parlay_data) : p.parlay_data || [];
      const matchesEnvironment = parlayData.length > 0 && parlayData[0].environment === currentEnvironment;
      // Only include if all legs are settled (no pending legs)
      return matchesEnvironment && !hasPendingLegs(p);
    });
    
    if (filteredParlays.length === 0) {
      container.innerHTML = `<div class="empty-parlay-history">No completed parlays for ${currentEnvironment} environment yet.</div>`;
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

function showWithdrawOverlay() {
  const overlay = document.getElementById("withdraw-overlay");
  if (!overlay) return;
  
  loadWalletBalance();
  
  // Reset amount input
  const amountInput = document.getElementById("withdraw-amount-input");
  if (amountInput) {
    amountInput.value = "";
  }
  
  // Reset button
  const confirmBtn = document.getElementById("confirm-withdraw-btn");
  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.textContent = "Request Withdrawal";
  }
  
  overlay.classList.remove("hidden");
}

function closeWithdrawOverlay() {
  const overlay = document.getElementById("withdraw-overlay");
  if (overlay) {
    overlay.classList.add("hidden");
  }
}

async function handleWithdraw() {
  const amountInput = document.getElementById("withdraw-amount-input");
  const amount = parseFloat(amountInput?.value) || 0;
  const confirmBtn = document.getElementById("confirm-withdraw-btn");
  const errorMessage = document.getElementById("withdraw-error-message");
  
  // Hide any previous errors
  if (errorMessage) {
    errorMessage.classList.add("hidden");
  }
  
  if (amount <= 0) {
    if (errorMessage) {
      errorMessage.textContent = "Please enter a valid withdrawal amount";
      errorMessage.classList.remove("hidden");
    }
    return;
  }
  
  try {
    const uid = await getUserId(currentEnvironment);
    const balance = await loadWalletBalance();
    
    if (amount > balance) {
      if (errorMessage) {
        errorMessage.textContent = `Insufficient balance. You have $${balance.toFixed(2)}, need $${amount.toFixed(2)}`;
        errorMessage.classList.remove("hidden");
      }
      return;
    }
    
    // Log user ID for debugging
    console.log(`[Withdraw] User ID: ${uid}`);
    
    // Stripe Connect check removed - using Coinbase CDP for payments now
    
    // Check platform balance (optional - for better error messages)
    try {
      const platformBalanceRes = await authenticatedFetch(`${BACKEND_BASE_URL}/api/platform-balance`);
      if (platformBalanceRes.ok) {
        const platformData = await platformBalanceRes.json();
        console.log(`[Withdraw] Platform balance: $${platformData.available.toFixed(2)}`);
        if (platformData.available < amount) {
          if (errorMessage) {
            errorMessage.textContent = `Platform account has insufficient funds ($${platformData.available.toFixed(2)}). This is a test mode limitation. In production, funds from credit purchases will be available.`;
            errorMessage.classList.remove("hidden");
          }
          return;
        }
      }
    } catch (balanceErr) {
      console.warn("Could not check platform balance:", balanceErr);
      // Continue anyway - backend will handle it
    }
    
    // Disable button
    if (confirmBtn) {
      confirmBtn.disabled = true;
      confirmBtn.textContent = "Processing...";
    }
    
    // Call withdrawal API
    const res = await authenticatedFetch(`${BACKEND_BASE_URL}/api/withdraw/${uid}`, {
      method: 'POST',
      body: JSON.stringify({ amount })
    });
    
    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      // Show the actual error message
      const errorMsg = error.error || error.details || `Failed to process withdrawal (${res.status})`;
      if (errorMessage) {
        errorMessage.textContent = `❌ ${errorMsg}`;
        errorMessage.classList.remove("hidden");
      }
      if (confirmBtn) {
        confirmBtn.disabled = false;
        confirmBtn.textContent = "Request Withdrawal";
      }
      return;
    }
    
    const data = await res.json();
    
    console.log("[Withdraw] Withdrawal successful:", data);
    
    // Refresh wallet balance
    await loadWalletBalance();
    
    // Close the overlay
    closeWithdrawOverlay();
    
    // Show success message in extension (not browser alert)
    // The success will be visible when they refresh their wallet balance
    
  } catch (err) {
    console.error("Failed to process withdrawal:", err);
    if (errorMessage) {
      errorMessage.textContent = `❌ Failed to process withdrawal: ${err.message}`;
      errorMessage.classList.remove("hidden");
    }
    
    if (confirmBtn) {
      confirmBtn.disabled = false;
      confirmBtn.textContent = "Request Withdrawal";
    }
  }
}

function showBuyCreditsOverlay() {
  const overlay = document.getElementById("buy-credits-overlay");
  if (!overlay) return;
  
  loadWalletBalance();
  
  // Reset amount input
  const amountInput = document.getElementById("buy-credits-amount-input");
  if (amountInput) {
    amountInput.value = "";
  }
  
  // Reset button
  const confirmBtn = document.getElementById("confirm-buy-credits-btn");
  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.textContent = "Continue to Payment";
  }
  
  overlay.classList.remove("hidden");
}

function closeBuyCreditsOverlay() {
  const overlay = document.getElementById("buy-credits-overlay");
  if (overlay) {
    overlay.classList.add("hidden");
  }
}

// Profile-specific handlers
async function handleTopUpAccount() {
  try {
    const uid = await getUserId(currentEnvironment);
    
    console.log("[Top Up] Getting Coinbase onramp link...");
    
    // Get Coinbase onramp link without preset amount
    const url = `${BACKEND_BASE_URL}/api/coinbase-onramp/${uid}`;
    const res = await authenticatedFetch(url, {
      method: 'GET'
    });
    
    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(error.error || error.details || `Failed to get onramp link: ${res.status}`);
    }
    
    const { onrampUrl, walletAddress } = await res.json();
    
    console.log("[Top Up] Opening Coinbase Onramp:", onrampUrl);
    console.log("[Top Up] Wallet address:", walletAddress);
    
    // Show wallet address and instructions
    const message = `Your wallet address: ${walletAddress}\n\nOpening Coinbase onramp. Your balance will update automatically once the transaction confirms on Solana (usually takes 1-2 minutes).`;
    alert(message);
    
    // Open Coinbase onramp in new tab
    chrome.tabs.create({ url: onrampUrl });
    
    // Refresh balance after a delay (to catch the deposit)
    setTimeout(() => {
      refreshWalletBalance();
    }, 60000); // Refresh after 1 minute
    
  } catch (err) {
    console.error("[Top Up] Failed to get onramp link:", err);
    showNotification(`Failed to open deposit page: ${err.message}`, 'error');
  }
}

async function handleProfileBuyCredits() {
  const amountInput = document.getElementById("profile-buy-credits-amount-input");
  const amount = parseFloat(amountInput?.value) || 0;
  const confirmBtn = document.getElementById("profile-confirm-buy-credits-btn");
  const errorMessage = document.getElementById("profile-buy-credits-error-message");
  
  // Hide any previous errors
  if (errorMessage) {
    errorMessage.classList.add("hidden");
  }
  
  // Note: Amount validation removed - Coinbase onramp handles this
  // But we can still validate for UX
  if (amount > 0 && amount < 1) {
    if (errorMessage) {
      errorMessage.textContent = "Minimum purchase is $1";
      errorMessage.classList.remove("hidden");
    }
    return;
  }
  
  try {
    const uid = await getUserId(currentEnvironment);
    
    // Disable button
    if (confirmBtn) {
      confirmBtn.disabled = true;
      confirmBtn.textContent = "Loading...";
    }
    
    console.log("[Buy Credits] Getting Coinbase onramp link...");
    
    // Get Coinbase onramp link
    const url = `${BACKEND_BASE_URL}/api/coinbase-onramp/${uid}${amount > 0 ? `?amount=${amount}` : ''}`;
    const res = await authenticatedFetch(url, {
      method: 'GET'
    });
    
    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(error.error || error.details || `Failed to get onramp link: ${res.status}`);
    }
    
    const { onrampUrl, walletAddress } = await res.json();
    
    console.log("[Buy Credits] Opening Coinbase Onramp:", onrampUrl);
    console.log("[Buy Credits] Wallet address:", walletAddress);
    
    // Show wallet address and instructions
    const message = `Your wallet address: ${walletAddress}\n\nOpening Coinbase onramp. Your balance will update automatically once the transaction confirms on Solana (usually takes 1-2 minutes).`;
    alert(message);
    
    // Open Coinbase onramp in new tab
    chrome.tabs.create({ url: onrampUrl });
    
    // Return to profile main view
    showProfileMainView();
    
    // Refresh balance after a delay (to catch the deposit)
    setTimeout(() => {
      refreshWalletBalance();
    }, 60000); // Refresh after 1 minute
    
  } catch (err) {
    console.error("[Buy Credits] Failed to get onramp link:", err);
    if (errorMessage) {
      errorMessage.textContent = `❌ Failed to open deposit page: ${err.message}\n\nPlease try again.`;
      errorMessage.classList.remove("hidden");
    } else {
      showNotification(`Failed to open deposit page: ${err.message}`, 'error');
    }
    
    if (confirmBtn) {
      confirmBtn.disabled = false;
      confirmBtn.textContent = "Continue to Payment";
    }
  }
}

async function handleProfileWithdraw() {
  const amountInput = document.getElementById("profile-withdraw-amount-input");
  const amount = parseFloat(amountInput?.value) || 0;
  const confirmBtn = document.getElementById("profile-confirm-withdraw-btn");
  const errorMessage = document.getElementById("profile-withdraw-error-message");
  
  // Hide any previous errors
  if (errorMessage) {
    errorMessage.classList.add("hidden");
  }
  
  if (amount <= 0) {
    if (errorMessage) {
      errorMessage.textContent = "Please enter a valid withdrawal amount";
      errorMessage.classList.remove("hidden");
    }
    return;
  }
  
  try {
    const uid = await getUserId(currentEnvironment);
    const balance = await loadWalletBalance();
    
    if (amount > balance) {
      if (errorMessage) {
        errorMessage.textContent = `Insufficient balance. You have $${balance.toFixed(2)}, need $${amount.toFixed(2)}`;
        errorMessage.classList.remove("hidden");
      }
      return;
    }
    
    // Log user ID for debugging
    console.log(`[Withdraw] User ID: ${uid}`);
    
    // Stripe Connect check removed - using Coinbase CDP for payments now
    
    // Disable button
    if (confirmBtn) {
      confirmBtn.disabled = true;
      confirmBtn.textContent = "Processing...";
    }
    
    // Call withdrawal API
    const res = await authenticatedFetch(`${BACKEND_BASE_URL}/api/withdraw/${uid}`, {
      method: 'POST',
      body: JSON.stringify({ amount })
    });
    
    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      const errorMsg = error.error || error.details || `Failed to process withdrawal (${res.status})`;
      if (errorMessage) {
        errorMessage.textContent = `❌ ${errorMsg}`;
        errorMessage.classList.remove("hidden");
      }
      if (confirmBtn) {
        confirmBtn.disabled = false;
        confirmBtn.textContent = "Request Withdrawal";
      }
      return;
    }
    
    const data = await res.json();
    
    console.log("[Withdraw] Withdrawal successful:", data);
    
    // Refresh wallet balance
    await loadWalletBalance();
    
    // Return to profile main view
    showProfileMainView();
    
  } catch (err) {
    console.error("Failed to process withdrawal:", err);
    if (errorMessage) {
      errorMessage.textContent = `❌ Failed to process withdrawal: ${err.message}`;
      errorMessage.classList.remove("hidden");
    }
    
    if (confirmBtn) {
      confirmBtn.disabled = false;
      confirmBtn.textContent = "Request Withdrawal";
    }
  }
}

async function handleBuyCredits() {
  const amountInput = document.getElementById("buy-credits-amount-input");
  const amount = parseFloat(amountInput?.value) || 0;
  const confirmBtn = document.getElementById("confirm-buy-credits-btn");
  const errorMessage = document.getElementById("buy-credits-error-message");
  
  // Hide any previous errors
  if (errorMessage) {
    errorMessage.classList.add("hidden");
  }
  
  // Note: Amount validation removed - Coinbase onramp handles this
  // But we can still validate for UX
  if (amount > 0 && amount < 1) {
    if (errorMessage) {
      errorMessage.textContent = "Minimum purchase is $1";
      errorMessage.classList.remove("hidden");
    }
    return;
  }
  
  try {
    const uid = await getUserId(currentEnvironment);
    
    // Disable button
    if (confirmBtn) {
      confirmBtn.disabled = true;
      confirmBtn.textContent = "Loading...";
    }
    
    console.log("[Buy Credits] Getting Coinbase onramp link...");
    
    // Get Coinbase onramp link
    const url = `${BACKEND_BASE_URL}/api/coinbase-onramp/${uid}${amount > 0 ? `?amount=${amount}` : ''}`;
    const res = await authenticatedFetch(url, {
      method: 'GET'
    });
    
    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(error.error || error.details || `Failed to get onramp link: ${res.status}`);
    }
    
    const { onrampUrl, walletAddress } = await res.json();
    
    console.log("[Buy Credits] Opening Coinbase Onramp:", onrampUrl);
    console.log("[Buy Credits] Wallet address:", walletAddress);
    
    // Show wallet address and instructions
    const message = `Your wallet address: ${walletAddress}\n\nOpening Coinbase onramp. Your balance will update automatically once the transaction confirms on Solana (usually takes 1-2 minutes).`;
    alert(message);
    
    // Open Coinbase onramp in new tab
    chrome.tabs.create({ url: onrampUrl });
    
    // Close the overlay
    closeBuyCreditsOverlay();
    
    // Refresh balance after a delay (to catch the deposit)
    setTimeout(() => {
      refreshWalletBalance();
    }, 60000); // Refresh after 1 minute
    
  } catch (err) {
    console.error("[Buy Credits] Failed to get onramp link:", err);
    const errorMessage = document.getElementById("buy-credits-error-message");
    if (errorMessage) {
      errorMessage.textContent = `❌ Failed to open deposit page: ${err.message}\n\nPlease try again.`;
      errorMessage.classList.remove("hidden");
    } else {
      showNotification(`Failed to open deposit page: ${err.message}`, 'error');
    }
    
    if (confirmBtn) {
      confirmBtn.disabled = false;
      confirmBtn.textContent = "Continue to Payment";
    }
  }
}

// App initialization is now handled by initializeApp() above
// This ensures Supabase is ready before init() runs

// Also add error handler for uncaught errors
window.addEventListener('error', (event) => {
  console.error('Uncaught error:', event.error);
  // Ensure login overlay is visible even on error
  const loginOverlay = document.getElementById('login-overlay');
  const appContent = document.querySelector('.app');
  if (loginOverlay) loginOverlay.classList.remove('hidden');
  if (appContent) appContent.style.display = 'none';
});


