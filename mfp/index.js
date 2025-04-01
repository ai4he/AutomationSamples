/***************************************************
 * Configuration Variables
 ***************************************************/
var serverDomain = "gpu.haielab.org";
// You can override the domain or keep the same
// let serverDomain = "n8n.haielab.org";

// Master toggles for LLM model (if you want to set a default)
var llmModel = "gemini";

// If false => skip alt part number logic entirely
let configUseAlternatives = true;

// 0 => only direct alternatives of the typed part
// 1 => (default) one level deeper expansions
// -1 => infinite expansions until no new parts discovered
let configNestedLevel = 1;

// Maximum number of alternative parts to find initially
let initialAltLimit = 3;

// Default timeout for fetch requests (ms)
const API_TIMEOUT = 15000;
// Longer timeout for critical/potentially slow endpoints (ms)
const LONG_API_TIMEOUT = 30000;

// --- State for Pause/Continue Mechanism ---
// Flag to indicate if the search is currently paused (after initial limit)
let isPaused = false;
// Flag to indicate if we are in the initial limited search phase
let limitedSearchMode = true;
// Counter for alternatives found during the current search phase
let altCountFound = 0;
// State for paused search - stores the exploration state needed for resuming
let pausedSearchState = {
  isActive: false,
  pendingExploration: [], // Array of { number, level } to explore after continue
  visited: new Set(),     // The visited set *at the time of pause*
  finalAlts: [],          // The alternatives array *at the time of pause*
  onNewAltsCallback: null // The callback function
};
// --- End Pause/Continue State ---

// Stores the entire conversation as an array of message objects:
// e.g. [ { role: "user", content: "Hello" }, { role: "assistant", content: "Hi!" }, ... ]
let conversationHistory = [];

// We'll also store a reference to the chat container so we can re-render the conversation easily
let chatContainer = null;

// Prevents repeated calls to performFinalAnalysis
let analysisAlreadyCalled = false;

// Flag to indicate if search should be stopped by user
let stopSearchRequested = false;

/***************************************************
 * Global aggregator for endpoint results
 ***************************************************/
let searchResults = {
  amazonConnector: [],
  ebayConnector: [],
  amazon: [],
  ebay: [],
  ingram: [],
  tdsynnex: [],
  brokerbin: [],
  epicor: [],
  sales: [],
  purchases: [],
  lenovo: []
};

// Keep track of how many endpoint requests are currently active
let activeRequestsCount = 0;

// Flag for whether alternative expansions are still in progress
let expansionsInProgress = false;

// **NO STRAY IDENTIFIERS HERE**

/***************************************************
 * Helper: Create AbortController with timeout
 ***************************************************/
function createFetchController(timeout = API_TIMEOUT) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    console.warn(`Request timed out after ${timeout}ms. Aborting.`);
    controller.abort();
  }, timeout);
  return { controller, timeoutId };
}

/***************************************************
 * Helper: Safe JSON parsing with Content-Type Check
 ***************************************************/
async function safelyParseJSON(response, url = '') {
  try {
    const contentType = response.headers.get('content-type');
    // Allow JSON derivatives like application/vnd.api+json
    if (!contentType || !contentType.includes('application/json')) {
      const textResponse = await response.text(); // Read text to avoid unconsumed body errors
      console.warn(`Response from ${url} is not JSON (Content-Type: ${contentType}). Body: ${textResponse.substring(0, 200)}...`);
      return null;
    }

    const text = await response.text();
    if (!text || text.trim() === '') {
      console.warn(`Empty JSON response received from ${url}`);
      return null;
    }
    // Add extra try...catch specifically for JSON.parse
    try {
         return JSON.parse(text);
    } catch (parseError) {
         console.error(`JSON.parse error for ${url}: ${parseError.message}. Response text: ${text.substring(0, 500)}...`);
         return null; // Return null if parsing fails
    }
  } catch (err) {
    // Catch errors reading response body (e.g., network errors during text())
    console.error(`Error reading/parsing JSON response body from ${url}:`, err);
    return null;
  }
}

/***************************************************
 * Stop Search Function (User Initiated)
 ***************************************************/
function stopSearch() {
  stopSearchRequested = true;
  isPaused = false; // Ensure pause state is cleared if user stops
  console.log("User requested search stop.");

  // Hide spinner and stop button
  const spinner = document.getElementById('loading-spinner');
  const stopBtn = document.getElementById('stop-search-btn');
  if (spinner) spinner.style.display = 'none';
  if (stopBtn) stopBtn.style.display = 'none';

   // Remove continue button if present
  const continueBtn = document.getElementById('continue-search-btn');
  if (continueBtn) continueBtn.remove();
  const continueMsg = document.getElementById('continue-search-message');
  if (continueMsg) continueMsg.remove();


  // Show a message in the summary tab
  const summaryDiv = document.getElementById('summary-content');
  if (summaryDiv && !summaryDiv.querySelector('.search-stopped-message')) {
    const stoppedMessage = document.createElement('div');
    stoppedMessage.className = 'search-stopped-message';
    stoppedMessage.innerHTML = '<p><strong>Search was stopped by user.</strong> Partial results are displayed.</p>';
    stoppedMessage.style.cssText = 'padding: 10px; background-color: #ffecec; border: 1px solid #f5c6cb; border-radius: 4px; margin-bottom: 15px;';
    summaryDiv.prepend(stoppedMessage);
  }

  // Update the summary with current partial results
  updateSummaryTab();
  // Consider if we need to abort ongoing fetch requests here
  // AbortController instances would need to be stored globally or passed around to achieve this.
}

/***************************************************
 * Clean UI for new search
 ***************************************************/
function cleanupUI() {
  console.log("Cleaning UI for new search...");
  // Clean alternative numbers div and remove continue button/message
  const altDiv = document.getElementById('alternative-numbers');
  if (altDiv) {
      altDiv.innerHTML = '';
      altDiv.classList.remove('active');
      const continueBtn = document.getElementById('continue-search-btn');
      if (continueBtn) continueBtn.remove();
      const continueMsg = document.getElementById('continue-search-message');
      if (continueMsg) continueMsg.remove();
  }

  // Reset summary
  const summaryDiv = document.getElementById('summary-content');
  if (summaryDiv) summaryDiv.innerHTML = '';

  // Clear each vendor's results container
  const resultContainers = [
    '.tdsynnex-results .results-container',
    '.ingram-results .results-container',
    '.brokerbin-results .results-container',
    '.ebay-results .results-container',
    '.amazon-results .results-container',
    '.ebay-connector-results .results-container',
    '.amazon-connector-results .results-container',
    '#inventory-content .inventory-results',
    '#sales-content .sales-results',
    '#purchases-content .purchases-results'
  ];

  resultContainers.forEach(selector => {
    const container = document.querySelector(selector);
    if (container) container.innerHTML = '';
  });

  // Clear Lenovo tabs
  const lenovoSubtabs = document.getElementById('lenovo-subtabs');
  const lenovoSubcontent = document.getElementById('lenovo-subcontent');
  if (lenovoSubtabs) lenovoSubtabs.innerHTML = '';
  if (lenovoSubcontent) lenovoSubcontent.innerHTML = '';

  // Clear analysis tab
  const analysisDiv = document.getElementById('analysis-content');
  if (analysisDiv) {
    const analyzeResultTextDiv = analysisDiv.querySelector('.analyze-result-text');
    if (analyzeResultTextDiv) analyzeResultTextDiv.innerHTML = '';
    const chatContainer = document.getElementById('chat-container-analysis');
    if (chatContainer) chatContainer.innerHTML = '';
  }

  // Hide any loading indicators
  const loadingElements = document.querySelectorAll('.loading');
  loadingElements.forEach(el => {
    if (el) el.style.display = 'none';
  });
    // Hide stop button initially
  const stopBtn = document.getElementById('stop-search-btn');
  if (stopBtn) stopBtn.style.display = 'none';
}

/***************************************************
 * Utility: parse XML
 ***************************************************/
function parseXML(xmlString) {
  const parser = new DOMParser();
  return parser.parseFromString(xmlString, "text/xml");
}

/***************************************************
 * Utility: parse Price (for $ strings, etc.)
 ***************************************************/
function parsePrice(str) {
  if (!str) return null;
  const numeric = parseFloat(String(str).replace(/[^\d.-]/g, '')); // Added dot to regex
  return isNaN(numeric) ? null : numeric;
}

/***************************************************
 * Table Sorting
 ***************************************************/
function makeTableSortable(table) {
  const headers = table.querySelectorAll("th");
  headers.forEach((header, index) => {
    // Don't make image columns sortable
    if (header.classList.contains('no-sort')) return;

    header.style.cursor = "pointer";
    // Add sort icons (optional, requires CSS)
    let sortIcon = header.querySelector('.sort-icon');
    if (!sortIcon) {
        sortIcon = document.createElement('span');
        sortIcon.className = 'sort-icon';
        header.appendChild(sortIcon);
    }


    header.addEventListener("click", () => {
      // Find the current sort state across the entire table
      let currentSortCol = -1;
      let currentSortOrder = 'none';
      headers.forEach((h, i) => {
          const order = h.getAttribute("data-sort-order");
          if (order) {
              currentSortCol = i;
              currentSortOrder = order;
          }
      });

      let newOrder;
      if (index === currentSortCol) {
          // Clicked same column, reverse order
          newOrder = currentSortOrder === "asc" ? "desc" : "asc";
      } else {
          // Clicked new column, default to descending for dates/numerics, ascending for text
          const headerText = header?.textContent.trim().toLowerCase() || '';
          const isDateOrNumeric = headerText.includes('date') || headerText.includes('qty') || headerText.includes('quantity') || headerText.includes('price') || headerText.includes('cost') || headerText.includes('age') || headerText.includes('num') || headerText.includes('line');
          newOrder = isDateOrNumeric ? 'desc' : 'asc';
      }


      // Remove sort order from all headers first
       headers.forEach(h => {
           h.removeAttribute("data-sort-order");
           const icon = h.querySelector('.sort-icon');
           if(icon) icon.textContent = ''; // Clear other icons
       });

      sortTableByColumn(table, index, newOrder === 'asc');
      header.setAttribute("data-sort-order", newOrder);
      // Update icon (optional, requires CSS)
       const icon = header.querySelector('.sort-icon');
       if(icon) icon.textContent = newOrder === 'asc' ? ' ▲' : ' ▼';
    });
  });
}

function sortTableByColumn(table, columnIndex, asc = true) {
  const tbody = table.tBodies[0];
  if (!tbody) return;
  const rows = Array.from(tbody.querySelectorAll("tr"));

  // Get the column header text to determine if it might be a date column
  const headerText = table.querySelector(`th:nth-child(${columnIndex + 1})`)?.textContent.trim().toLowerCase() || '';
  const isDateColumn = headerText.includes('date');
  const isNumericColumn = headerText.includes('qty') || headerText.includes('quantity') || headerText.includes('price') || headerText.includes('cost') || headerText.includes('age') || headerText.includes('num') || headerText.includes('line') || headerText.includes('reviews');

  rows.sort((a, b) => {
    const aCell = a.children[columnIndex];
    const bCell = b.children[columnIndex];
    if (!aCell || !bCell) return 0;

    const aText = aCell.textContent.trim();
    const bText = bCell.textContent.trim();

    // 1. Date Sorting
    if (isDateColumn) {
      // Use data-date attribute if available (preferred)
      const aDataDate = aCell.getAttribute('data-date');
      const bDataDate = bCell.getAttribute('data-date');
      // Use attribute if present, otherwise fall back to text content
      const aDate = new Date(aDataDate || aText);
      const bDate = new Date(bDataDate || bText);

      // Handle invalid dates (push them to the bottom)
      const aValid = !isNaN(aDate.getTime()) && aDate.getFullYear() > 1900; // Basic validity check
      const bValid = !isNaN(bDate.getTime()) && bDate.getFullYear() > 1900;

      if (aValid && bValid) return asc ? aDate - bDate : bDate - aDate;
      if (aValid && !bValid) return -1; // a comes first
      if (!aValid && bValid) return 1;  // b comes first
      return 0; // Both invalid
    }

    // 2. Numeric Sorting
    if (isNumericColumn) {
        // More robust parsing: remove $, commas, etc. before parseFloat
        const aNum = parseFloat(aText.replace(/[^0-9.-]/g, ""));
        const bNum = parseFloat(bText.replace(/[^0-9.-]/g, ""));
        const aValid = !isNaN(aNum);
        const bValid = !isNaN(bNum);

        if (aValid && bValid) return asc ? aNum - bNum : bNum - aNum;
        if (aValid && !bValid) return -1; // Valid numbers first
        if (!aValid && bValid) return 1;
        // Fallback to string compare if one/both aren't numbers but column header suggests they should be
    }

    // 3. String Sorting (default)
    // localeCompare with numeric option handles strings containing numbers better ("Item 2" vs "Item 10")
    return asc ? aText.localeCompare(bText, undefined, {numeric: true, sensitivity: 'base'}) : bText.localeCompare(aText, undefined, {numeric: true, sensitivity: 'base'});
  });

  // Re-append rows in sorted order
  rows.forEach(row => tbody.appendChild(row));
}


/***************************************************
 * Switch Tab
 ***************************************************/
function switchTab(tabId) {
  document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
  document.querySelectorAll('.tab-button').forEach(button => button.classList.remove('active'));
  const contentTab = document.getElementById(tabId);
  if (contentTab) contentTab.classList.add('active');
  const buttonTab = document.querySelector(`button[onclick="switchTab('${tabId}')"]`);
   if (buttonTab) buttonTab.classList.add('active');
}

/***************************************************
 * getAlternativePartNumbers: obtains direct alt parts (1 level).
 ***************************************************/
async function getAlternativePartNumbers(partNumber) {
  const url = `https://${serverDomain}/webhook/get-parts?item=${encodeURIComponent(partNumber)}`;
  try {
    const { controller, timeoutId } = createFetchController();

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok) {
      console.warn(`Alternative parts request for ${partNumber} failed with status: ${response.status}`);
      return { original: partNumber, description: '', category: '', alternatives: [] };
    }

    const data = await safelyParseJSON(response, url);
    if (!data || !data[0]) {
       console.log(`No alternative part data found for ${partNumber}`);
      return { original: partNumber, description: '', category: '', alternatives: [] };
    }

    const record = data[0];
    const description = record.Description || '';
    const category = record.Category || '';
    // Ensure originalPart is always a string, fallback to input partNumber
    const originalPart = (record.ORD && String(record.ORD).trim()) ? String(record.ORD).trim() : partNumber;


    // Build structured alt array, ensuring values are strings and trimmed
    const alternatives = [];
     const processAltArray = (key, type) => {
         if (record[key] && Array.isArray(record[key])) {
             record[key].forEach(num => {
                 const strNum = String(num).trim(); // Ensure string and trim
                 if (strNum) alternatives.push({ type: type, value: strNum });
             });
         }
     };

     processAltArray('FRU', 'FRU');
     processAltArray('MFG', 'MFG');
     processAltArray('OEM', 'OEM');
     processAltArray('OPT', 'OPT');


    // Filter out any alternatives that match the original part number (case-insensitive)
    const originalUpper = originalPart.toUpperCase();
    const validAlternatives = alternatives.filter(alt => alt.value.toUpperCase() !== originalUpper);


    console.log(`Found ${validAlternatives.length} distinct alternatives for ${originalPart}`);
    return { original: originalPart, description, category, alternatives: validAlternatives };
  } catch (err) {
    if (err.name === 'AbortError') {
      console.error(`Alternative parts request timed out for ${partNumber}`);
    } else {
      console.error(`Error fetching alternative part numbers for ${partNumber}:`, err);
    }
    // Return input part number as original in case of error
    return { original: partNumber, description: '', category: '', alternatives: [] };
  }
}

/**
 * Launches alternative expansions. Handles initial limited search and continuation.
 *
 * @param {string} baseNumber - The initial part number to expand
 * @param {Array} finalAlts   - The shared array where discovered alt objects go {type, value}
 * @param {Function} onNewAlts - Callback invoked whenever new alt(s) appear
 */
function startExpansions(baseNumber, finalAlts, onNewAlts) {
  // Reset flags and state for a new search
  isPaused = false;
  altCountFound = 0;
  limitedSearchMode = true; // Start in limited mode
  pausedSearchState = { isActive: false, pendingExploration: [], visited: new Set(), finalAlts: [], onNewAltsCallback: null };

  console.log(`Starting expansions for ${baseNumber}, initial limit: ${initialAltLimit}`);
  expansionsInProgress = true;
  const visited = new Set(); // Track visited parts for *this expansion process*

  // Make sure the initial base number is marked as visited for the expansion logic
  visited.add(baseNumber.trim().toUpperCase());


  // Run gatherCombinatoryAlternatives - this handles both initial and continued search internally now
  gatherCombinatoryAlternatives(baseNumber, 0, visited, finalAlts, onNewAlts)
    .then(() => {
      console.log("Expansion process completed or paused.");
      expansionsInProgress = false;
      // If it finished because it paused, the button is added inside gatherCombinatoryAlternatives
      // If it finished completely (not paused), proceed to check if all done.
      if (!isPaused) {
          checkIfAllDone();
      } else {
           // If paused, update summary to show partial results
           updateSummaryTab();
           // Hide spinner even if paused
            const spinner = document.getElementById('loading-spinner');
            if (spinner) spinner.style.display = 'none';
      }
    })
    .catch(err => {
      console.error('Error during alternative expansions:', err);
      expansionsInProgress = false;
      isPaused = false; // Ensure not stuck in paused state on error
      checkIfAllDone();
    });
}

/***************************************************
 * Function to add continue search button
 ***************************************************/
function addContinueSearchButton() {
  const altDiv = document.getElementById('alternative-numbers');
  if (!altDiv || document.getElementById('continue-search-btn')) return; // Don't add if exists


  console.log("Adding 'Continue Search' button.");

  // Create message
  const messageDiv = document.createElement('div');
  messageDiv.id = 'continue-search-message';
  messageDiv.innerHTML = `<p style="color:#4CAF50; font-weight:bold; margin-top:15px;">Initial search found ${altCountFound} alternatives. Click below to find more.</p>`;


  // Create continue button
  const continueBtn = document.createElement('button');
  continueBtn.id = 'continue-search-btn';
  continueBtn.textContent = 'Continue Searching for More Parts';
  continueBtn.style.cssText = 'margin-top: 10px; background-color: #4CAF50; color: white; padding: 10px 20px; font-size: 16px; font-weight: bold; width: 100%; border: none; border-radius: 4px; cursor: pointer;';
  continueBtn.addEventListener('mouseover', () => continueBtn.style.backgroundColor = '#45a049');
  continueBtn.addEventListener('mouseout', () => continueBtn.style.backgroundColor = '#4CAF50');


  continueBtn.addEventListener('click', async () => {
    console.log("'Continue Search' button clicked.");

    // Remove UI elements immediately
    continueBtn.remove();
    const msgDiv = document.getElementById('continue-search-message');
    if (msgDiv) msgDiv.remove();

    // Check if we have valid paused state
    if (!pausedSearchState.isActive) { // Removed check for pendingExploration as it might be empty if pause hit right at end of level
        console.error("Cannot continue search, paused state is not active or invalid.");
        isPaused = false; // Ensure we are unpaused even if state was bad
        return;
    }

    // --- Resume Search ---
    isPaused = false;           // Unpause FIRST
    limitedSearchMode = false;  // Switch to unlimited mode
    expansionsInProgress = true;// Mark as in progress again

    // Show spinner again
    const spinner = document.getElementById('loading-spinner');
    if (spinner) spinner.style.display = 'inline-block';

    // Get the saved state - IMPORTANT: Use the state *as it was when saved*
    const { pendingExploration, visited, finalAlts, onNewAltsCallback } = pausedSearchState;
    console.log(`Resuming search. ${pendingExploration.length} pending explorations. Visited count at pause: ${visited.size}. Current alts count: ${finalAlts.length}.`);

    // Clear the global paused state now that we're using it
    pausedSearchState = { isActive: false, pendingExploration: [], visited: new Set(), finalAlts: [], onNewAltsCallback: null };

    // Create promises for each pending exploration path using the *saved visited set*
    const resumePromises = pendingExploration.map(item =>
      gatherCombinatoryAlternatives(item.number, item.level, visited, finalAlts, onNewAltsCallback)
    );

    try {
        // Wait for all resumed branches to complete
        await Promise.all(resumePromises);
        console.log("Resumed expansion process completed.");
        expansionsInProgress = false;
        checkIfAllDone(); // Check if everything is finished now
    } catch (err) {
        console.error('Error during resumed alternative expansions:', err);
        expansionsInProgress = false;
        checkIfAllDone();
    }
    // --- End Resume Search ---
  });

   // Append message and button
  altDiv.appendChild(messageDiv);
  altDiv.appendChild(continueBtn);
}

/***************************************************
 * Recursive Gathering of Alt Parts (Handles Pause/Continue)
 ***************************************************/
async function gatherCombinatoryAlternatives(baseNumber, currentLevel, visited, result, onNewAlts) {
  // --- Immediate Stop/Pause Checks ---
  if (stopSearchRequested) {
    return;
  }
  // Check pause state *before* adding to visited or fetching
  if (isPaused) {
    return;
  }
   // Limit recursion depth if configNestedLevel is set (and not -1 for infinite)
   if (configNestedLevel !== -1 && currentLevel > configNestedLevel) {
       return;
   }
  // --- End Checks ---

  const upperBase = baseNumber.trim().toUpperCase();
  // Check visited *before* fetch
  if (visited.has(upperBase)) {
      return;
  }
  visited.add(upperBase);


  try {
    // Fetch alternatives for the current baseNumber
    const { alternatives } = await getAlternativePartNumbers(baseNumber);
    if (isPaused || stopSearchRequested) return; // Check again after await

    let newlyAdded = [];
    let pendingForThisLevel = []; // Parts found at this level to explore deeper

    for (const alt of alternatives) {
       // Re-check stop/pause conditions within the loop *before processing each alt*
      if (stopSearchRequested) return;
      if (isPaused) return; // If paused during the loop, stop processing this level

      const altUpper = alt.value.trim().toUpperCase();

      // Check if it's a truly new alternative (not visited and not already in results)
      if (!visited.has(altUpper) && !result.some(r => r.value.trim().toUpperCase() === altUpper)) {

        // --- Check Pause Condition ---
        if (limitedSearchMode && altCountFound >= initialAltLimit) {
          console.log(`Limit of ${initialAltLimit} alternatives reached while processing alternatives for ${baseNumber}. Pausing search.`);
          if (!isPaused) { // Ensure pause logic runs only once
              isPaused = true;

              // Save state for potential continuation
              // Find index of current 'alt' to determine remaining ones
              const currentIndex = alternatives.findIndex(a => a.value === alt.value);
              const remainingAlternatives = (currentIndex !== -1) ? alternatives.slice(currentIndex) : [];

              pausedSearchState = {
                isActive: true,
                pendingExploration: remainingAlternatives.map(p => ({ number: p.value, level: currentLevel + 1 })),
                visited: new Set(visited), // Copy the visited set at pause time
                finalAlts: result, // Reference to the final results array
                onNewAltsCallback: onNewAlts
              };
              console.log(`Paused state saved. Pending explorations at this point: ${pausedSearchState.pendingExploration.length}`);

              // Process any batch accumulated *before* hitting the limit in this loop iteration
              if (newlyAdded.length > 0 && onNewAlts) {
                await onNewAlts(newlyAdded);
                newlyAdded = []; // Clear batch after processing
              }

              addContinueSearchButton(); // Show the button
          }
          return; // Stop further processing in this branch once paused
          // --- End Pause Condition ---
        }

        // --- Add New Alternative (if not paused) ---
        result.push(alt);
        newlyAdded.push(alt);
        altCountFound++;
        console.log(`Found alternative #${altCountFound}: ${alt.type} - ${alt.value} (via ${baseNumber}, Level ${currentLevel})`);

        // Add to list for deeper exploration later in this function
        pendingForThisLevel.push({ number: alt.value, level: currentLevel + 1 });

      } else if (!visited.has(altUpper)) {
         // If it's already in 'result' but not 'visited', it means another branch found it first.
         // We still potentially need to explore *from* it if depth allows and it's not the original base.
          if (altUpper !== baseNumber.toUpperCase()) { // Avoid re-exploring the parent immediately
            pendingForThisLevel.push({ number: alt.value, level: currentLevel + 1 });
          }
      }
    } // End loop through alternatives for this level

    // Process the newly added alternatives from this level (if any were added before pausing/stopping)
    if (newlyAdded.length > 0 && onNewAlts) {
        // Check pause/stop again before calling back
        if (isPaused || stopSearchRequested) return;
        await onNewAlts(newlyAdded);
    }

    // --- Recursive Calls (if not paused/stopped and depth allows) ---
    if (!isPaused && !stopSearchRequested && (configNestedLevel === -1 || currentLevel < configNestedLevel)) {
        const explorationPromises = pendingForThisLevel.map(item =>
            gatherCombinatoryAlternatives(item.number, item.level, visited, result, onNewAlts)
        );
        await Promise.all(explorationPromises); // Explore children in parallel
    } else if (isPaused && pausedSearchState.isActive) {
        // If paused *after* iterating all children for this level, add them to pending state if they weren't already
        const currentPendingNumbers = new Set(pausedSearchState.pendingExploration.map(p => p.number.toUpperCase()));
        let addedToPending = 0;
        pendingForThisLevel.forEach(item => {
             if (!currentPendingNumbers.has(item.number.toUpperCase())) {
                 pausedSearchState.pendingExploration.push(item);
                 addedToPending++;
             }
         });
         // if (addedToPending > 0) console.log(`Added ${addedToPending} pending explorations from ${baseNumber} to overall paused state.`);
    }
    // --- End Recursive Calls ---

  } catch (err) {
    console.error(`Error during gathering alternatives for ${baseNumber}:`, err);
    // Don't necessarily stop the whole process, but log the error
  }
}


/***************************************************
 * Spinner, expansions, and final analysis check
 ***************************************************/
function checkIfAllDone() {
  // Don't proceed if search was stopped by user, paused, alternative expansions still running, or API requests active
  if (stopSearchRequested || isPaused || expansionsInProgress || activeRequestsCount > 0) {
    // Optional detailed logging for debugging state:
    // console.log(`CheckIfAllDone: Not done yet. State: stopReq=${stopSearchRequested}, paused=${isPaused}, expand=${expansionsInProgress}, reqs=${activeRequestsCount}`);
    return;
  }

  // Prevent calling analysis multiple times
  if (analysisAlreadyCalled) return;
  analysisAlreadyCalled = true;

  console.log("All expansions and requests completed. Performing final analysis.");

  // Hide spinner and stop button
  const spinner = document.getElementById('loading-spinner');
  const stopBtn = document.getElementById('stop-search-btn');
  if (spinner) spinner.style.display = 'none';
  if (stopBtn) stopBtn.style.display = 'none';

  performFinalAnalysis();
}

/***************************************************
 * Perform Final LLM Analysis
 ***************************************************/
async function performFinalAnalysis() {
  // One last summary update before analysis
  updateSummaryTab(true); // Pass true to indicate search completion

  try {
    const analysisData = gatherResultsForAnalysis();
    if (Object.keys(analysisData).length === 0) {
        console.log("No data gathered for analysis. Skipping LLM call.");
        // Optionally clear the analysis tab or show a message
        const analysisContent = document.getElementById('analysis-content');
        if(analysisContent) analysisContent.innerHTML = "<p>No data was found for the selected sources to analyze.</p>";
        return;
    }

    const selectedModel = document.getElementById('llm-model').value;
    const promptText = document.getElementById('prompt').value;

    const analyzeUrl = `https://${serverDomain}/webhook/analyze-data?model=${selectedModel}&prompt=${encodeURIComponent(promptText)}`;
    console.log("Sending data for final analysis...");

    const { controller, timeoutId } = createFetchController(LONG_API_TIMEOUT); // Longer timeout for analysis

    const response = await fetch(analyzeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(analysisData),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
        console.error(`Analysis request failed with status: ${response.status}`);
         const analysisContent = document.getElementById('analysis-content');
         if(analysisContent) analysisContent.innerHTML = `<div class='error'>Analysis request failed (Status: ${response.status}).</div>`;
        return;
    }

    const analyzeResult = await safelyParseJSON(response, analyzeUrl);
    if (!analyzeResult) {
      console.error('Failed to parse analysis results.');
      // Optionally display an error in the analysis tab
      const analysisContent = document.getElementById('analysis-content');
      if(analysisContent) analysisContent.innerHTML = "<div class='error'>Error retrieving analysis from the server (invalid format).</div>";
      return;
    }

    let analyzeResultText = '';
    if (Array.isArray(analyzeResult) && analyzeResult.length > 0 && analyzeResult[0].text) {
      analyzeResultText = analyzeResult[0].text;
    } else if (typeof analyzeResult === 'object') {
         // Handle cases where the response might be structured differently
         analyzeResultText = analyzeResult.result || analyzeResult.message || JSON.stringify(analyzeResult);
    } else {
      analyzeResultText = String(analyzeResult); // Fallback to string conversion
    }

    // Basic cleanup - remove markdown code blocks
    analyzeResultText = analyzeResultText
      .replace(/```html\b/gi, '')
      .replace(/```/g, '');

    // Attempt to render as HTML if it looks like HTML, otherwise render as text
    let finalContent = '';
    if (analyzeResultText.trim().startsWith('<') && analyzeResultText.trim().endsWith('>')) {
        try {
            // Use a temporary element to parse and sanitize if needed (basic example)
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = analyzeResultText;
            // Basic check if parsing resulted in meaningful elements
            if (tempDiv.children.length > 0 || tempDiv.textContent.trim().length > 0) {
                 finalContent = tempDiv.innerHTML; // Use parsed HTML
            } else {
                // If parsing results in empty body, treat as text
                finalContent = `<pre>${analyzeResultText.replace(/</g, "<").replace(/>/g, ">")}</pre>`;
            }
        } catch (e) {
            console.warn('Error parsing analysis result as HTML, displaying as text:', e);
            finalContent = `<pre>${analyzeResultText.replace(/</g, "<").replace(/>/g, ">")}</pre>`; // Display as preformatted text on error
        }
    } else {
         finalContent = `<pre>${analyzeResultText.replace(/</g, "<").replace(/>/g, ">")}</pre>`; // Wrap non-HTML in <pre> for formatting
    }


    // Store conversation history
    conversationHistory.push({ role: 'user', content: promptText || '(No prompt provided)' });
    conversationHistory.push({ role: 'assistant', content: finalContent });

    // Initialize the conversation UI in the analysis tab
    initializeConversationUI();

  } catch (err) {
    if (err.name === 'AbortError') {
      console.error('Analysis request timed out.');
       const analysisContent = document.getElementById('analysis-content');
      if(analysisContent) analysisContent.innerHTML = "<div class='error'>Analysis request timed out.</div>";
    } else {
      console.error('Error performing final analysis:', err);
       const analysisContent = document.getElementById('analysis-content');
       if(analysisContent) analysisContent.innerHTML = `<div class='error'>An error occurred during analysis: ${err.message}</div>`;
    }
  }
}

/***************************************************
 * LLM Chat Interface Functions
 ***************************************************/
function initializeConversationUI() {
  chatContainer = document.getElementById('chat-container-analysis');
  if (!chatContainer) {
    console.error('Chat container element not found in analysis tab');
    const analysisContent = document.getElementById('analysis-content');
    if(analysisContent) analysisContent.innerHTML += "<div class='error'>Chat UI failed to initialize.</div>"; // Add error to tab
    return;
  }
  renderConversationUI();
}

function renderConversationUI() {
  if (!chatContainer) return;

  let chatHTML = '<div class="chat-messages">';
  conversationHistory.forEach(msg => {
    const roleClass = msg.role === 'assistant' ? 'assistant' : 'user';
    const label = msg.role === 'assistant' ? 'Assistant' : 'You';
    // Use innerHTML directly as content might already be HTML or preformatted text
    chatHTML += `
        <div class="chat-message ${roleClass}">
          <strong>${label}:</strong>
          <div class="message-content">${msg.content}</div>
        </div>
      `;
  });
  chatHTML += '</div>'; // End chat-messages

  // Add input area
  chatHTML += `
    <div class="chat-input-area" style="margin-top: 15px; display: flex; gap: 5px;">
      <input type="text" id="chat-input" placeholder="Ask a follow-up question..." style="flex-grow: 1; padding: 8px; border: 1px solid #ccc; border-radius: 4px;">
      <button id="chat-send-btn" style="padding: 8px 15px; background-color: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer;">Send</button>
    </div>
  `;

  chatContainer.innerHTML = chatHTML;

  // Scroll to bottom
  const messagesDiv = chatContainer.querySelector('.chat-messages');
  if (messagesDiv) {
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  }

  // Add event listeners using replaceWith to avoid duplicates
  const sendBtn = document.getElementById('chat-send-btn');
  if (sendBtn) {
     const newSendBtn = sendBtn.cloneNode(true);
     sendBtn.parentNode.replaceChild(newSendBtn, sendBtn);
     newSendBtn.addEventListener('click', handleUserChatSubmit);
  }
  const inputField = document.getElementById('chat-input');
  if (inputField) {
     const newInputField = inputField.cloneNode(true);
     inputField.parentNode.replaceChild(newInputField, inputField);
     newInputField.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { // Send on Enter, allow Shift+Enter for newline
        e.preventDefault(); // Prevent default Enter behavior (like form submission)
        handleUserChatSubmit();
      }
    });
    // Focus input field after rendering
    // setTimeout(() => newInputField.focus(), 0); // Use timeout to ensure element is fully ready
  }
}

function handleUserChatSubmit() {
  const inputField = document.getElementById('chat-input');
  if (!inputField) return;
  const userMessage = inputField.value.trim();
  if (!userMessage) return;

  // Basic sanitization (replace angle brackets)
  const sanitizedMessage = userMessage.replace(/</g, "<").replace(/>/g, ">");

  conversationHistory.push({ role: 'user', content: sanitizedMessage });
  inputField.value = '';
  renderConversationUI(); // Show user's message immediately
  sendChatMessageToLLM(); // Send to backend
}

async function sendChatMessageToLLM() {
   // Add a temporary "Assistant is thinking..." message
  conversationHistory.push({ role: 'assistant', content: '<div class="thinking" style="font-style: italic; color: grey;">Assistant is thinking...</div>' });
  renderConversationUI();

  try {
    const selectedModel = document.getElementById('llm-model').value;
    // Send the *entire* history for context, excluding the "thinking" message
    const historyToSend = conversationHistory.slice(0, -1);
    // Ensure history is not excessively long (optional - implement if needed)
    // const MAX_HISTORY_LENGTH = 20; // Example limit
    // if (historyToSend.length > MAX_HISTORY_LENGTH) {
    //     historyToSend = historyToSend.slice(-MAX_HISTORY_LENGTH);
    //     // Make sure the first message is always a user message if possible
    //     if (historyToSend[0].role === 'assistant') {
    //          historyToSend = historyToSend.slice(1);
    //     }
    // }
    const conversationJSON = encodeURIComponent(JSON.stringify(historyToSend));


    const url = `https://${serverDomain}/webhook/analyze-data?model=${selectedModel}&prompt=${conversationJSON}`; // Using history in prompt param
    const analysisData = gatherResultsForAnalysis(); // Resend original data for context if needed by backend

    console.log("Sending chat message to LLM...");
    const { controller, timeoutId } = createFetchController(LONG_API_TIMEOUT);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(analysisData),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

     // Remove the "thinking..." message *before* processing response
    conversationHistory.pop();

    if (!response.ok) {
        console.error(`LLM chat request failed with status: ${response.status}`);
        conversationHistory.push({ role: 'assistant', content: '<div class="error">Sorry, I encountered an error communicating with the server. Please try again.</div>' });
        renderConversationUI();
        return;
    }

    const result = await safelyParseJSON(response, url);
    if (!result) {
       console.error('Failed to parse LLM chat response.');
       conversationHistory.push({ role: 'assistant', content: '<div class="error">Sorry, I received an invalid response from the server. Please try again.</div>' });
       renderConversationUI();
       return;
    }

    let assistantReply = '';
     if (Array.isArray(result) && result.length > 0 && result[0].text) {
       assistantReply = result[0].text;
     } else if (typeof result === 'object') {
         assistantReply = result.result || result.message || JSON.stringify(result);
     } else {
       assistantReply = String(result);
     }

    // Basic cleanup
    assistantReply = assistantReply
      .replace(/```html\b/gi, '')
      .replace(/```/g, '');

     // Similar HTML vs Text rendering as in performFinalAnalysis
     let finalContent = '';
     if (assistantReply.trim().startsWith('<') && assistantReply.trim().endsWith('>')) {
         try {
             const tempDiv = document.createElement('div');
             tempDiv.innerHTML = assistantReply;
             if (tempDiv.children.length > 0 || tempDiv.textContent.trim().length > 0) {
                  finalContent = tempDiv.innerHTML;
             } else {
                 finalContent = `<pre>${assistantReply.replace(/</g, "<").replace(/>/g, ">")}</pre>`;
             }
         } catch (e) {
             finalContent = `<pre>${assistantReply.replace(/</g, "<").replace(/>/g, ">")}</pre>`;
         }
     } else {
          finalContent = `<pre>${assistantReply.replace(/</g, "<").replace(/>/g, ">")}</pre>`;
     }


    conversationHistory.push({ role: 'assistant', content: finalContent });
    renderConversationUI();

  } catch (err) {
    // Remove the "thinking..." message on error too
    if (conversationHistory.length > 0 && conversationHistory[conversationHistory.length - 1]?.content.includes('thinking...')) {
         conversationHistory.pop();
    }

    if (err.name === 'AbortError') {
      console.error('LLM chat request timed out.');
      conversationHistory.push({ role: 'assistant', content: '<div class="error">Sorry, the request timed out. Please try again.</div>' });
    } else {
      console.error('Error sending chat message:', err);
      conversationHistory.push({ role: 'assistant', content: `<div class="error">Sorry, an error occurred: ${err.message}</div>` });
    }
    renderConversationUI();
  }
}

/***************************************************
 * The main handleSearch Function
 ***************************************************/
async function handleSearch() {
  console.log("--- Starting New Search ---");
  // 1) Reset state variables FIRST
  stopSearchRequested = false;
  isPaused = false;
  limitedSearchMode = true;
  altCountFound = 0;
  pausedSearchState = { isActive: false, pendingExploration: [], visited: new Set(), finalAlts: [], onNewAltsCallback: null };
  analysisAlreadyCalled = false;
  conversationHistory = [];
  Object.keys(searchResults).forEach(k => { searchResults[k] = []; });
  activeRequestsCount = 0;
  expansionsInProgress = false; // Reset expansion flag

  // 2) Clean the UI thoroughly
  cleanupUI();

  // 3) Get part number input
  const partNumberInput = document.getElementById('part-numbers');
  const partNumber = partNumberInput?.value.trim();
  if (!partNumber) {
    alert('Please enter a part number.');
    return;
  }
  console.log(`Searching for part: ${partNumber}`);

  // 4) Show spinner and stop button
  const spinner = document.getElementById('loading-spinner');
  const stopBtn = document.getElementById('stop-search-btn');
  if (spinner) spinner.style.display = 'inline-block';
  if (stopBtn) stopBtn.style.display = 'inline-block';

  // 5) Initialize variables for this search
  const finalAlternatives = []; // Array to hold {type, value} objects
  let topDescription = '';
  let topCategory = '';
  let topOriginal = partNumber; // May be updated by getAlternativePartNumbers if ORD differs
  const alreadySearched = new Set(); // Track parts searched by executeEndpointSearches

  // 6) Helper to update the alternative numbers UI section
  function updateAlternativeNumbersUI() {
    const altDiv = document.getElementById('alternative-numbers');
    if (!altDiv) return;

    let html = `
      <p><strong>Description:</strong> ${topDescription || 'Loading...'}</p>
      <p><strong>Category:</strong> ${topCategory || 'Loading...'}</p>
    `;
    if (finalAlternatives.length > 0) {
      html += `
        <h4>Alternative Part Numbers Found:</h4>
        <ul class="alternative-numbers-list">
          ${finalAlternatives.map(a => `<li class="alternative-number"><span>${a.type}: ${a.value}</span></li>`).join('')}
        </ul>
      `;
    } else if (!expansionsInProgress && !isPaused) {
         // Only show "No alternatives" if search isn't running or paused AND not stopped
         if (!stopSearchRequested) {
             html += `<p>No alternative part numbers found.</p>`;
         }
    }
    altDiv.innerHTML = html; // Overwrite content
    altDiv.classList.add('active');

    // Re-add continue button if search is paused (might be called after initial fetch)
    if (isPaused && !document.getElementById('continue-search-btn')) {
        addContinueSearchButton();
    }
  }

  // 7) Callback triggered by gatherCombinatoryAlternatives when new alts are found
  async function onNewAlts(newlyAdded) {
    if (stopSearchRequested || isPaused) return; // Don't process if stopped or paused

    // 1. Update the UI list of alternatives
    updateAlternativeNumbersUI();

    // 2. Filter out parts already searched by endpoint functions
    const partsToSearch = newlyAdded.filter(alt => {
        const altUpper = alt.value.trim().toUpperCase();
        if (!alreadySearched.has(altUpper)) {
            alreadySearched.add(altUpper);
            return true;
        }
        return false;
    }).map(alt => ({ number: alt.value, source: `${alt.type}: ${alt.value}` })); // Format for executeEndpointSearches

    // 3. Trigger endpoint searches for these *new* parts
    if (partsToSearch.length > 0) {
      console.log(`onNewAlts: Triggering endpoint searches for ${partsToSearch.length} new alternatives.`);
      // Run searches but don't wait here, let them run in parallel managed by activeRequestsCount
      executeEndpointSearches(partsToSearch);
    }
  }

  // --- Main Search Execution ---
  try {
    // 8) Fetch top-level data for the entered part number (gets description, category, direct alts)
    console.log("Fetching initial part data...");
    const topData = await getAlternativePartNumbers(partNumber);
    // Check if search was stopped during the initial fetch
    if (stopSearchRequested) {
        console.log("Search stopped during initial part fetch.");
        cleanupUI(); // Clean up fully
        return;
    }
    topOriginal = topData.original; // Use the ORD part number if available
    topDescription = topData.description;
    topCategory = topData.category;
    console.log(`Initial Data: Original=${topOriginal}, Desc=${topDescription}, Cat=${topCategory}`);

    // 9) Update UI immediately with description/category
    updateAlternativeNumbersUI();

    // 10) Immediately search endpoints for the original part number
    const originalPartUpper = topOriginal.trim().toUpperCase();
    if (!alreadySearched.has(originalPartUpper)) {
        alreadySearched.add(originalPartUpper);
        console.log(`Executing endpoint searches for original part: ${topOriginal}`);
        // Don't await here, let it run in parallel
        executeEndpointSearches([{ number: topOriginal, source: `Original: ${topOriginal}` }]);
    } else {
        console.log(`Original part ${topOriginal} already processed (likely same as input).`);
    }


    // 11) Start alternative part expansions (if enabled)
    if (configUseAlternatives) {
      // This runs in the background (no await here)
      // It will call onNewAlts as it finds parts, which triggers endpoint searches
      startExpansions(topOriginal, finalAlternatives, onNewAlts);
    } else {
      console.log("Alternative search is disabled by configuration.");
      const altDiv = document.getElementById('alternative-numbers');
      if (altDiv) {
        altDiv.innerHTML += '<p><i>Alternative search is disabled.</i></p>';
      }
      // If not expanding, trigger check if done now that initial searches are launched
      checkIfAllDone();
    }

    // Initial checkIfAllDone call might be premature here,
    // as endpoint searches for original part and expansions are running in background.
    // It will be called correctly when activeRequestsCount becomes 0 and expansionsInProgress is false.

  } catch (err) {
    console.error('Error in main handleSearch execution:', err);
    alert(`An error occurred during the search: ${err.message}`);
    // Hide spinner on error
    if (spinner) spinner.style.display = 'none';
    if (stopBtn) stopBtn.style.display = 'none';
    // Ensure state is reset on error
    stopSearchRequested = true; // Treat as stopped
    isPaused = false;
    expansionsInProgress = false;
    activeRequestsCount = 0;
  }
}

/***************************************************
 * Execute Endpoint Searches for a Batch of Parts
 ***************************************************/
async function executeEndpointSearches(partNumbersInfo) {
  // partNumbersInfo is an array of { number: string, source: string }
  if (!partNumbersInfo || partNumbersInfo.length === 0) return;
  if (stopSearchRequested) {
    console.log("Skipping endpoint searches - User requested stop.");
    return;
  }
   if (isPaused) {
       // This check might be redundant if onNewAlts already checks, but safe to keep.
       // console.log("Skipping endpoint searches - Search is paused.");
       return;
   }

  // console.log(`Executing searches for ${partNumbersInfo.length} parts: ${partNumbersInfo.map(p=>p.number).join(', ')}`);
  const tasks = [];
  const activeEndpoints = []; // For logging

  // Build tasks based on checked toggles
  const toggleChecks = {
      'toggle-inventory': () => tasks.push(fetchInventoryData(partNumbersInfo).finally(() => updateSummaryTab())),
      'toggle-sales': () => tasks.push(fetchSalesData(partNumbersInfo).finally(() => updateSummaryTab())),
      'toggle-purchases': () => tasks.push(fetchPurchasesData(partNumbersInfo).finally(() => updateSummaryTab())),
      'toggle-brokerbin': () => tasks.push(fetchBrokerBinData(partNumbersInfo).finally(() => updateSummaryTab())),
      'toggle-tdsynnex': () => tasks.push(fetchTDSynnexData(partNumbersInfo).finally(() => updateSummaryTab())),
      'toggle-ingram': () => tasks.push(fetchDistributorData(partNumbersInfo).finally(() => updateSummaryTab())),
      'toggle-amazon-connector': () => tasks.push(fetchAmazonConnectorData(partNumbersInfo).finally(() => updateSummaryTab())),
      'toggle-ebay-connector': () => tasks.push(fetchEbayConnectorData(partNumbersInfo).finally(() => updateSummaryTab())),
      'toggle-amazon': () => tasks.push(fetchAmazonData(partNumbersInfo).finally(() => updateSummaryTab())),
      'toggle-ebay': () => tasks.push(fetchEbayData(partNumbersInfo).finally(() => updateSummaryTab())),
      'toggle-lenovo': () => tasks.push(fetchLenovoData(partNumbersInfo)) // Lenovo updates own UI
  };

  for (const toggleId in toggleChecks) {
      const toggleElement = document.getElementById(toggleId);
      if (toggleElement?.checked) {
          activeEndpoints.push(toggleId.replace('toggle-', '')); // Log endpoint name
          toggleChecks[toggleId](); // Add the fetch task promise
      }
  }

  // console.log(`Active endpoints for this batch: ${activeEndpoints.join(', ')}`);
  if (tasks.length > 0) {
       // We don't await Promise.all here.
       // Each task manages its own activeRequestsCount decrement in its finally block.
       // This allows batches to run concurrently.
       console.log(`Launched ${tasks.length} endpoint search tasks for batch starting with ${partNumbersInfo[0]?.number}`);
  } else {
      // console.log("No active endpoints enabled for this search batch.");
      // If no tasks were launched for this batch, we might need to trigger checkIfAllDone if appropriate
      // However, this function is usually called from onNewAlts which is part of expansions,
      // or from handleSearch for the initial part. The checkIfAllDone logic should handle completion naturally.
  }
}

/***************************************************
 * Individual Fetch Functions (with improvements)
 ***************************************************/

// --- TDSynnex ---
async function fetchTDSynnexData(partNumbersInfo) {
  if (stopSearchRequested) return;
  activeRequestsCount++;
  const loading = document.querySelector('.tdsynnex-results .loading');
  if (loading) loading.style.display = 'block';

  try {
    const promises = partNumbersInfo.map(async ({ number, source }) => {
      if (stopSearchRequested || isPaused) return null; // Check before fetch
      const url = `https://${serverDomain}/webhook/tdsynnex-search?item=${encodeURIComponent(number)}`;
      try {
        const { controller, timeoutId } = createFetchController();
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (!res.ok || isPaused || stopSearchRequested) return null; // Check again after fetch

        const xmlText = await res.text();
        if (!xmlText || xmlText.trim() === '' || isPaused || stopSearchRequested) return null;
        const xmlDoc = parseXML(xmlText);
        const priceList = xmlDoc.getElementsByTagName('PriceAvailabilityList')[0];
        if (!priceList) return null;

        return { // Return the processed result
          sourcePartNumber: source,
          synnexSKU: xmlDoc.querySelector('synnexSKU')?.textContent || '-',
          mfgPN: xmlDoc.querySelector('mfgPN')?.textContent || '-',
          description: xmlDoc.querySelector('description')?.textContent || '-',
          status: xmlDoc.querySelector('status')?.textContent || '-',
          price: xmlDoc.querySelector('price')?.textContent || '-',
          totalQuantity: xmlDoc.querySelector('totalQuantity')?.textContent || '0',
          warehouses: Array.from(xmlDoc.getElementsByTagName('AvailabilityByWarehouse'))
            .map(warehouse => ({
              city: warehouse.querySelector('warehouseInfo city')?.textContent || 'N/A',
              qty: warehouse.querySelector('qty')?.textContent || '0'
            }))
        };
      } catch (err) {
        if (err.name !== 'AbortError') console.warn(`TDSynnex fetch error for ${number}:`, err);
        return null; // Return null on error
      }
    });

    const results = await Promise.all(promises);
    const newItems = results.filter(item => item !== null); // Filter out nulls from errors/stops

    if (newItems.length > 0) {
        searchResults.tdsynnex.push(...newItems);
        buildTDSynnexTable();
    }
  } catch (err) {
    console.error('Error processing TDSynnex batch:', err);
  } finally {
    if (loading) loading.style.display = 'none';
    activeRequestsCount--;
    checkIfAllDone(); // Check if all searches are complete now
  }
}

// --- Ingram ---
async function fetchDistributorData(partNumbersInfo) { // Assuming Ingram
  if (stopSearchRequested) return;
  activeRequestsCount++;
  const loading = document.querySelector('#distributors-content .loading');
  if (loading) loading.style.display = 'block';

  try {
     const promises = partNumbersInfo.map(async ({ number, source }) => {
         if (stopSearchRequested || isPaused) return null;
         const url = `https://${serverDomain}/webhook/ingram-search?item=${encodeURIComponent(number)}`;
         try {
             const { controller, timeoutId } = createFetchController();
             const res = await fetch(url, { signal: controller.signal });
             clearTimeout(timeoutId);
             if (!res.ok || isPaused || stopSearchRequested) return null;

             const data = await safelyParseJSON(res, url);
             if (!data || !Array.isArray(data)) return null;

             return data.map(obj => ({ ...obj, sourcePartNumber: source })); // Return array of results for this part

         } catch (err) {
             if (err.name !== 'AbortError') console.warn(`Ingram error for ${number}:`, err);
             return null;
         }
     });

     const resultsArrays = await Promise.all(promises);
     // Flatten the array of arrays and filter out nulls/empty arrays
     const newItems = resultsArrays.flat().filter(item => item !== null);

     if (newItems.length > 0) {
        searchResults.ingram.push(...newItems);
        buildIngramTable();
     }
  } catch (err) {
    console.error('Error processing Ingram batch:', err);
     const resultsDiv = document.querySelector('#distributors-content .ingram-results .results-container');
     if (resultsDiv) resultsDiv.innerHTML = `<div class="error">Error loading Ingram data: ${err.message}</div>`;
  } finally {
    if (loading) loading.style.display = 'none';
    activeRequestsCount--;
    checkIfAllDone();
  }
}

// --- BrokerBin ---
async function fetchBrokerBinData(partNumbersInfo) {
  if (stopSearchRequested) return;
  activeRequestsCount++;
  const loading = document.querySelector('.brokerbin-results .loading');
  if (loading) loading.style.display = 'block';

  try {
     const promises = partNumbersInfo.map(async ({ number, source }) => {
        if (stopSearchRequested || isPaused) return null;
        const url = `https://${serverDomain}/webhook/brokerbin-search?item=${encodeURIComponent(number)}`;
        try {
            const { controller, timeoutId } = createFetchController();
            const res = await fetch(url, { signal: controller.signal });
            clearTimeout(timeoutId);
            if (!res.ok || isPaused || stopSearchRequested) return null;

            const data = await safelyParseJSON(res, url);
            if (!data || !Array.isArray(data)) return null;

            return data.map(obj => ({ ...obj, sourcePartNumber: source }));
        } catch (err) {
            if (err.name !== 'AbortError') console.warn(`BrokerBin error for ${number}:`, err);
            return null;
        }
     });

     const resultsArrays = await Promise.all(promises);
     const newItems = resultsArrays.flat().filter(item => item !== null);

     if (newItems.length > 0) {
        searchResults.brokerbin.push(...newItems);
        buildBrokerBinTable();
     }
  } catch (error) {
    console.error('Error processing BrokerBin batch:', error);
     const resultsDiv = document.querySelector('.brokerbin-results .results-container');
     if (resultsDiv) resultsDiv.innerHTML = `<div class="error">Error loading BrokerBin data: ${error.message}</div>`;
  } finally {
    if (loading) loading.style.display = 'none';
    activeRequestsCount--;
    checkIfAllDone();
  }
}

// --- Epicor Inventory (CRITICAL) ---
async function fetchInventoryData(partNumbersInfo) {
  if (stopSearchRequested) return;
  activeRequestsCount++;
  const loading = document.querySelector('#inventory-content .loading');
  if (loading) loading.style.display = 'block';

  try {
     const promises = partNumbersInfo.map(async ({ number, source }) => {
        if (stopSearchRequested || isPaused) return null;
        const url = `https://${serverDomain}/webhook/epicor-search?item=${encodeURIComponent(number)}`;
        try {
            const { controller, timeoutId } = createFetchController(LONG_API_TIMEOUT);
            const res = await fetch(url, { signal: controller.signal });
            clearTimeout(timeoutId);
            if (!res.ok || isPaused || stopSearchRequested) {
                if(!res.ok) console.warn(`EPICOR Inventory request for ${number} failed: Status ${res.status}`);
                return null;
            }

            const data = await safelyParseJSON(res, url);
            if (!data || !Array.isArray(data)) {
                console.warn(`EPICOR Inventory for ${number}: Invalid data format received.`);
                return null;
            }
            return data.map(obj => ({ ...obj, sourcePartNumber: source }));
        } catch (err) {
            if (err.name === 'AbortError') console.error(`EPICOR Inventory request timed out for ${number}`);
            else console.error(`EPICOR Inventory fetch error for ${number}:`, err);
            return null;
        }
     });

     const resultsArrays = await Promise.all(promises);
     const newItems = resultsArrays.flat().filter(item => item !== null);

     if (newItems.length > 0) {
        searchResults.epicor.push(...newItems);
        buildEpicorInventoryTable();
     }
  } catch (err) {
    console.error('Error processing Epicor Inventory batch:', err);
    const resultsDiv = document.querySelector('#inventory-content .inventory-results');
     if (resultsDiv) resultsDiv.innerHTML = `<div class="error">Error loading Epicor Inventory data: ${err.message}</div>`;
  } finally {
    if (loading) loading.style.display = 'none';
    activeRequestsCount--;
    checkIfAllDone();
  }
}


// --- Sales (CRITICAL) ---
async function fetchSalesData(partNumbersInfo) {
  if (stopSearchRequested) return;
  activeRequestsCount++;
  const loading = document.querySelector('#sales-content .loading');
  if (loading) loading.style.display = 'block';

  try {
     const promises = partNumbersInfo.map(async ({ number, source }) => {
         if (stopSearchRequested || isPaused) return null;
         const url = `https://${serverDomain}/webhook/epicor-sales?item=${encodeURIComponent(number)}`;
         try {
             const { controller, timeoutId } = createFetchController(LONG_API_TIMEOUT);
             const res = await fetch(url, { signal: controller.signal });
             clearTimeout(timeoutId);
             if (!res.ok || isPaused || stopSearchRequested) {
                 if(!res.ok) console.warn(`EPICOR Sales request for ${number} failed: Status ${res.status}`);
                 return null;
             }

             const data = await safelyParseJSON(res, url);
             if (!data || !Array.isArray(data)) {
                 console.warn(`EPICOR Sales for ${number}: Invalid data format received.`);
                 return null;
             }

             const salesItems = [];
             data.forEach(entry => {
                 const details = entry?.returnObj?.OrderDtlPA || [];
                 details.forEach(line => {
                     salesItems.push({
                         sourcePartNumber: source, PartNum: line.PartNum, LineDesc: line.LineDesc,
                         OrderNum: line.OrderNum, OrderLine: line.OrderLine, CustomerID: line.CustomerCustID,
                         CustomerName: line.CustomerCustName, OrderDate: line.OrderHedOrderDate, OrderQty: line.OrderQty,
                         UnitPrice: line.UnitPrice, RequestDate: line.RequestDate, NeedByDate: line.NeedByDate
                     });
                 });
             });
             return salesItems; // Return array of sales items for this part
         } catch (err) {
             if (err.name === 'AbortError') console.error(`EPICOR Sales request timed out for ${number}`);
             else console.error(`EPICOR Sales fetch error for ${number}:`, err);
             return null;
         }
     });

     const resultsArrays = await Promise.all(promises);
     const newItems = resultsArrays.flat().filter(item => item !== null);

     if (newItems.length > 0) {
        searchResults.sales.push(...newItems);
        buildSalesTable();
     }
  } catch (err) {
    console.error('Error processing Epicor Sales batch:', err);
     const resultsDiv = document.querySelector('#sales-content .sales-results');
     if (resultsDiv) resultsDiv.innerHTML = `<div class="error">Error loading Epicor Sales data: ${err.message}</div>`;
  } finally {
    if (loading) loading.style.display = 'none';
    activeRequestsCount--;
    checkIfAllDone();
  }
}

// --- Purchases (CRITICAL) ---
async function fetchPurchasesData(partNumbersInfo) {
  if (stopSearchRequested) return;
  activeRequestsCount++;
  const loading = document.querySelector('#purchases-content .loading');
  if (loading) loading.style.display = 'block';

  try {
      const promises = partNumbersInfo.map(async ({ number, source }) => {
          if (stopSearchRequested || isPaused) return null;
          const url = `https://${serverDomain}/webhook/epicor-purchases?item=${encodeURIComponent(number)}`;
          try {
              const { controller, timeoutId } = createFetchController(LONG_API_TIMEOUT);
              const res = await fetch(url, { signal: controller.signal });
              clearTimeout(timeoutId);
              if (!res.ok || isPaused || stopSearchRequested) {
                  if(!res.ok) console.warn(`EPICOR Purchases request for ${number} failed: Status ${res.status}`);
                  return null;
              }

              const data = await safelyParseJSON(res, url);
              if (!data || !Array.isArray(data)) {
                  console.warn(`EPICOR Purchases for ${number}: Invalid data format received.`);
                  return null;
              }

              const purchaseItems = [];
              data.forEach(entry => {
                  const purchasedItems = entry?.returnObj?.PAPurchasedBefore || [];
                  purchasedItems.forEach(line => {
                      purchaseItems.push({
                          sourcePartNumber: source, PartNum: line.PartNum, VendorName: line.VendorName,
                          VendorQty: line.VendorQty, VendorUnitCost: line.VendorUnitCost, PONum: line.PONum,
                          ReceiptDate: line.ReceiptDate, OrderDate: line.OrderDate, DueDate: line.DueDate,
                          IsAdvisor: false, PartDescription: line.PartDescription || '', PurchasedBefore: true
                      });
                  });
              });
              return purchaseItems;
          } catch (err) {
              if (err.name === 'AbortError') console.error(`EPICOR Purchases request timed out for ${number}`);
              else console.error(`EPICOR Purchases fetch error for ${number}:`, err);
              return null;
          }
      });

      const resultsArrays = await Promise.all(promises);
      const newItems = resultsArrays.flat().filter(item => item !== null);

      if (newItems.length > 0) {
        searchResults.purchases.push(...newItems);
        buildPurchasesTable();
      }
  } catch (err) {
    console.error('Error processing Epicor Purchases batch:', err);
    const resultsDiv = document.querySelector('#purchases-content .purchases-results');
     if (resultsDiv) resultsDiv.innerHTML = `<div class="error">Error loading Epicor Purchases data: ${err.message}</div>`;
  } finally {
    if (loading) loading.style.display = 'none';
    activeRequestsCount--;
    checkIfAllDone();
  }
}


// --- AmazonConnector ---
async function fetchAmazonConnectorData(partNumbersInfo) {
  if (stopSearchRequested) return;
  activeRequestsCount++;
  const loading = document.querySelector('.amazon-connector-results .loading');
  if (loading) loading.style.display = 'block';

  try {
      const promises = partNumbersInfo.map(async ({ number, source }) => {
         if (stopSearchRequested || isPaused) return null;
         const url = `https://${serverDomain}/webhook/amazon-search?item=${encodeURIComponent(number)}`;
         try {
             const { controller, timeoutId } = createFetchController();
             const resp = await fetch(url, { signal: controller.signal });
             clearTimeout(timeoutId);
             if (!resp.ok || isPaused || stopSearchRequested) return null;

             const data = await safelyParseJSON(resp, url);
             if (!data || !Array.isArray(data)) return null;
             return data.map(obj => ({ ...obj, sourcePartNumber: source }));
         } catch (err) {
             if (err.name !== 'AbortError') console.warn(`AmazonConnector error for ${number}:`, err);
             return null;
         }
      });

      const resultsArrays = await Promise.all(promises);
      const newItems = resultsArrays.flat().filter(item => item !== null);

      if (newItems.length > 0) {
        searchResults.amazonConnector.push(...newItems);
        buildAmazonConnectorTable();
      }
  } catch (err) {
    console.error('Error processing Amazon Connector batch:', err);
     const resultsDiv = document.querySelector('.amazon-connector-results .results-container');
     if (resultsDiv) resultsDiv.innerHTML = `<div class="error">Error loading Amazon Connector data: ${err.message}</div>`;
  } finally {
    if (loading) loading.style.display = 'none';
    activeRequestsCount--;
    checkIfAllDone();
  }
}

// --- eBayConnector ---
async function fetchEbayConnectorData(partNumbersInfo) {
  if (stopSearchRequested) return;
  activeRequestsCount++;
  const loading = document.querySelector('.ebay-connector-results .loading');
  if (loading) loading.style.display = 'block';

  try {
      const promises = partNumbersInfo.map(async ({ number, source }) => {
          if (stopSearchRequested || isPaused) return null;
          const url = `https://${serverDomain}/webhook/ebay-search?item=${encodeURIComponent(number)}`;
          try {
              const { controller, timeoutId } = createFetchController();
              const resp = await fetch(url, { signal: controller.signal });
              clearTimeout(timeoutId);
              if (!resp.ok || isPaused || stopSearchRequested) return null;

              const data = await safelyParseJSON(resp, url);
              if (!data || !Array.isArray(data)) return null;
              return data.map(obj => ({ ...obj, sourcePartNumber: source }));
          } catch (err) {
              if (err.name !== 'AbortError') console.warn(`eBayConnector error for ${number}:`, err);
              return null;
          }
      });

      const resultsArrays = await Promise.all(promises);
      const newItems = resultsArrays.flat().filter(item => item !== null);

      if (newItems.length > 0) {
        searchResults.ebayConnector.push(...newItems);
        buildEbayConnectorTable();
      }
  } catch (err) {
    console.error('Error processing eBay Connector batch:', err);
     const resultsDiv = document.querySelector('.ebay-connector-results .results-container');
     if (resultsDiv) resultsDiv.innerHTML = `<div class="error">Error loading eBay Connector data: ${err.message}</div>`;
  } finally {
    if (loading) loading.style.display = 'none';
    activeRequestsCount--;
    checkIfAllDone();
  }
}


// --- AmazonScraper ---
async function fetchAmazonData(partNumbersInfo) {
  if (stopSearchRequested) return;
  activeRequestsCount++;
  const loading = document.querySelector('.amazon-results .loading');
  if (loading) loading.style.display = 'block';

  try {
      const promises = partNumbersInfo.map(async ({ number, source }) => {
          if (stopSearchRequested || isPaused) return null;
          const url = `https://${serverDomain}/webhook/amazon-scraper?item=${encodeURIComponent(number)}`;
          try {
              const { controller, timeoutId } = createFetchController();
              const resp = await fetch(url, { signal: controller.signal });
              clearTimeout(timeoutId);
              if (!resp.ok || isPaused || stopSearchRequested) return null;

              const data = await safelyParseJSON(resp, url);
              if (!data || !Array.isArray(data) || data.length === 0) return null;

              const items = [];
              const { title = [], price = [], image = [], link = [] } = data[0];
              for (let i = 0; i < title.length; i++) {
                  items.push({
                      sourcePartNumber: source, title: title[i] || '-', rawPrice: price[i] || '-',
                      image: image[i] || null, link: link[i] || '#'
                  });
              }
              return items;
          } catch (err) {
              if (err.name !== 'AbortError') console.warn(`AmazonScraper error for ${number}:`, err);
              return null;
          }
      });

      const resultsArrays = await Promise.all(promises);
      const newItems = resultsArrays.flat().filter(item => item !== null);

      if (newItems.length > 0) {
        searchResults.amazon.push(...newItems);
        buildAmazonScraperTable();
      }
  } catch (err) {
    console.error('Error processing Amazon Scraper batch:', err);
     const resultsDiv = document.querySelector('.amazon-results .results-container');
     if (resultsDiv) resultsDiv.innerHTML = `<div class="error">Error loading Amazon Scraper data: ${err.message}</div>`;
  } finally {
    if (loading) loading.style.display = 'none';
    activeRequestsCount--;
    checkIfAllDone();
  }
}

// --- eBayScraper ---
async function fetchEbayData(partNumbersInfo) {
  if (stopSearchRequested) return;
  activeRequestsCount++;
  const loading = document.querySelector('.ebay-results .loading');
  if (loading) loading.style.display = 'block';

  try {
      const promises = partNumbersInfo.map(async ({ number, source }) => {
          if (stopSearchRequested || isPaused) return null;
          const url = `https://${serverDomain}/webhook/ebay-scraper?item=${encodeURIComponent(number)}`;
          try {
              const { controller, timeoutId } = createFetchController();
              const resp = await fetch(url, { signal: controller.signal });
              clearTimeout(timeoutId);
              if (!resp.ok || isPaused || stopSearchRequested) return null;

              const data = await safelyParseJSON(resp, url);
              if (!data || !Array.isArray(data) || data.length === 0) return null;

              const items = [];
              const { title = [], price = [], image = [], link = [] } = data[0];
              for (let i = 0; i < title.length; i++) {
                  items.push({
                      sourcePartNumber: source, title: title[i] || '-', rawPrice: price[i] || '-',
                      image: image[i] || null, link: link[i] || '#'
                  });
              }
              return items;
          } catch (err) {
              if (err.name !== 'AbortError') console.warn(`eBayScraper error for ${number}:`, err);
              return null;
          }
      });

      const resultsArrays = await Promise.all(promises);
      const newItems = resultsArrays.flat().filter(item => item !== null);

      if (newItems.length > 0) {
        searchResults.ebay.push(...newItems);
        buildEbayScraperTable();
      }
  } catch (err) {
    console.error('Error processing eBay Scraper batch:', err);
     const resultsDiv = document.querySelector('.ebay-results .results-container');
     if (resultsDiv) resultsDiv.innerHTML = `<div class="error">Error loading eBay Scraper data: ${err.message}</div>`;
  } finally {
    if (loading) loading.style.display = 'none';
    activeRequestsCount--;
    checkIfAllDone();
  }
}


// --- Lenovo ---
async function fetchLenovoData(partNumbersInfo) {
  if (stopSearchRequested) return;
  activeRequestsCount++;

  try {
      let newDataFound = false;
      const promises = partNumbersInfo.map(async ({ number, source }) => {
          if (stopSearchRequested || isPaused) return null;
          const url = `https://${serverDomain}/webhook/lenovo-scraper?item=${encodeURIComponent(number)}`;
          try {
              const { controller, timeoutId } = createFetchController();
              const response = await fetch(url, { signal: controller.signal });
              clearTimeout(timeoutId);
              if (!response.ok || isPaused || stopSearchRequested) return null;

              const data = await safelyParseJSON(response, url);
              if (!data || !data[0]?.data || !Array.isArray(data[0].data) || data[0].data.length === 0) return null;

              return data[0].data
                  .filter(doc => doc?.content?.trim()) // Filter out empty content
                  .map(doc => ({ ...doc, sourcePartNumber: source }));
          } catch (error) {
              if (error.name !== 'AbortError') console.warn(`Lenovo error for ${number}:`, error);
              return null;
          }
      });

      const resultsArrays = await Promise.all(promises);
      const newItems = resultsArrays.flat().filter(item => item !== null);

      if (newItems.length > 0) {
        searchResults.lenovo.push(...newItems);
        newDataFound = true;
      }

      // Only rebuild UI if new data was actually added in this batch
      if (newDataFound) {
          buildLenovoUI();
      }

  } catch (err) {
    console.error('Error processing Lenovo batch:', err);
    if (!searchResults.lenovo.length) { // Show error only if nothing was ever loaded
      const subtabs = document.getElementById('lenovo-subtabs');
      if (subtabs) subtabs.innerHTML = `<div class="error">Error fetching Lenovo data: ${err.message}</div>`;
    }
  } finally {
    activeRequestsCount--;
    checkIfAllDone();
  }
}

/*=================================================*
 * Other UI Build Functions (Assumed mostly correct, *
 * minor improvements like placeholders added)      *
 *=================================================*/

// Build functions for Ingram, BrokerBin, AmazonConnector, eBayConnector, AmazonScraper, eBayScraper, Lenovo
// These functions primarily take data from searchResults[key] and render tables.
// Key points: Add checks for empty results, use createTableContainer, call makeTableSortable.

function buildIngramTable() {
  const resultsDiv = document.querySelector('#distributors-content .ingram-results .results-container');
  if (!resultsDiv) return;
  resultsDiv.innerHTML = '';
  const items = searchResults.ingram;
  if (items.length === 0) { resultsDiv.innerHTML = '<p>No Ingram results found.</p>'; return; }
  const table = document.createElement('table');
  table.innerHTML = `
    <thead><tr><th>Source Part</th><th>Description</th><th>Category</th><th>Vendor</th><th>Part Number</th><th>UPC Code</th><th>Product Type</th><th>Status</th></tr></thead>
    <tbody>${items.map(it => `<tr><td>${it.sourcePartNumber}</td><td>${it.description || '-'}</td><td>${it.category || '-'}</td><td>${it.vendorName || '-'}</td><td>${it.vendorPartNumber || '-'}</td><td>${it.upcCode || '-'}</td><td>${it.productType || '-'}</td><td>${it.discontinued === 'True' ? '<span class="text-error">Discontinued</span>' : ''}${it.newProduct === 'True' ? '<span class="text-success">New</span>' : ''}${it.discontinued !== 'True' && it.newProduct !== 'True' ? 'Active' : ''}</td></tr>`).join('')}</tbody>`;
  resultsDiv.appendChild(createTableContainer(table)); makeTableSortable(table);
}

function buildBrokerBinTable() {
  const resultsDiv = document.querySelector('.brokerbin-results .results-container');
  if (!resultsDiv) return;
  resultsDiv.innerHTML = '';
  const items = searchResults.brokerbin;
  if (items.length === 0) { resultsDiv.innerHTML = '<p>No BrokerBin results found.</p>'; return; }
  const table = document.createElement('table');
  table.innerHTML = `
    <thead><tr><th>Source Part</th><th>Company</th><th>Country</th><th>Part</th><th>Manufacturer</th><th>Condition</th><th>Description</th><th>Price</th><th>Quantity</th><th>Age (Days)</th></tr></thead>
    <tbody>${items.map(it => `<tr><td>${it.sourcePartNumber}</td><td>${it.company || '-'}</td><td>${it.country || '-'}</td><td>${it.part || '-'}</td><td>${it.mfg || '-'}</td><td>${it.cond || '-'}</td><td>${it.description || '-'}</td><td>${it.price ? '$' + parseFloat(it.price).toFixed(2) : '-'}</td><td>${it.qty || '0'}</td><td>${it.age_in_days || '-'}</td></tr>`).join('')}</tbody>`;
  resultsDiv.appendChild(createTableContainer(table)); makeTableSortable(table);
}

function buildAmazonConnectorTable() {
  const resultsDiv = document.querySelector('.amazon-connector-results .results-container');
  if (!resultsDiv) return;
  resultsDiv.innerHTML = '';
  const items = searchResults.amazonConnector;
  if (items.length === 0) { resultsDiv.innerHTML = '<p>No Amazon Connector results found.</p>'; return; }
  const table = document.createElement('table');
  table.innerHTML = `
    <thead><tr><th>Source Part</th><th class="no-sort">Image</th><th>Title</th><th>Price</th><th>List Price</th><th>Rating</th><th>Reviews</th><th>Stock Status</th><th>Seller</th></tr></thead>
    <tbody>${items.map(it => `<tr><td>${it.sourcePartNumber}</td><td class="image-cell"><img src="${it.thumbnailImage || 'placeholder.png'}" alt="${it.title || 'Product Image'}" class="product-image" onerror="this.src='placeholder.png'; this.alt='Image not available';"></td><td><a href="${it.url || '#'}" target="_blank" rel="noopener noreferrer">${it.title || '-'}</a></td><td>${it.price ? (it.price.currency + it.price.value) : '-'}</td><td>${it.listPrice ? (it.listPrice.currency + it.listPrice.value) : '-'}</td><td>${it.stars ? it.stars + '/5' : '-'}</td><td>${it.reviewsCount || '0'}</td><td>${it.inStockText || '-'}</td><td>${(it.seller && it.seller.name) ? it.seller.name : '-'}</td></tr>`).join('')}</tbody>`;
  resultsDiv.appendChild(createTableContainer(table)); makeTableSortable(table);
}

function buildEbayConnectorTable() {
  const resultsDiv = document.querySelector('.ebay-connector-results .results-container');
  if (!resultsDiv) return;
  resultsDiv.innerHTML = '';
  const items = searchResults.ebayConnector;
  if (items.length === 0) { resultsDiv.innerHTML = '<p>No eBay Connector results found.</p>'; return; }
  const table = document.createElement('table');
  table.innerHTML = `
    <thead><tr><th>Source Part</th><th class="no-sort">Image</th><th>Title</th><th>Price</th><th>Condition</th><th>Seller</th><th>Location</th><th>Shipping</th></tr></thead>
    <tbody>${items.map(it => `<tr><td>${it.sourcePartNumber}</td><td class="image-cell">${it.images && it.images.length > 0 ? `<img src="${it.images[0]}" alt="${it.title || 'Product Image'}" class="product-image" onerror="this.src='placeholder.png'; this.alt='Image not available';">` : '<img src="placeholder.png" alt="No image" class="product-image">'}</td><td><a href="${it.url || '#'}" target="_blank" rel="noopener noreferrer">${it.title || '-'}</a></td><td>${it.priceWithCurrency || '-'}</td><td>${it.condition || '-'}</td><td>${it.sellerUrl ? `<a href="${it.sellerUrl}" target="_blank" rel="noopener noreferrer">${it.sellerName || 'Unknown Seller'}</a>` : (it.sellerName || '-')}</td><td>${it.itemLocation || '-'}</td><td>${it.shipping || '-'}</td></tr>`).join('')}</tbody>`;
  resultsDiv.appendChild(createTableContainer(table)); makeTableSortable(table);
}

function buildAmazonScraperTable() {
  const resultsDiv = document.querySelector('.amazon-results .results-container');
  if (!resultsDiv) return;
  resultsDiv.innerHTML = '';
  const items = searchResults.amazon;
  if (items.length === 0) { resultsDiv.innerHTML = '<p>No Amazon Scraper results found.</p>'; return; }
  const table = document.createElement('table');
  table.innerHTML = `
    <thead><tr><th>Source Part</th><th class="no-sort">Image</th><th>Description</th><th>Price</th></tr></thead>
    <tbody>${items.map(it => `<tr><td>${it.sourcePartNumber}</td><td class="image-cell">${it.image ? `<img src="${it.image}" alt="Product image" class="product-image" onerror="this.src='placeholder.png'; this.alt='Image not available';">` : '<img src="placeholder.png" alt="No image" class="product-image">'}</td><td>${it.link && it.link !== '#' ? `<a href="${it.link}" target="_blank" rel="noopener noreferrer">${it.title}</a>` : it.title}</td><td>${it.rawPrice}</td></tr>`).join('')}</tbody>`;
  resultsDiv.appendChild(createTableContainer(table)); makeTableSortable(table);
}

function buildEbayScraperTable() {
  const resultsDiv = document.querySelector('.ebay-results .results-container');
  if (!resultsDiv) return;
  resultsDiv.innerHTML = '';
  const items = searchResults.ebay;
  if (items.length === 0) { resultsDiv.innerHTML = '<p>No eBay Scraper results found.</p>'; return; }
  const table = document.createElement('table');
  table.innerHTML = `
    <thead><tr><th>Source Part</th><th class="no-sort">Image</th><th>Description</th><th>Price</th></tr></thead>
    <tbody>${items.map(it => `<tr><td>${it.sourcePartNumber}</td><td class="image-cell">${it.image ? `<img src="${it.image}" alt="Product image" class="product-image" onerror="this.src='placeholder.png'; this.alt='Image not available';">` : '<img src="placeholder.png" alt="No image" class="product-image">'}</td><td>${it.link && it.link !== '#' ? `<a href="${it.link}" target="_blank" rel="noopener noreferrer">${it.title}</a>` : it.title}</td><td>${it.rawPrice}</td></tr>`).join('')}</tbody>`;
  resultsDiv.appendChild(createTableContainer(table)); makeTableSortable(table);
}


function buildLenovoUI() {
  const lenovoContentDiv = document.getElementById('lenovo-content');
  if (!lenovoContentDiv) return;

  let subtabs = document.getElementById('lenovo-subtabs');
  let subcontent = document.getElementById('lenovo-subcontent');
  if (!subtabs) {
    subtabs = document.createElement('div'); subtabs.id = 'lenovo-subtabs'; subtabs.className = 'subtabs';
    lenovoContentDiv.appendChild(subtabs);
  }
  if (!subcontent) {
    subcontent = document.createElement('div'); subcontent.id = 'lenovo-subcontent';
    lenovoContentDiv.appendChild(subcontent);
  }

  subtabs.innerHTML = ''; subcontent.innerHTML = '';

  const allResults = searchResults.lenovo;
  if (!allResults || allResults.length === 0) { subtabs.innerHTML = '<p>No Lenovo data found.</p>'; return; }

  allResults.forEach((doc, index) => {
    const subtabButton = document.createElement('button');
    subtabButton.className = `subtab-button ${index === 0 ? 'active' : ''}`;
    const title = doc.title || 'Untitled Document';
    const cleanTitle = typeof title === 'string' ? title.replace(/\s+/g, ' ').trim() : 'Untitled Document';
    subtabButton.textContent = `${doc.sourcePartNumber} - ${cleanTitle.substring(0, 50)}${cleanTitle.length > 50 ? '...' : ''}`;
    subtabButton.title = cleanTitle;
    subtabButton.onclick = () => switchLenovoSubtab(index);
    subtabs.appendChild(subtabButton);

    const contentDiv = document.createElement('div');
    contentDiv.className = `subtab-content ${index === 0 ? 'active' : ''}`;
    contentDiv.setAttribute('data-subtab-index', index);
    let processedContent = decodeUnicodeEscapes(doc.content);
    if (!processedContent.trim().toLowerCase().startsWith('<table') && !processedContent.trim().toLowerCase().startsWith('<div')) {
        processedContent = `<div class="lenovo-content-wrapper">${processedContent}</div>`;
    }
    contentDiv.innerHTML = processedContent;
    subcontent.appendChild(contentDiv);
  });
   // Ensure the first tab's content is shown if results exist
   if (allResults.length > 0) {
       switchLenovoSubtab(0);
   }
}

/*=================================================*/

/***************************************************
 * Summary Tab (with Corrected Filtering)
 ***************************************************/
// updateSummaryTab and generateSummaryTableHtml functions are defined earlier


/***************************************************
 * Gathers final results (HTML content) for LLM analysis
 ***************************************************/
// gatherResultsForAnalysis function is defined earlier


/***************************************************
 * Event Listeners & Initialization
 ***************************************************/
document.addEventListener('DOMContentLoaded', () => {
  console.log("DOM fully loaded and parsed");

  // Attach search handler
  const searchButton = document.getElementById('search-btn');
  if (searchButton) {
    searchButton.addEventListener('click', handleSearch);
  } else {
      console.error("Search button not found!");
  }

   // Attach stop search handler
  const stopButton = document.getElementById('stop-search-btn');
  if (stopButton) {
    stopButton.addEventListener('click', stopSearch);
  } else {
      console.error("Stop search button not found!");
  }


  // Initial tab setup
  switchTab('summary'); // Start on summary tab

   // Add listener for Enter key on part number input
   const partInput = document.getElementById('part-numbers');
   if (partInput) {
       partInput.addEventListener('keydown', (e) => {
           if (e.key === 'Enter') {
                e.preventDefault(); // Prevent potential form submission
               handleSearch();
           }
       });
   }

   // Google / MS Sign-in (Placeholders - Replace with actual Client IDs)
   const googleBtn = document.getElementById('google-signin-btn');
   if (googleBtn) {
       googleBtn.addEventListener('click', () => {
           alert("Google Sign-In not configured. Replace 'YOUR_GOOGLE_CLIENT_ID' in the code.");
           // Ensure google object is loaded before using
           // if (typeof google !== 'undefined' && google.accounts && google.accounts.id) {
           //     google.accounts.id.initialize({ client_id: 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com', callback: handleGoogleCredentialResponse });
           //     google.accounts.id.prompt();
           // } else {
           //     console.error("Google Identity Services library not loaded.");
           //     alert("Google Sign-In library not loaded properly.");
           // }
       });
   }

   const msBtn = document.getElementById('microsoft-signin-btn');
   if (msBtn) {
       msBtn.addEventListener('click', () => {
           alert("Microsoft Sign-In not configured. Replace 'YOUR_MICROSOFT_CLIENT_ID' in the code.");
           // const msalConfig = { auth: { clientId: "YOUR_MICROSOFT_CLIENT_ID", redirectUri: window.location.origin } };
           // // Check if msal is loaded before using it
           // if (typeof msal !== 'undefined' && msal.PublicClientApplication) {
           //     try {
           //         const msalInstance = new msal.PublicClientApplication(msalConfig);
           //         msalInstance.loginPopup({ scopes: ["User.Read"] }).then(handleMicrosoftLoginResponse).catch(handleMicrosoftLoginError);
           //     } catch (err) {
           //          console.error("Error initializing MSAL:", err);
           //          alert("Failed to initialize Microsoft Sign-In.");
           //     }
           // } else {
           //     console.error("MSAL library not loaded.");
           //     alert("Microsoft Sign-In library (MSAL) not loaded properly.");
           // }
       });
   }

// **THIS IS THE CLOSING BRACKET FOR DOMContentLoaded**
});


// Placeholder handlers for Sign-in buttons (defined outside DOMContentLoaded)
function handleGoogleCredentialResponse(response) {
  console.log('Google Credential Response:', response);
  // Update UI - Make sure 'user-info' element exists in your HTML
  const userInfoDiv = document.getElementById('user-info');
  if(userInfoDiv) userInfoDiv.textContent = 'Signed in with Google';
}
function handleMicrosoftLoginResponse(loginResponse) {
  console.log('Microsoft Login Response:', loginResponse);
   // Update UI - Make sure 'user-info' element exists in your HTML
  const userInfoDiv = document.getElementById('user-info');
  if(userInfoDiv && loginResponse.account) userInfoDiv.textContent = 'Signed in as: ' + loginResponse.account.username;
}
function handleMicrosoftLoginError(error) {
  console.error('Microsoft Login Error:', error);
   alert('Microsoft login failed. See console for details.');
}
