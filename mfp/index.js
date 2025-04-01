```javascript
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
    return JSON.parse(text);
  } catch (err) {
    // Check if the error is due to trying to parse non-JSON after all
    if (err instanceof SyntaxError) {
         console.warn(`SyntaxError parsing JSON from ${url}: ${err.message}. Content likely not valid JSON.`);
    } else {
         console.error(`Error reading/parsing JSON response from ${url}:`, err);
    }
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
  // Optionally, trigger final analysis with partial data if needed,
  // but typically stopping means we don't proceed to analysis.
  // checkIfAllDone(); // Might be relevant if some requests finished
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
  const numeric = parseFloat(String(str).replace(/[^\d.]/g, ''));
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
      const currentOrder = header.getAttribute("data-sort-order") || "desc"; // Default to desc if not set
      const newOrder = currentOrder === "asc" ? "desc" : "asc";

      // Remove sort order from other headers
       headers.forEach(h => {
           if (h !== header) { // Don't remove from the clicked header yet
                h.removeAttribute("data-sort-order");
                const icon = h.querySelector('.sort-icon');
                if(icon) icon.textContent = ''; // Clear other icons
           }
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
  const isNumericColumn = headerText.includes('qty') || headerText.includes('quantity') || headerText.includes('price') || headerText.includes('cost') || headerText.includes('age') || headerText.includes('num') || headerText.includes('line');

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
      const aDate = aDataDate ? new Date(aDataDate) : new Date(aText);
      const bDate = bDataDate ? new Date(bDataDate) : new Date(bText);

      // Handle invalid dates (push them to the bottom)
      const aValid = !isNaN(aDate.getTime());
      const bValid = !isNaN(bDate.getTime());

      if (aValid && bValid) return asc ? aDate - bDate : bDate - aDate;
      if (aValid && !bValid) return -1; // a comes first
      if (!aValid && bValid) return 1;  // b comes first
      return 0; // Both invalid
    }

    // 2. Numeric Sorting
    if (isNumericColumn) {
        const aNum = parseFloat(aText.replace(/[^0-9.-]/g, ""));
        const bNum = parseFloat(bText.replace(/[^0-9.-]/g, ""));
        const aValid = !isNaN(aNum);
        const bValid = !isNaN(bNum);

        if (aValid && bValid) return asc ? aNum - bNum : bNum - aNum;
        if (aValid && !bValid) return -1;
        if (!aValid && bValid) return 1;
        // Fallback to string compare if one/both aren't numbers but column header suggests they should be
    }

    // 3. String Sorting (default)
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
    const originalPart = record.ORD && record.ORD.trim() ? record.ORD : partNumber;

    // Build structured alt array
    const alternatives = [];
    if (record.FRU && record.FRU.length > 0) {
      record.FRU.forEach(num => alternatives.push({ type: 'FRU', value: num.trim() }));
    }
    if (record.MFG && record.MFG.length > 0) {
      record.MFG.forEach(num => alternatives.push({ type: 'MFG', value: num.trim() }));
    }
    if (record.OEM && record.OEM.length > 0) {
      record.OEM.forEach(num => alternatives.push({ type: 'OEM', value: num.trim() }));
    }
    if (record.OPT && record.OPT.length > 0) {
      record.OPT.forEach(num => alternatives.push({ type: 'OPT', value: num.trim() }));
    }

    // Filter out empty values
    const validAlternatives = alternatives.filter(alt => alt.value && alt.value !== '');

    console.log(`Found ${validAlternatives.length} alternatives for ${partNumber}`);
    return { original: originalPart, description, category, alternatives: validAlternatives };
  } catch (err) {
    if (err.name === 'AbortError') {
      console.error(`Alternative parts request timed out for ${partNumber}`);
    } else {
      console.error(`Error fetching alternative part numbers for ${partNumber}:`, err);
    }
    return { original: partNumber, description: '', category: '', alternatives: [] };
  }
}

/**
 * Launches alternative expansions. Handles initial limited search and continuation.
 *
 * @param {string} baseNumber - The initial part number to expand
 * @param {Array} finalAlts   - The shared array where discovered alt objects go
 * @param {Function} onNewAlts - Callback invoked whenever new alt(s) appear
 */
function startExpansions(baseNumber, finalAlts, onNewAlts) {
  // Reset flags and state for a new search
  isPaused = false;
  altCountFound = 0;
  limitedSearchMode = true;
  pausedSearchState = { isActive: false, pendingExploration: [], visited: new Set(), finalAlts: [], onNewAltsCallback: null };

  console.log(`Starting expansions for ${baseNumber}, initial limit: ${initialAltLimit}`);
  expansionsInProgress = true;
  const visited = new Set();

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
  if (!altDiv) return;

  // Remove existing button/message if any (safety check)
  const existingBtn = document.getElementById('continue-search-btn');
  if (existingBtn) existingBtn.remove();
  const existingMsg = document.getElementById('continue-search-message');
  if (existingMsg) existingMsg.remove();

  console.log("Adding 'Continue Search' button.");

  // Create message
  const messageDiv = document.createElement('div');
  messageDiv.id = 'continue-search-message';
  messageDiv.innerHTML = `<p style="color:#4CAF50; font-weight:bold; margin-top:15px;">Initial search found ${altCountFound} alternatives. Click below to find more.</p>`;
  altDiv.appendChild(messageDiv);

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
    if (!pausedSearchState.isActive || !pausedSearchState.pendingExploration) {
        console.error("Cannot continue search, paused state is invalid.");
        return;
    }

    // --- Resume Search ---
    isPaused = false;           // Unpause
    limitedSearchMode = false;  // Switch to unlimited mode
    expansionsInProgress = true;// Mark as in progress again

    // Show spinner again
    const spinner = document.getElementById('loading-spinner');
    if (spinner) spinner.style.display = 'inline-block';

    // Get the saved state
    const { pendingExploration, visited, finalAlts, onNewAltsCallback } = pausedSearchState;
    console.log(`Resuming search. ${pendingExploration.length} pending explorations. Visited: ${visited.size}. Current alts: ${finalAlts.length}.`);

    // Clear the paused state now that we're using it
    pausedSearchState = { isActive: false, pendingExploration: [], visited: new Set(), finalAlts: [], onNewAltsCallback: null };

    // Create promises for each pending exploration path
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

  altDiv.appendChild(continueBtn);
}

/***************************************************
 * Recursive Gathering of Alt Parts (Handles Pause/Continue)
 ***************************************************/
async function gatherCombinatoryAlternatives(baseNumber, currentLevel, visited, result, onNewAlts) {
  // --- Immediate Stop/Pause Checks ---
  if (stopSearchRequested) {
    // console.log(`Stopping recursion for ${baseNumber} - User requested stop.`);
    return;
  }
  if (isPaused) {
    // If paused, don't proceed with this branch. It might be resumed later if needed.
    // console.log(`Skipping recursion for ${baseNumber} - Search is paused.`);
    return;
  }
   // Limit recursion depth if configNestedLevel is set (and not -1 for infinite)
   if (configNestedLevel !== -1 && currentLevel > configNestedLevel) {
       // console.log(`Stopping recursion for ${baseNumber} - Reached max depth ${configNestedLevel}`);
       return;
   }
  // --- End Checks ---

  const upperBase = baseNumber.trim().toUpperCase();
  if (visited.has(upperBase)) return; // Avoid cycles
  visited.add(upperBase);
  // console.log(`Exploring: ${baseNumber} (Level ${currentLevel})`);


  try {
    const { alternatives } = await getAlternativePartNumbers(baseNumber);
    let newlyAdded = [];
    let pendingForThisLevel = []; // Track parts to explore from this level

    for (const alt of alternatives) {
       // Re-check stop/pause conditions within the loop
      if (stopSearchRequested || isPaused) break;

      const altUpper = alt.value.trim().toUpperCase();
      if (!visited.has(altUpper) && !result.some(r => r.value.trim().toUpperCase() === altUpper)) {
        // Found a genuinely new alternative

        if (limitedSearchMode && altCountFound >= initialAltLimit) {
          // --- Pause Condition Met ---
          console.log(`Limit of ${initialAltLimit} alternatives reached while processing alternatives for ${baseNumber}. Pausing search.`);
          isPaused = true;

          // Save state for potential continuation
          // Crucially, only save pending explorations *from the point of pause onwards*
          const remainingAlternatives = alternatives.slice(alternatives.indexOf(alt));
          pausedSearchState = {
            isActive: true,
            pendingExploration: remainingAlternatives.map(p => ({ number: p.value, level: currentLevel + 1 })),
            visited: new Set(visited), // Copy the visited set at pause time
            finalAlts: result,
            onNewAltsCallback: onNewAlts
          };
          console.log(`Paused state saved. Pending explorations at this point: ${pausedSearchState.pendingExploration.length}`);


          // Process the batch that triggered the pause (if any)
          if (newlyAdded.length > 0 && onNewAlts) {
            await onNewAlts(newlyAdded);
            newlyAdded = []; // Clear batch after processing
          }

          addContinueSearchButton(); // Show the button
          return; // Stop further processing in this branch
          // --- End Pause Condition ---
        }

        // Add the new alternative (if not paused)
        result.push(alt);
        newlyAdded.push(alt);
        altCountFound++;
        // console.log(`Found alternative #${altCountFound}: ${alt.type} - ${alt.value} (via ${baseNumber})`);

        // Add to list for deeper exploration later
        pendingForThisLevel.push({ number: alt.value, level: currentLevel + 1 });

      } else if (!visited.has(altUpper)) {
         // If it's already in 'result' but not 'visited', it means another branch found it first.
         // We still need to potentially explore *from* it if depth allows.
          pendingForThisLevel.push({ number: alt.value, level: currentLevel + 1 });
      }
    }

    // Process the newly added alternatives from this level (if any were added before pausing/stopping)
    if (newlyAdded.length > 0 && onNewAlts) {
      await onNewAlts(newlyAdded);
    }

    // --- Recursive Calls (if not paused/stopped and depth allows) ---
    if (!isPaused && !stopSearchRequested && (configNestedLevel === -1 || currentLevel < configNestedLevel)) {
        const explorationPromises = pendingForThisLevel.map(item =>
            gatherCombinatoryAlternatives(item.number, item.level, visited, result, onNewAlts)
        );
        await Promise.all(explorationPromises); // Explore children in parallel
    } else if (isPaused) {
        // If we paused *after* processing all alternatives at this level,
        // add the pending explorations from this level to the global paused state
        // This situation should ideally be caught earlier within the loop, but as a fallback:
         if (pausedSearchState.isActive && pendingForThisLevel.length > 0) {
             // Avoid adding duplicates if the pause happened mid-loop
             const currentPendingNumbers = new Set(pausedSearchState.pendingExploration.map(p => p.number));
             pendingForThisLevel.forEach(item => {
                 if (!currentPendingNumbers.has(item.number)) {
                     pausedSearchState.pendingExploration.push(item);
                 }
             });
            // console.log(`Fallback: Added ${pendingForThisLevel.length} pending explorations from ${baseNumber} to paused state.`);
         }
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
    // console.log("CheckIfAllDone: Not done yet.", { stopSearchRequested, isPaused, expansionsInProgress, activeRequestsCount });
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
                finalContent = `<pre>${analyzeResultText.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>`; // Fallback to preformatted text
            }
        } catch (e) {
            console.warn('Error parsing analysis result as HTML, displaying as text:', e);
            finalContent = `<pre>${analyzeResultText.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>`; // Display as preformatted text on error
        }
    } else {
         finalContent = `<pre>${analyzeResultText.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>`; // Wrap non-HTML in <pre> for formatting
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
    // Use innerHTML directly as content might already be HTML
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

  // Add event listeners
  const sendBtn = document.getElementById('chat-send-btn');
  if (sendBtn) {
     // Remove previous listener if exists to prevent duplicates
     sendBtn.replaceWith(sendBtn.cloneNode(true));
     document.getElementById('chat-send-btn').addEventListener('click', handleUserChatSubmit);
  }
  const inputField = document.getElementById('chat-input');
  if (inputField) {
     // Remove previous listener if exists
     inputField.replaceWith(inputField.cloneNode(true));
     document.getElementById('chat-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { // Send on Enter, allow Shift+Enter for newline
        e.preventDefault(); // Prevent default Enter behavior (like form submission)
        handleUserChatSubmit();
      }
    });
  }
}

function handleUserChatSubmit() {
  const inputField = document.getElementById('chat-input');
  if (!inputField) return;
  const userMessage = inputField.value.trim();
  if (!userMessage) return;

  conversationHistory.push({ role: 'user', content: userMessage.replace(/</g, "&lt;").replace(/>/g, "&gt;") }); // Sanitize user input
  inputField.value = '';
  renderConversationUI(); // Show user's message immediately
  sendChatMessageToLLM(); // Send to backend
}

async function sendChatMessageToLLM() {
   // Add a temporary "Assistant is thinking..." message
  conversationHistory.push({ role: 'assistant', content: '<div class="thinking">Assistant is thinking...</div>' });
  renderConversationUI();

  try {
    const selectedModel = document.getElementById('llm-model').value;
    // Send the *entire* history for context
    const historyToSend = conversationHistory.slice(0, -1); // Exclude the "thinking" message
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

     // Remove the "thinking..." message before processing response
    conversationHistory.pop();

    if (!response.ok) {
        console.error(`LLM chat request failed with status: ${response.status}`);
        conversationHistory.push({ role: 'assistant', content: '<div class="error">Sorry, I encountered an error. Please try again.</div>' });
        renderConversationUI();
        return;
    }

    const result = await safelyParseJSON(response, url);
    if (!result) {
       console.error('Failed to parse LLM chat response.');
       conversationHistory.push({ role: 'assistant', content: '<div class="error">Sorry, I received an invalid response. Please try again.</div>' });
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
                 finalContent = `<pre>${assistantReply.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>`;
             }
         } catch (e) {
             finalContent = `<pre>${assistantReply.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>`;
         }
     } else {
          finalContent = `<pre>${assistantReply.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>`;
     }


    conversationHistory.push({ role: 'assistant', content: finalContent });
    renderConversationUI();

  } catch (err) {
    // Remove the "thinking..." message on error too
    if (conversationHistory[conversationHistory.length - 1]?.content.includes('thinking...')) {
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
  // 1) Reset state variables
  stopSearchRequested = false;
  isPaused = false;
  limitedSearchMode = true;
  altCountFound = 0;
  pausedSearchState = { isActive: false, pendingExploration: [], visited: new Set(), finalAlts: [], onNewAltsCallback: null };
  analysisAlreadyCalled = false;
  conversationHistory = [];
  Object.keys(searchResults).forEach(k => { searchResults[k] = []; });
  activeRequestsCount = 0;
  expansionsInProgress = false;

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
         // Only show "No alternatives" if search isn't running or paused
         html += `<p>No alternative part numbers found.</p>`;
    }
    altDiv.innerHTML = html;
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
      await executeEndpointSearches(partsToSearch);
    }
  }

  // --- Main Search Execution ---
  try {
    // 8) Fetch top-level data for the entered part number (gets description, category, direct alts)
    console.log("Fetching initial part data...");
    const topData = await getAlternativePartNumbers(partNumber);
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
        await executeEndpointSearches([{ number: topOriginal, source: `Original: ${topOriginal}` }]);
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
      // If not expanding, we might be done sooner
      checkIfAllDone();
    }

  } catch (err) {
    console.error('Error in main handleSearch execution:', err);
    alert(`An error occurred during the search: ${err.message}`);
    // Hide spinner on error
    if (spinner) spinner.style.display = 'none';
    if (stopBtn) stopBtn.style.display = 'none';
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
  // Don't run endpoint searches while paused, they will run for new parts found *after* continuing.
  // Parts found *before* pause already had their searches triggered by onNewAlts.
   if (isPaused) {
       console.log("Skipping endpoint searches - Search is paused.");
       return;
   }

  console.log(`Executing searches for ${partNumbersInfo.length} parts: ${partNumbersInfo.map(p=>p.number).join(', ')}`);
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
      if (document.getElementById(toggleId)?.checked) {
          activeEndpoints.push(toggleId.replace('toggle-', '')); // Log endpoint name
          toggleChecks[toggleId](); // Add the fetch task
      }
  }

  console.log(`Active endpoints for this batch: ${activeEndpoints.join(', ')}`);
  if (tasks.length > 0) {
      await Promise.all(tasks);
      console.log(`Endpoint searches completed for batch starting with ${partNumbersInfo[0]?.number}`);
  } else {
      console.log("No active endpoints enabled for this search batch.");
  }
    // Final check after this batch potentially finishes
    checkIfAllDone();
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
  // console.log(`Fetching TDSynnex for ${partNumbersInfo.length} parts...`);

  try {
    const newItems = [];
    for (const { number, source } of partNumbersInfo) {
      if (stopSearchRequested || isPaused) break;
      const url = `https://${serverDomain}/webhook/tdsynnex-search?item=${encodeURIComponent(number)}`;
      try {
        const { controller, timeoutId } = createFetchController();
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (!res.ok) continue;

        const xmlText = await res.text();
        if (!xmlText || xmlText.trim() === '') continue;
        const xmlDoc = parseXML(xmlText);
        const priceList = xmlDoc.getElementsByTagName('PriceAvailabilityList')[0];
        if (!priceList) continue;

        const result = {
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
        newItems.push(result);
      } catch (err) {
        if (err.name === 'AbortError') console.warn(`TDSynnex request timed out for ${number}`);
        else console.warn(`TDSynnex fetch error for ${number}:`, err);
      }
    }
    searchResults.tdsynnex.push(...newItems);
    buildTDSynnexTable();
  } catch (err) {
    console.error('Error in fetchTDSynnexData:', err);
  } finally {
    if (loading) loading.style.display = 'none';
    activeRequestsCount--;
    // No need for checkIfAllDone here, handled by executeEndpointSearches caller
  }
}

function buildTDSynnexTable() {
  const resultsDiv = document.querySelector('.tdsynnex-results .results-container');
  if (!resultsDiv) return;
  resultsDiv.innerHTML = '';

  const allItems = searchResults.tdsynnex;
  const filteredItems = allItems.filter(item => {
    const qty = parseInt(item.totalQuantity, 10);
    return !isNaN(qty) && qty > 0; // Filter for quantity > 0
  });

  if (filteredItems.length === 0) {
      resultsDiv.innerHTML = '<p>No results with available quantity found.</p>';
      return;
  }

  const table = document.createElement('table');
  table.innerHTML = `
    <thead>
      <tr>
        <th>Source Part</th>
        <th>Synnex SKU</th>
        <th>Mfg Part Number</th>
        <th>Description</th>
        <th>Status</th>
        <th>Price</th>
        <th>Total Quantity</th>
        <th>Warehouses</th>
      </tr>
    </thead>
    <tbody>
      ${filteredItems.map(item => `
        <tr>
          <td>${item.sourcePartNumber}</td>
          <td>${item.synnexSKU}</td>
          <td>${item.mfgPN}</td>
          <td>${item.description}</td>
          <td>${item.status}</td>
          <td>${item.price}</td>
          <td>${item.totalQuantity}</td>
          <td>${item.warehouses.map(wh => `${wh.city}: ${wh.qty}`).join('<br>')}</td>
        </tr>
      `).join('')}
    </tbody>
  `;
  resultsDiv.appendChild(createTableContainer(table));
  makeTableSortable(table);
}

// --- Ingram ---
async function fetchDistributorData(partNumbersInfo) { // Renamed from original, likely Ingram
  if (stopSearchRequested) return;
  activeRequestsCount++;
  const loading = document.querySelector('#distributors-content .loading'); // Assumes #distributors-content exists
  // console.log(`Fetching Ingram for ${partNumbersInfo.length} parts...`);

  try {
    const newItems = [];
    for (const { number, source } of partNumbersInfo) {
      if (stopSearchRequested || isPaused) break;
       const url = `https://${serverDomain}/webhook/ingram-search?item=${encodeURIComponent(number)}`;
      try {
        const { controller, timeoutId } = createFetchController();
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (!res.ok) continue;

        const data = await safelyParseJSON(res, url); // Use safe parsing with content-type check
        if (!data || !Array.isArray(data)) continue;

        const resultsWithSource = data.map(obj => ({ ...obj, sourcePartNumber: source }));
        newItems.push(...resultsWithSource);
      } catch (err) {
        if (err.name === 'AbortError') console.warn(`Ingram request timed out for ${number}`);
        else console.warn(`Ingram error for ${number}:`, err);
      }
    }
    searchResults.ingram.push(...newItems);
    buildIngramTable();
  } catch (err) {
    console.error('Error in fetchDistributorData (Ingram):', err);
     const resultsDiv = document.querySelector('#distributors-content .ingram-results .results-container');
     if (resultsDiv) resultsDiv.innerHTML = `<div class="error">Error loading Ingram data: ${err.message}</div>`;
  } finally {
    if (loading) loading.style.display = 'none';
    activeRequestsCount--;
  }
}

function buildIngramTable() {
  const resultsDiv = document.querySelector('#distributors-content .ingram-results .results-container');
  if (!resultsDiv) return;
  resultsDiv.innerHTML = '';

  const items = searchResults.ingram;
  if (items.length === 0) {
      resultsDiv.innerHTML = '<p>No Ingram results found.</p>';
      return;
  }

  const table = document.createElement('table');
  table.innerHTML = `
    <thead>
      <tr>
        <th>Source Part</th>
        <th>Description</th>
        <th>Category</th>
        <th>Vendor</th>
        <th>Part Number</th>
        <th>UPC Code</th>
        <th>Product Type</th>
        <th>Status</th>
      </tr>
    </thead>
    <tbody>
      ${items.map(it => `
        <tr>
          <td>${it.sourcePartNumber}</td>
          <td>${it.description || '-'}</td>
          <td>${it.category || '-'}</td>
          <td>${it.vendorName || '-'}</td>
          <td>${it.vendorPartNumber || '-'}</td>
          <td>${it.upcCode || '-'}</td>
          <td>${it.productType || '-'}</td>
          <td>
            ${it.discontinued === 'True' ? '<span class="text-error">Discontinued</span>' : ''}
            ${it.newProduct === 'True' ? '<span class="text-success">New</span>' : ''}
            ${it.discontinued !== 'True' && it.newProduct !== 'True' ? 'Active' : ''}
          </td>
        </tr>
      `).join('')}
    </tbody>
  `;
  resultsDiv.appendChild(createTableContainer(table));
  makeTableSortable(table);
}


// --- BrokerBin ---
async function fetchBrokerBinData(partNumbersInfo) {
  if (stopSearchRequested) return;
  activeRequestsCount++;
  const loading = document.querySelector('.brokerbin-results .loading');
  if (loading) loading.style.display = 'block';
   // console.log(`Fetching BrokerBin for ${partNumbersInfo.length} parts...`);

  try {
    const newItems = [];
    for (const { number, source } of partNumbersInfo) {
      if (stopSearchRequested || isPaused) break;
       const url = `https://${serverDomain}/webhook/brokerbin-search?item=${encodeURIComponent(number)}`;
      try {
        const { controller, timeoutId } = createFetchController();
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (!res.ok) continue;

        const data = await safelyParseJSON(res, url);
        if (!data || !Array.isArray(data)) continue;

        const withSrc = data.map(obj => ({ ...obj, sourcePartNumber: source }));
        newItems.push(...withSrc);
      } catch (err) {
        if (err.name === 'AbortError') console.warn(`BrokerBin request timed out for ${number}`);
        else console.warn(`BrokerBin error for ${number}:`, err);
      }
    }
    searchResults.brokerbin.push(...newItems);
    buildBrokerBinTable();
  } catch (error) {
    console.error('Error in fetchBrokerBinData:', error);
     const resultsDiv = document.querySelector('.brokerbin-results .results-container');
     if (resultsDiv) resultsDiv.innerHTML = `<div class="error">Error loading BrokerBin data: ${error.message}</div>`;
  } finally {
    if (loading) loading.style.display = 'none';
    activeRequestsCount--;
  }
}

function buildBrokerBinTable() {
  const resultsDiv = document.querySelector('.brokerbin-results .results-container');
  if (!resultsDiv) return;
  resultsDiv.innerHTML = '';

  const items = searchResults.brokerbin;
  if (items.length === 0) {
      resultsDiv.innerHTML = '<p>No BrokerBin results found.</p>';
      return;
  }

  const table = document.createElement('table');
  table.innerHTML = `
    <thead>
      <tr>
        <th>Source Part</th>
        <th>Company</th>
        <th>Country</th>
        <th>Part</th>
        <th>Manufacturer</th>
        <th>Condition</th>
        <th>Description</th>
        <th>Price</th>
        <th>Quantity</th>
        <th>Age (Days)</th>
      </tr>
    </thead>
    <tbody>
      ${items.map(it => `
        <tr>
          <td>${it.sourcePartNumber}</td>
          <td>${it.company || '-'}</td>
          <td>${it.country || '-'}</td>
          <td>${it.part || '-'}</td>
          <td>${it.mfg || '-'}</td>
          <td>${it.cond || '-'}</td>
          <td>${it.description || '-'}</td>
          <td>${it.price ? '$' + parseFloat(it.price).toFixed(2) : '-'}</td>
          <td>${it.qty || '0'}</td>
          <td>${it.age_in_days || '-'}</td>
        </tr>
      `).join('')}
    </tbody>
  `;
  resultsDiv.appendChild(createTableContainer(table));
  makeTableSortable(table);
}

// --- Epicor Inventory (CRITICAL) ---
async function fetchInventoryData(partNumbersInfo) {
  if (stopSearchRequested) return;
  activeRequestsCount++;
  const loading = document.querySelector('#inventory-content .loading');
  if (loading) loading.style.display = 'block';
   // console.log(`Fetching EPICOR Inventory for ${partNumbersInfo.length} parts...`);

  try {
    const newItems = [];
    for (const { number, source } of partNumbersInfo) {
      if (stopSearchRequested || isPaused) break;
      const url = `https://${serverDomain}/webhook/epicor-search?item=${encodeURIComponent(number)}`;
      // console.log(`EPICOR Inv: Fetching ${number} at ${new Date().toISOString()}`);
      try {
        const { controller, timeoutId } = createFetchController(LONG_API_TIMEOUT); // Use longer timeout
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (!res.ok) {
          console.warn(`EPICOR Inventory request for ${number} failed: Status ${res.status}`);
          continue;
        }

        const data = await safelyParseJSON(res, url);
        if (!data || !Array.isArray(data)) {
          console.warn(`EPICOR Inventory for ${number}: Invalid data format received.`);
          continue;
        }

        const withSrc = data.map(obj => ({ ...obj, sourcePartNumber: source }));
        newItems.push(...withSrc);
        // console.log(`EPICOR Inv: Found ${withSrc.length} raw items for ${number}`);
      } catch (err) {
        if (err.name === 'AbortError') console.error(`EPICOR Inventory request timed out for ${number}`);
        else console.error(`EPICOR Inventory fetch error for ${number}:`, err);
      }
    }
    searchResults.epicor.push(...newItems);
    buildEpicorInventoryTable();
  } catch (err) {
    console.error('Error in fetchInventoryData (Epicor):', err);
    const resultsDiv = document.querySelector('#inventory-content .inventory-results');
     if (resultsDiv) resultsDiv.innerHTML = `<div class="error">Error loading Epicor Inventory data: ${err.message}</div>`;
  } finally {
    if (loading) loading.style.display = 'none';
    activeRequestsCount--;
  }
}

function buildEpicorInventoryTable() {
  const resultsDiv = document.querySelector('#inventory-content .inventory-results');
  if (!resultsDiv) return;
  resultsDiv.innerHTML = '';

  const allItems = searchResults.epicor;
  // Filter for valid PartNum and Quantity > 0
  const filteredItems = allItems.filter(it =>
    it.PartNum && it.PartNum.trim() !== '' &&
    it.Quantity && Number(it.Quantity) > 0
  );
  // console.log(`Building EPICOR inventory table. Total raw: ${allItems.length}, Filtered (Qty>0): ${filteredItems.length}`);

  if (filteredItems.length === 0) {
      resultsDiv.innerHTML = '<p>No inventory with available quantity found.</p>';
      return;
  }

  const table = document.createElement('table');
  table.innerHTML = `
    <thead>
      <tr>
        <th>Source Part</th>
        <th>Company</th>
        <th>Part Number</th>
        <th>Description</th>
        <th>Class</th>
        <th>Product Code</th>
        <th>Quantity</th>
        <th>Base Price</th>
        <th>Status</th>
      </tr>
    </thead>
    <tbody>
      ${filteredItems.map(it => `
        <tr>
          <td>${it.sourcePartNumber}</td>
          <td>${it.Company}</td>
          <td>${it.PartNum.trim()}</td>
          <td>${it.PartDescription || '-'}</td>
          <td>${it.ClassDescription || '-'}</td>
          <td>${it.ProdCodeDescription || '-'}</td>
          <td>${(it.Quantity !== undefined && it.Quantity !== null) ? it.Quantity : '-'}</td>
          <td>${(it.BasePrice !== undefined && it.BasePrice !== null) ? '$' + parseFloat(it.BasePrice).toFixed(2) : '-'}</td>
          <td>${it.InActive ? '<span class="text-error">Inactive</span>' : '<span class="text-success">Active</span>'}</td>
        </tr>
      `).join('')}
    </tbody>
  `;
  resultsDiv.appendChild(createTableContainer(table));
  makeTableSortable(table);
}

// --- Sales (CRITICAL) ---
async function fetchSalesData(partNumbersInfo) {
  if (stopSearchRequested) return;
  activeRequestsCount++;
  const loading = document.querySelector('#sales-content .loading');
  if (loading) loading.style.display = 'block';
   // console.log(`Fetching EPICOR Sales for ${partNumbersInfo.length} parts...`);

  try {
    const newItems = [];
    for (const { number, source } of partNumbersInfo) {
      if (stopSearchRequested || isPaused) break;
       const url = `https://${serverDomain}/webhook/epicor-sales?item=${encodeURIComponent(number)}`;
       // console.log(`EPICOR Sales: Fetching ${number} at ${new Date().toISOString()}`);
      try {
        const { controller, timeoutId } = createFetchController(LONG_API_TIMEOUT);
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (!res.ok) {
          console.warn(`EPICOR Sales request for ${number} failed: Status ${res.status}`);
          continue;
        }

        const data = await safelyParseJSON(res, url);
        if (!data || !Array.isArray(data)) {
          console.warn(`EPICOR Sales for ${number}: Invalid data format received.`);
          continue;
        }

        data.forEach(entry => {
          const details = entry?.returnObj?.OrderDtlPA || [];
          details.forEach(line => {
            newItems.push({
              sourcePartNumber: source,
              PartNum: line.PartNum,
              LineDesc: line.LineDesc,
              OrderNum: line.OrderNum,
              OrderLine: line.OrderLine,
              CustomerID: line.CustomerCustID,
              CustomerName: line.CustomerCustName,
              OrderDate: line.OrderHedOrderDate, // Keep raw date for sorting
              OrderQty: line.OrderQty,
              UnitPrice: line.UnitPrice,
              RequestDate: line.RequestDate,
              NeedByDate: line.NeedByDate
            });
          });
           // if (details.length > 0) console.log(`EPICOR Sales: Found ${details.length} order details for ${number}`);
        });
      } catch (err) {
        if (err.name === 'AbortError') console.error(`EPICOR Sales request timed out for ${number}`);
        else console.error(`EPICOR Sales fetch error for ${number}:`, err);
      }
    }
    searchResults.sales.push(...newItems);
    buildSalesTable();
  } catch (err) {
    console.error('Error in fetchSalesData (Epicor):', err);
     const resultsDiv = document.querySelector('#sales-content .sales-results');
     if (resultsDiv) resultsDiv.innerHTML = `<div class="error">Error loading Epicor Sales data: ${err.message}</div>`;
  } finally {
    if (loading) loading.style.display = 'none';
    activeRequestsCount--;
  }
}

function buildSalesTable() {
  const resultsDiv = document.querySelector('#sales-content .sales-results');
  if (!resultsDiv) return;
  resultsDiv.innerHTML = '';

  const items = searchResults.sales;
  // console.log(`Building sales table with ${items.length} total items`);

  if (items.length === 0) {
      resultsDiv.innerHTML = '<p>No sales data found.</p>';
      return;
  }

  // Pre-sort by OrderDate (newest first) - CRITICAL
  const sortedItems = [...items].sort((a, b) => {
    const dateA = a.OrderDate ? new Date(a.OrderDate) : null;
    const dateB = b.OrderDate ? new Date(b.OrderDate) : null;
    if (!dateA && !dateB) return 0;
    if (!dateA) return 1;
    if (!dateB) return -1;
    return dateB - dateA; // Newest first
  });

  const table = document.createElement('table');
  table.innerHTML = `
    <thead>
      <tr>
        <th>Source Part</th>
        <th>Part Number</th>
        <th>Description</th>
        <th>Order Num</th>
        <th>Line</th>
        <th>Customer ID</th>
        <th>Customer Name</th>
        <th>Order Date</th>
        <th>Order Qty</th>
        <th>Unit Price</th>
        <th>Request Date</th>
        <th>Need By Date</th>
      </tr>
    </thead>
    <tbody>
      ${sortedItems.map(it => `
        <tr>
          <td>${it.sourcePartNumber}</td>
          <td>${it.PartNum || '-'}</td>
          <td>${it.LineDesc || '-'}</td>
          <td>${it.OrderNum || '-'}</td>
          <td>${it.OrderLine || '-'}</td>
          <td>${it.CustomerID || '-'}</td>
          <td>${it.CustomerName || '-'}</td>
          <td data-date="${it.OrderDate || ''}">${formatDate(it.OrderDate)}</td>
          <td>${it.OrderQty || '-'}</td>
          <td>${it.UnitPrice != null ? '$' + parseFloat(it.UnitPrice).toFixed(2) : '-'}</td>
          <td data-date="${it.RequestDate || ''}">${formatDate(it.RequestDate)}</td>
          <td data-date="${it.NeedByDate || ''}">${formatDate(it.NeedByDate)}</td>
        </tr>
      `).join('')}
    </tbody>
  `;
  resultsDiv.appendChild(createTableContainer(table));
  makeTableSortable(table);

  // Mark the Order Date header as initially sorted desc
  const orderDateHeader = table.querySelector('th:nth-child(8)'); // 8th column
  if (orderDateHeader) {
      orderDateHeader.setAttribute("data-sort-order", "desc");
       const icon = orderDateHeader.querySelector('.sort-icon');
       if(icon) icon.textContent = ' ▼';
  }
}

// --- Purchases (CRITICAL) ---
async function fetchPurchasesData(partNumbersInfo) {
  if (stopSearchRequested) return;
  activeRequestsCount++;
  const loading = document.querySelector('#purchases-content .loading');
  if (loading) loading.style.display = 'block';
   // console.log(`Fetching EPICOR Purchases for ${partNumbersInfo.length} parts...`);

  try {
    const newItems = [];
    for (const { number, source } of partNumbersInfo) {
      if (stopSearchRequested || isPaused) break;
      const url = `https://${serverDomain}/webhook/epicor-purchases?item=${encodeURIComponent(number)}`;
      // console.log(`EPICOR Purch: Fetching ${number} at ${new Date().toISOString()}`);
      try {
        const { controller, timeoutId } = createFetchController(LONG_API_TIMEOUT);
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (!res.ok) {
           console.warn(`EPICOR Purchases request for ${number} failed: Status ${res.status}`);
          continue;
        }

        const data = await safelyParseJSON(res, url);
         if (!data || !Array.isArray(data)) {
           console.warn(`EPICOR Purchases for ${number}: Invalid data format received.`);
           continue;
         }

        data.forEach(entry => {
          const purchasedItems = entry?.returnObj?.PAPurchasedBefore || [];
          purchasedItems.forEach(line => {
            newItems.push({
              sourcePartNumber: source,
              PartNum: line.PartNum,
              VendorName: line.VendorName,
              VendorQty: line.VendorQty,
              VendorUnitCost: line.VendorUnitCost,
              PONum: line.PONum,
              ReceiptDate: line.ReceiptDate,
              OrderDate: line.OrderDate, // Keep raw date
              DueDate: line.DueDate,
              IsAdvisor: false,
              PartDescription: line.PartDescription || '',
              PurchasedBefore: true
            });
          });
           // if (purchasedItems.length > 0) console.log(`EPICOR Purch: Found ${purchasedItems.length} purchase items for ${number}`);
        });
      } catch (err) {
        if (err.name === 'AbortError') console.error(`EPICOR Purchases request timed out for ${number}`);
        else console.error(`EPICOR Purchases fetch error for ${number}:`, err);
      }
    }
    searchResults.purchases.push(...newItems);
    buildPurchasesTable();
  } catch (err) {
    console.error('Error in fetchPurchasesData (Epicor):', err);
    const resultsDiv = document.querySelector('#purchases-content .purchases-results');
     if (resultsDiv) resultsDiv.innerHTML = `<div class="error">Error loading Epicor Purchases data: ${err.message}</div>`;
  } finally {
    if (loading) loading.style.display = 'none';
    activeRequestsCount--;
  }
}

function buildPurchasesTable() {
  const resultsDiv = document.querySelector('#purchases-content .purchases-results');
  if (!resultsDiv) return;
  resultsDiv.innerHTML = '';

  const allItems = searchResults.purchases;
  const filteredItems = allItems.filter(it => it.PartNum && it.PartNum.trim() !== ''); // Basic filter
  // console.log(`Building purchases table with ${filteredItems.length} total items`);


  if (filteredItems.length === 0) {
      resultsDiv.innerHTML = '<p>No purchase data found.</p>';
      return;
  }

  // Pre-sort by OrderDate (newest first) - CRITICAL
  const sortedItems = [...filteredItems].sort((a, b) => {
    const dateA = a.OrderDate ? new Date(a.OrderDate) : null;
    const dateB = b.OrderDate ? new Date(b.OrderDate) : null;
    if (!dateA && !dateB) return 0;
    if (!dateA) return 1;
    if (!dateB) return -1;
    return dateB - dateA; // Newest first
  });

  const table = document.createElement('table');
  table.innerHTML = `
    <thead>
      <tr>
        <th>Source Part</th>
        <th>Part Number</th>
        <th>Vendor Name</th>
        <th>Vendor Qty</th>
        <th>Vendor Unit Cost</th>
        <th>PO Number</th>
        <th>Receipt Date</th>
        <th>Order Date</th>
        <th>Due Date</th>
        <th>Advisor</th>
        <th>Description</th>
        <th>Purchased Before</th>
      </tr>
    </thead>
    <tbody>
      ${sortedItems.map(it => `
        <tr>
          <td>${it.sourcePartNumber}</td>
          <td>${it.PartNum || '-'}</td>
          <td>${it.VendorName || '-'}</td>
          <td>${it.VendorQty || '-'}</td>
          <td>${it.VendorUnitCost != null ? '$' + parseFloat(it.VendorUnitCost).toFixed(2) : '-'}</td>
          <td>${it.PONum || '-'}</td>
          <td data-date="${it.ReceiptDate || ''}">${formatDate(it.ReceiptDate)}</td>
          <td data-date="${it.OrderDate || ''}">${formatDate(it.OrderDate)}</td>
          <td data-date="${it.DueDate || ''}">${formatDate(it.DueDate)}</td>
          <td>${it.IsAdvisor ? 'Yes' : 'No'}</td>
          <td>${it.PartDescription || '-'}</td>
          <td>${typeof it.PurchasedBefore === 'boolean' ? (it.PurchasedBefore ? 'Yes' : 'No') : '-'}</td>
        </tr>
      `).join('')}
    </tbody>
  `;
  resultsDiv.appendChild(createTableContainer(table));
  makeTableSortable(table);

  // Mark the Order Date header as initially sorted desc
  const orderDateHeader = table.querySelector('th:nth-child(8)'); // 8th column
  if (orderDateHeader) {
      orderDateHeader.setAttribute("data-sort-order", "desc");
       const icon = orderDateHeader.querySelector('.sort-icon');
       if(icon) icon.textContent = ' ▼';
  }
}

// --- AmazonConnector ---
async function fetchAmazonConnectorData(partNumbersInfo) {
  if (stopSearchRequested) return;
  activeRequestsCount++;
  const loading = document.querySelector('.amazon-connector-results .loading');
  if (loading) loading.style.display = 'block';
   // console.log(`Fetching Amazon Connector for ${partNumbersInfo.length} parts...`);

  try {
    const newItems = [];
    for (const { number, source } of partNumbersInfo) {
      if (stopSearchRequested || isPaused) break;
      const url = `https://${serverDomain}/webhook/amazon-search?item=${encodeURIComponent(number)}`;
      try {
        const { controller, timeoutId } = createFetchController();
        const resp = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (!resp.ok) continue;

        const data = await safelyParseJSON(resp, url);
        if (!data || !Array.isArray(data)) continue;

        data.forEach(obj => newItems.push({ ...obj, sourcePartNumber: source }));
      } catch (err) {
        if (err.name === 'AbortError') console.warn(`AmazonConnector request timed out for ${number}`);
        else console.warn(`AmazonConnector error for ${number}:`, err);
      }
    }
    searchResults.amazonConnector.push(...newItems);
    buildAmazonConnectorTable();
  } catch (err) {
    console.error('Error in fetchAmazonConnectorData:', err);
     const resultsDiv = document.querySelector('.amazon-connector-results .results-container');
     if (resultsDiv) resultsDiv.innerHTML = `<div class="error">Error loading Amazon Connector data: ${err.message}</div>`;
  } finally {
    if (loading) loading.style.display = 'none';
    activeRequestsCount--;
  }
}

function buildAmazonConnectorTable() {
  const resultsDiv = document.querySelector('.amazon-connector-results .results-container');
  if (!resultsDiv) return;
  resultsDiv.innerHTML = '';

  const items = searchResults.amazonConnector;
  if (items.length === 0) {
      resultsDiv.innerHTML = '<p>No Amazon Connector results found.</p>';
      return;
  }

  const table = document.createElement('table');
  table.innerHTML = `
    <thead>
      <tr>
        <th>Source Part</th>
        <th class="no-sort">Image</th>
        <th>Title</th>
        <th>Price</th>
        <th>List Price</th>
        <th>Rating</th>
        <th>Reviews</th>
        <th>Stock Status</th>
        <th>Seller</th>
      </tr>
    </thead>
    <tbody>
      ${items.map(it => `
        <tr>
          <td>${it.sourcePartNumber}</td>
          <td class="image-cell">
            <img src="${it.thumbnailImage || 'placeholder.png'}" alt="${it.title || 'Product Image'}" class="product-image" onerror="this.src='placeholder.png'; this.alt='Image not available';">
          </td>
          <td><a href="${it.url || '#'}" target="_blank" rel="noopener noreferrer">${it.title || '-'}</a></td>
          <td>${it.price ? (it.price.currency + it.price.value) : '-'}</td>
          <td>${it.listPrice ? (it.listPrice.currency + it.listPrice.value) : '-'}</td>
          <td>${it.stars ? it.stars + '/5' : '-'}</td>
          <td>${it.reviewsCount || '0'}</td>
          <td>${it.inStockText || '-'}</td>
          <td>${(it.seller && it.seller.name) ? it.seller.name : '-'}</td>
        </tr>
      `).join('')}
    </tbody>
  `;
   resultsDiv.appendChild(createTableContainer(table));
  makeTableSortable(table);
}

// --- eBayConnector ---
async function fetchEbayConnectorData(partNumbersInfo) {
  if (stopSearchRequested) return;
  activeRequestsCount++;
  const loading = document.querySelector('.ebay-connector-results .loading');
  if (loading) loading.style.display = 'block';
   // console.log(`Fetching eBay Connector for ${partNumbersInfo.length} parts...`);

  try {
    const newItems = [];
    for (const { number, source } of partNumbersInfo) {
      if (stopSearchRequested || isPaused) break;
       const url = `https://${serverDomain}/webhook/ebay-search?item=${encodeURIComponent(number)}`;
      try {
        const { controller, timeoutId } = createFetchController();
        const resp = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (!resp.ok) continue;

        const data = await safelyParseJSON(resp, url);
        if (!data || !Array.isArray(data)) continue;

        data.forEach(obj => newItems.push({ ...obj, sourcePartNumber: source }));
      } catch (err) {
        if (err.name === 'AbortError') console.warn(`eBayConnector request timed out for ${number}`);
        else console.warn(`eBayConnector error for ${number}:`, err);
      }
    }
    searchResults.ebayConnector.push(...newItems);
    buildEbayConnectorTable();
  } catch (err) {
    console.error('Error in fetchEbayConnectorData:', err);
     const resultsDiv = document.querySelector('.ebay-connector-results .results-container');
     if (resultsDiv) resultsDiv.innerHTML = `<div class="error">Error loading eBay Connector data: ${err.message}</div>`;
  } finally {
    if (loading) loading.style.display = 'none';
    activeRequestsCount--;
  }
}

function buildEbayConnectorTable() {
  const resultsDiv = document.querySelector('.ebay-connector-results .results-container');
  if (!resultsDiv) return;
  resultsDiv.innerHTML = '';

  const items = searchResults.ebayConnector;
  if (items.length === 0) {
       resultsDiv.innerHTML = '<p>No eBay Connector results found.</p>';
       return;
  }

  const table = document.createElement('table');
  table.innerHTML = `
    <thead>
      <tr>
        <th>Source Part</th>
        <th class="no-sort">Image</th>
        <th>Title</th>
        <th>Price</th>
        <th>Condition</th>
        <th>Seller</th>
        <th>Location</th>
        <th>Shipping</th>
      </tr>
    </thead>
    <tbody>
      ${items.map(it => `
        <tr>
          <td>${it.sourcePartNumber}</td>
          <td class="image-cell">
            ${it.images && it.images.length > 0
              ? `<img src="${it.images[0]}" alt="${it.title || 'Product Image'}" class="product-image" onerror="this.src='placeholder.png'; this.alt='Image not available';">`
              : '<img src="placeholder.png" alt="No image" class="product-image">'
            }
          </td>
          <td><a href="${it.url || '#'}" target="_blank" rel="noopener noreferrer">${it.title || '-'}</a></td>
          <td>${it.priceWithCurrency || '-'}</td>
          <td>${it.condition || '-'}</td>
          <td>${it.sellerUrl ? `<a href="${it.sellerUrl}" target="_blank" rel="noopener noreferrer">${it.sellerName || 'Unknown Seller'}</a>` : (it.sellerName || '-')}</td>
          <td>${it.itemLocation || '-'}</td>
          <td>${it.shipping || '-'}</td>
        </tr>
      `).join('')}
    </tbody>
  `;
  resultsDiv.appendChild(createTableContainer(table));
  makeTableSortable(table);
}

// --- AmazonScraper ---
async function fetchAmazonData(partNumbersInfo) {
  if (stopSearchRequested) return;
  activeRequestsCount++;
  const loading = document.querySelector('.amazon-results .loading');
  if (loading) loading.style.display = 'block';
   // console.log(`Fetching Amazon Scraper for ${partNumbersInfo.length} parts...`);

  try {
    const newItems = [];
    for (const { number, source } of partNumbersInfo) {
      if (stopSearchRequested || isPaused) break;
       const url = `https://${serverDomain}/webhook/amazon-scraper?item=${encodeURIComponent(number)}`;
      try {
        const { controller, timeoutId } = createFetchController();
        const resp = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (!resp.ok) continue;

        const data = await safelyParseJSON(resp, url);
         if (!data || !Array.isArray(data) || data.length === 0) continue;

        const { title = [], price = [], image = [], link = [] } = data[0];
        for (let i = 0; i < title.length; i++) {
          newItems.push({
            sourcePartNumber: source,
            title: title[i] || '-',
            rawPrice: price[i] || '-',
            image: image[i] || null,
            link: link[i] || '#'
          });
        }
      } catch (err) {
        if (err.name === 'AbortError') console.warn(`AmazonScraper request timed out for ${number}`);
        else console.warn(`AmazonScraper error for ${number}:`, err);
      }
    }
    searchResults.amazon.push(...newItems);
    buildAmazonScraperTable();
  } catch (err) {
    console.error('Error in fetchAmazonData (Scraper):', err);
     const resultsDiv = document.querySelector('.amazon-results .results-container');
     if (resultsDiv) resultsDiv.innerHTML = `<div class="error">Error loading Amazon Scraper data: ${err.message}</div>`;
  } finally {
    if (loading) loading.style.display = 'none';
    activeRequestsCount--;
  }
}

function buildAmazonScraperTable() {
  const resultsDiv = document.querySelector('.amazon-results .results-container');
  if (!resultsDiv) return;
  resultsDiv.innerHTML = '';

  const items = searchResults.amazon;
   if (items.length === 0) {
        resultsDiv.innerHTML = '<p>No Amazon Scraper results found.</p>';
        return;
   }

  const table = document.createElement('table');
  table.innerHTML = `
    <thead>
      <tr>
        <th>Source Part</th>
        <th class="no-sort">Image</th>
        <th>Description</th>
        <th>Price</th>
      </tr>
    </thead>
    <tbody>
      ${items.map(it => `
        <tr>
          <td>${it.sourcePartNumber}</td>
          <td class="image-cell">
            ${it.image ? `<img src="${it.image}" alt="Product image" class="product-image" onerror="this.src='placeholder.png'; this.alt='Image not available';">` : '<img src="placeholder.png" alt="No image" class="product-image">'}
          </td>
          <td>
            ${it.link && it.link !== '#'
              ? `<a href="${it.link}" target="_blank" rel="noopener noreferrer">${it.title}</a>`
              : it.title}
          </td>
          <td>${it.rawPrice}</td>
        </tr>
      `).join('')}
    </tbody>
  `;
  resultsDiv.appendChild(createTableContainer(table));
  makeTableSortable(table);
}

// --- eBayScraper ---
async function fetchEbayData(partNumbersInfo) {
  if (stopSearchRequested) return;
  activeRequestsCount++;
  const loading = document.querySelector('.ebay-results .loading');
  if (loading) loading.style.display = 'block';
  // console.log(`Fetching eBay Scraper for ${partNumbersInfo.length} parts...`);

  try {
    const newItems = [];
    for (const { number, source } of partNumbersInfo) {
      if (stopSearchRequested || isPaused) break;
       const url = `https://${serverDomain}/webhook/ebay-scraper?item=${encodeURIComponent(number)}`;
      try {
        const { controller, timeoutId } = createFetchController();
        const resp = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (!resp.ok) continue;

        const data = await safelyParseJSON(resp, url);
         if (!data || !Array.isArray(data) || data.length === 0) continue;

        const { title = [], price = [], image = [], link = [] } = data[0];
        for (let i = 0; i < title.length; i++) {
          newItems.push({
            sourcePartNumber: source,
            title: title[i] || '-',
            rawPrice: price[i] || '-',
            image: image[i] || null,
            link: link[i] || '#'
          });
        }
      } catch (err) {
        if (err.name === 'AbortError') console.warn(`eBayScraper request timed out for ${number}`);
        else console.warn(`eBayScraper error for ${number}:`, err);
      }
    }
    searchResults.ebay.push(...newItems);
    buildEbayScraperTable();
  } catch (err) {
    console.error('Error in fetchEbayData (Scraper):', err);
     const resultsDiv = document.querySelector('.ebay-results .results-container');
     if (resultsDiv) resultsDiv.innerHTML = `<div class="error">Error loading eBay Scraper data: ${err.message}</div>`;
  } finally {
    if (loading) loading.style.display = 'none';
    activeRequestsCount--;
  }
}

function buildEbayScraperTable() {
  const resultsDiv = document.querySelector('.ebay-results .results-container');
  if (!resultsDiv) return;
  resultsDiv.innerHTML = '';

  const items = searchResults.ebay;
  if (items.length === 0) {
      resultsDiv.innerHTML = '<p>No eBay Scraper results found.</p>';
      return;
  }

  const table = document.createElement('table');
  table.innerHTML = `
    <thead>
      <tr>
        <th>Source Part</th>
        <th class="no-sort">Image</th>
        <th>Description</th>
        <th>Price</th>
      </tr>
    </thead>
    <tbody>
      ${items.map(it => `
        <tr>
          <td>${it.sourcePartNumber}</td>
          <td class="image-cell">
            ${it.image ? `<img src="${it.image}" alt="Product image" class="product-image" onerror="this.src='placeholder.png'; this.alt='Image not available';">` : '<img src="placeholder.png" alt="No image" class="product-image">'}
          </td>
          <td>
            ${it.link && it.link !== '#'
              ? `<a href="${it.link}" target="_blank" rel="noopener noreferrer">${it.title}</a>`
              : it.title}
          </td>
          <td>${it.rawPrice}</td>
        </tr>
      `).join('')}
    </tbody>
  `;
   resultsDiv.appendChild(createTableContainer(table));
  makeTableSortable(table);
}


// --- Lenovo ---
async function fetchLenovoData(partNumbersInfo) {
  if (stopSearchRequested) return;
  activeRequestsCount++;
  // console.log(`Fetching Lenovo for ${partNumbersInfo.length} parts...`);

  try {
    let newDataFound = false;
    for (const { number, source } of partNumbersInfo) {
      if (stopSearchRequested || isPaused) break;
      const url = `https://${serverDomain}/webhook/lenovo-scraper?item=${encodeURIComponent(number)}`;
      try {
        const { controller, timeoutId } = createFetchController();
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (!response.ok) continue;

        const data = await safelyParseJSON(response, url);
        if (!data || !data[0]?.data || !Array.isArray(data[0].data) || data[0].data.length === 0) continue;

        const docs = data[0].data
          .filter(doc => doc?.content?.trim()) // Filter out empty content
          .map(doc => ({ ...doc, sourcePartNumber: source }));

        if (docs.length > 0) {
            searchResults.lenovo.push(...docs);
            newDataFound = true;
        }
      } catch (error) {
        if (error.name === 'AbortError') console.warn(`Lenovo request timed out for ${number}`);
        else console.warn(`Lenovo error for ${number}:`, error);
      }
    }
    // Only rebuild UI if new data was actually added
    if (newDataFound) {
        buildLenovoUI();
    }

  } catch (err) {
    console.error('Error fetching Lenovo data:', err);
    if (!searchResults.lenovo.length) { // Show error only if nothing was ever loaded
      const subtabs = document.getElementById('lenovo-subtabs');
      if (subtabs) subtabs.innerHTML = `<div class="error">Error fetching Lenovo data: ${err.message}</div>`;
    }
  } finally {
    activeRequestsCount--;
  }
}

function buildLenovoUI() {
  const lenovoContentDiv = document.getElementById('lenovo-content');
  if (!lenovoContentDiv) return;

  let subtabs = document.getElementById('lenovo-subtabs');
  let subcontent = document.getElementById('lenovo-subcontent');
  if (!subtabs) {
    subtabs = document.createElement('div');
    subtabs.id = 'lenovo-subtabs';
    subtabs.className = 'subtabs';
    lenovoContentDiv.appendChild(subtabs);
  }
  if (!subcontent) {
    subcontent = document.createElement('div');
    subcontent.id = 'lenovo-subcontent';
    lenovoContentDiv.appendChild(subcontent);
  }

  subtabs.innerHTML = '';
  subcontent.innerHTML = '';

  const allResults = searchResults.lenovo;
  if (!allResults || allResults.length === 0) {
    subtabs.innerHTML = '<p>No Lenovo data found.</p>';
    return;
  }

  allResults.forEach((doc, index) => {
    const subtabButton = document.createElement('button');
    subtabButton.className = `subtab-button ${index === 0 ? 'active' : ''}`;
    const title = doc.title || 'Untitled Document';
    const cleanTitle = typeof title === 'string' ? title.replace(/\s+/g, ' ').trim() : 'Untitled Document';
    subtabButton.textContent = `${doc.sourcePartNumber} - ${cleanTitle.substring(0, 50)}${cleanTitle.length > 50 ? '...' : ''}`; // Shorten title
    subtabButton.title = cleanTitle; // Full title on hover
    subtabButton.onclick = () => switchLenovoSubtab(index);
    subtabs.appendChild(subtabButton);

    const contentDiv = document.createElement('div');
    contentDiv.className = `subtab-content ${index === 0 ? 'active' : ''}`;
    contentDiv.setAttribute('data-subtab-index', index);
    let processedContent = decodeUnicodeEscapes(doc.content);
    // Basic check if it looks like a table already
    if (!processedContent.trim().toLowerCase().startsWith('<table')) {
        processedContent = `<div class="lenovo-content-wrapper">${processedContent}</div>`; // Wrap in div instead of forcing table
    }
    contentDiv.innerHTML = processedContent;
    subcontent.appendChild(contentDiv);
  });
}

function switchLenovoSubtab(index) {
  document.querySelectorAll('#lenovo-subtabs .subtab-button').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('#lenovo-subcontent .subtab-content').forEach(c => c.classList.remove('active'));
  const buttons = document.querySelectorAll('#lenovo-subtabs .subtab-button');
  const contents = document.querySelectorAll('#lenovo-subcontent .subtab-content');
  if (buttons[index]) buttons[index].classList.add('active');
  if (contents[index]) contents[index].classList.add('active');
}

function decodeUnicodeEscapes(str) {
  if (typeof str !== 'string') return '';
  try {
    // More robust unicode escape handling
    return str.replace(/\\u([\dA-F]{4})/gi, (match, grp) =>
        String.fromCharCode(parseInt(grp, 16))
    ).replace(/\\u\{([\dA-F]{1,})\}/gi, (match, grp) => // Handle extended unicode \u{xxxxx}
        String.fromCodePoint(parseInt(grp, 16))
    );
  } catch (e) {
      console.warn("Error decoding unicode escapes:", e);
      return str; // Return original string on error
  }
}

// --- Helper to format dates ---
function formatDate(dateString) {
    if (!dateString) return '-';
    try {
        const date = new Date(dateString);
        // Check if the date is valid (handles null, undefined, empty strings, invalid formats)
        if (isNaN(date.getTime()) || date.getFullYear() < 1900) return '-';
        // Format as YYYY-MM-DD for consistency and better sorting
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    } catch (e) {
        console.warn(`Error formatting date: ${dateString}`, e);
        return '-'; // Return '-' if any error during parsing/formatting
    }
}

// --- Helper to create table container ---
function createTableContainer(tableElement) {
    const container = document.createElement('div');
    container.className = 'table-container'; // Add class for potential overflow styling
    container.appendChild(tableElement);
    return container;
}

/***************************************************
 * Summary Tab (with Corrected Filtering)
 ***************************************************/
function updateSummaryTab(searchCompleted = false) {
  const summaryDiv = document.getElementById('summary-content');
  if (!summaryDiv) return;

  const searchStoppedByUser = stopSearchRequested;
  const searchPaused = isPaused;

  // Build notifications
  let notifications = '';
  if (searchStoppedByUser) {
    notifications += `<div class="search-stopped-message" style="padding: 10px; background-color: #ffecec; border: 1px solid #f5c6cb; border-radius: 4px; margin-bottom: 15px;"><p><strong>Search was stopped by user.</strong> Partial results are displayed.</p></div>`;
  } else if (searchPaused) {
     notifications += `<div class="search-paused-message" style="padding: 10px; background-color: #fff3cd; border: 1px solid #ffeeba; border-radius: 4px; margin-bottom: 15px;"><p><strong>Search paused after finding initial alternatives.</strong> Results shown are partial. Click 'Continue Search' above to find more.</p></div>`;
  } else if (searchCompleted) {
    notifications += `<div class="search-completed-message" style="padding: 10px; background-color: #d4edda; border: 1px solid #c3e6cb; border-radius: 4px; margin-bottom: 15px;"><p><strong>Search completed.</strong> Full results are displayed below.</p></div>`;
  }
  // Note: Could add an "in progress" message if needed, based on activeRequestsCount/expansionsInProgress

  // Generate summary content
  const summaryContent = generateSummaryTableHtml();

  // Update the div
  summaryDiv.innerHTML = notifications + summaryContent;
}


function generateSummaryTableHtml() {
  // console.log("Generating summary table HTML...");

  // --- Inner Helper Function to Create Summary Table for a Key ---
  function createSummaryTable(key, label) {
    let dataArray = searchResults[key] || [];
    let filteredDataArray = [...dataArray]; // Start with a copy

    // --- Apply Filtering Logic Specific to Summary ---
    let filterDescription = "";
    if (key === 'epicor') {
      const originalCount = filteredDataArray.length;
      filteredDataArray = filteredDataArray.filter(item => item.Quantity && Number(item.Quantity) > 0);
      filterDescription = ` (Showing ${filteredDataArray.length} of ${originalCount} with Qty > 0)`;
      // console.log(`Summary Epicor: Raw=${originalCount}, Filtered (Qty>0)=${filteredDataArray.length}`);
    } else if (key === 'tdsynnex') {
      const originalCount = filteredDataArray.length;
      filteredDataArray = filteredDataArray.filter(item => item.totalQuantity && parseInt(item.totalQuantity, 10) > 0);
       filterDescription = ` (Showing ${filteredDataArray.length} of ${originalCount} with Qty > 0)`;
       // console.log(`Summary TDSynnex: Raw=${originalCount}, Filtered (Qty>0)=${filteredDataArray.length}`);
    }
    // --- End Filtering Logic ---


    if (filteredDataArray.length === 0) return ''; // Don't show table if no items after filtering

    // Group filtered results by sourcePartNumber
    const grouped = {};
    filteredDataArray.forEach(item => {
      const pnum = item.sourcePartNumber || 'Unknown Source';
      if (!grouped[pnum]) grouped[pnum] = [];
      grouped[pnum].push(item);
    });

    // Find best price within the *filtered* group
    function findBestPrice(items) {
      let minPrice = null;
      items.forEach(it => {
        let priceVal = null;
        switch (key) {
          case 'amazonConnector': priceVal = it.price?.value ? parseFloat(it.price.value) : null; break;
          case 'ebayConnector': priceVal = parsePrice(it.priceWithCurrency); break;
          case 'amazon': priceVal = parsePrice(it.rawPrice); break;
          case 'ebay': priceVal = parsePrice(it.rawPrice); break;
          case 'brokerbin': priceVal = parsePrice(it.price); break; // Use helper
          case 'tdsynnex': priceVal = parseFloat(it.price); break;
          case 'epicor': priceVal = parseFloat(it.BasePrice); break; // Use BasePrice
          // Add cases for other vendors if they have price fields
        }
         // Ensure price is a valid positive number
        if (priceVal != null && !isNaN(priceVal) && priceVal > 0) {
          if (minPrice == null || priceVal < minPrice) {
            minPrice = priceVal;
          }
        }
      });
      return minPrice;
    }

    // Generate table rows
    let rows = '';
    for (const part in grouped) {
      const bestPrice = findBestPrice(grouped[part]);
      rows += `
        <tr>
          <td>${part}</td>
          <td>${grouped[part].length}</td>
          <td>${bestPrice != null ? '$' + bestPrice.toFixed(2) : '-'}</td>
        </tr>
      `;
    }

    return `
      <div class="summary-section">
        <h3>${label} Summary ${filterDescription}</h3>
        <table>
          <thead>
            <tr>
              <th>Source Part</th>
              <th>Items Found</th>
              <th>Best Price</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    `;
  }
  // --- End Inner Helper Function ---


  // --- Build HTML for Enabled Toggles ---
  let summaryHTML = '';
  const toggles = [
      { id: 'toggle-inventory', key: 'epicor', label: 'Epicor (Inventory)'},
      { id: 'toggle-brokerbin', key: 'brokerbin', label: 'BrokerBin'},
      { id: 'toggle-tdsynnex', key: 'tdsynnex', label: 'TDSynnex'},
      { id: 'toggle-ingram', key: 'ingram', label: 'Ingram'},
      { id: 'toggle-amazon-connector', key: 'amazonConnector', label: 'Amazon Connector'},
      { id: 'toggle-ebay-connector', key: 'ebayConnector', label: 'eBay Connector'},
      { id: 'toggle-amazon', key: 'amazon', label: 'Amazon Scraper'},
      { id: 'toggle-ebay', key: 'ebay', label: 'eBay Scraper'},
      // Add Sales/Purchases to summary? They don't typically have a 'best price' concept.
      // Maybe just show counts?
      // { id: 'toggle-sales', key: 'sales', label: 'Sales History'},
      // { id: 'toggle-purchases', key: 'purchases', label: 'Purchase History'},
  ];

  let anyTablesGenerated = false;
  toggles.forEach(toggle => {
      if (document.getElementById(toggle.id)?.checked) {
          const tableHtml = createSummaryTable(toggle.key, toggle.label);
          summaryHTML += tableHtml;
          if (tableHtml) anyTablesGenerated = true;
      }
  });
  // --- End Build HTML ---

   // console.log("Finished generating summary table HTML.");
  return anyTablesGenerated ? summaryHTML : '<p>No summary results found for the selected sources (or results have zero quantity where filtered).</p>';
}


/***************************************************
 * Gathers final results (HTML content) for LLM analysis
 ***************************************************/
function gatherResultsForAnalysis() {
  // console.log("Gathering results for LLM analysis...");
  const results = {};
  const selectors = {
    'epicor-search': '#inventory-content .inventory-results .table-container', // Target the container
    'brokerbin-search': '.brokerbin-results .results-container .table-container',
    'tdsynnex-search': '.tdsynnex-results .results-container .table-container',
    'ingram-search': '.ingram-results .results-container .table-container',
    'amazon-connector': '.amazon-connector-results .results-container .table-container',
    'ebay-connector': '.ebay-connector-results .results-container .table-container',
    'amazon-scraper': '.amazon-results .results-container .table-container',
    'ebay-scraper': '.ebay-results .results-container .table-container',
    'epicor-sales': '#sales-content .sales-results .table-container',
    'epicor-purchases': '#purchases-content .purchases-results .table-container',
     // Add Lenovo? - Complex due to subtabs. Maybe summarize or skip?
     // 'lenovo-scraper': '#lenovo-subcontent' // Example if needed
  };

  // Map selectors to their toggle IDs
   const toggleMap = {
       'epicor-search': 'toggle-inventory',
       'brokerbin-search': 'toggle-brokerbin',
       'tdsynnex-search': 'toggle-tdsynnex',
       'ingram-search': 'toggle-ingram',
       'amazon-connector': 'toggle-amazon-connector',
       'ebay-connector': 'toggle-ebay-connector',
       'amazon-scraper': 'toggle-amazon',
       'ebay-scraper': 'toggle-ebay',
       'epicor-sales': 'toggle-sales', // Assuming these toggles exist
       'epicor-purchases': 'toggle-purchases',
       'lenovo-scraper': 'toggle-lenovo'
   };


  for (const key in selectors) {
      const toggleId = toggleMap[key];
      // Check if the corresponding toggle is checked (if a toggle exists for it)
      if (!toggleId || document.getElementById(toggleId)?.checked) {
          const element = document.querySelector(selectors[key]);
          // Get outerHTML of the table container if it exists and has content
          // Exclude empty/placeholder messages
          if (element && element.innerHTML.trim() !== '' && !element.innerHTML.includes("No results found") && !element.innerHTML.includes("No data found")) {
              results[key] = element.outerHTML;
          }
      }
  }

  // Special handling for Lenovo (grab active tab content?)
  if (document.getElementById('toggle-lenovo')?.checked) {
      const activeLenovoContent = document.querySelector('#lenovo-subcontent .subtab-content.active');
      if (activeLenovoContent && activeLenovoContent.innerHTML.trim() !== '' && !activeLenovoContent.innerHTML.includes("No data found")) {
          results['lenovo-scraper'] = activeLenovoContent.innerHTML; // Just send active tab content
      }
  }


  console.log(`Gathered analysis data for keys: ${Object.keys(results).join(', ')}`);
  return results;
}


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


  // Initial tab setup (optional, default to summary or first tab)
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
           // google.accounts.id.initialize({ client_id: 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com', callback: handleGoogleCredentialResponse });
           // google.accounts.id.prompt();
       });
   }

   const msBtn = document.getElementById('microsoft-signin-btn');
   if (msBtn) {
       msBtn.addEventListener('click', () => {
           alert("Microsoft Sign-In not configured. Replace 'YOUR_MICROSOFT_CLIENT_ID' in the code.");
           // const msalConfig = { auth: { clientId: "YOUR_MICROSOFT_CLIENT_ID", redirectUri: window.location.origin } };
           // // Check if msal is loaded before using it
           // if (typeof msal !== 'undefined' && msal.PublicClientApplication) {
           //     const msalInstance = new msal.PublicClientApplication(msalConfig);
           //     msalInstance.loginPopup({ scopes: ["User.Read"] }).then(handleMicrosoftLoginResponse).catch(handleMicrosoftLoginError);
           // } else {
           //     console.error("MSAL library not loaded.");
           //     alert("Microsoft Sign-In library (MSAL) not loaded properly.");
           // }
       });
   }

// **THIS IS THE CLOSING BRACKET FOR DOMContentLoaded**
});
