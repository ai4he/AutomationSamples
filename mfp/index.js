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

// Stores the entire conversation as an array of message objects:
// e.g. [ { role: "user", content: "Hello" }, { role: "assistant", content: "Hi!" }, ... ]
let conversationHistory = [];

// We'll also store a reference to the chat container so we can re-render the conversation easily
let chatContainer = null;

// Prevents repeated calls to performFinalAnalysis
let analysisAlreadyCalled = false;

// Flag to indicate if search should be stopped
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
 * Stop Search Function
 ***************************************************/
function stopSearch() {
  stopSearchRequested = true;
  console.log("Search stopping requested");
  
  // Hide spinner
  const spinner = document.getElementById('loading-spinner');
  const stopBtn = document.getElementById('stop-search-btn');
  if (spinner) spinner.style.display = 'none';
  if (stopBtn) stopBtn.style.display = 'none';
  
  // Show a message in the summary tab
  const summaryDiv = document.getElementById('summary-content');
  if (summaryDiv && !summaryDiv.querySelector('.search-stopped-message')) {
    const stoppedMessage = document.createElement('div');
    stoppedMessage.className = 'search-stopped-message';
    stoppedMessage.innerHTML = '<p><strong>Search was stopped by user.</strong> Partial results are displayed.</p>';
    stoppedMessage.style.padding = '10px';
    stoppedMessage.style.backgroundColor = '#ffecec';
    stoppedMessage.style.border = '1px solid #f5c6cb';
    stoppedMessage.style.borderRadius = '4px';
    stoppedMessage.style.marginBottom = '15px';
    summaryDiv.prepend(stoppedMessage);
  }
  
  // Update the summary with current partial results
  updateSummaryTab();
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
  const numeric = parseFloat(str.replace(/[^\d.]/g, ''));
  return isNaN(numeric) ? null : numeric;
}

/***************************************************
 * Table Sorting
 ***************************************************/
function makeTableSortable(table) {
  const headers = table.querySelectorAll("th");
  headers.forEach((header, index) => {
    header.style.cursor = "pointer";
    header.addEventListener("click", () => {
      const currentOrder = header.getAttribute("data-sort-order") || "asc";
      const asc = currentOrder === "asc";
      sortTableByColumn(table, index, asc);
      header.setAttribute("data-sort-order", asc ? "desc" : "asc");
    });
  });
}

function sortTableByColumn(table, columnIndex, asc = true) {
  const tbody = table.tBodies[0];
  const rows = Array.from(tbody.querySelectorAll("tr"));

  rows.sort((a, b) => {
    const aText = a.children[columnIndex].textContent.trim();
    const bText = b.children[columnIndex].textContent.trim();

    // Try numeric comparison
    const aNum = parseFloat(aText.replace(/[^0-9.-]/g, ""));
    const bNum = parseFloat(bText.replace(/[^0-9.-]/g, ""));
    if (!isNaN(aNum) && !isNaN(bNum)) {
      return asc ? aNum - bNum : bNum - aNum;
    }
    // fallback to string
    return asc ? aText.localeCompare(bText) : bText.localeCompare(aText);
  });

  rows.forEach(row => tbody.appendChild(row));
}

/***************************************************
 * Switch Tab
 ***************************************************/
function switchTab(tabId) {
  document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
  document.querySelectorAll('.tab-button').forEach(button => button.classList.remove('active'));
  document.getElementById(tabId).classList.add('active');
  document.querySelector(`button[onclick="switchTab('${tabId}')"]`).classList.add('active');
}

/***************************************************
 * getAlternativePartNumbers: obtains direct alt parts (1 level).
 ***************************************************/
async function getAlternativePartNumbers(partNumber) {
  try {
    const response = await fetch(`https://${serverDomain}/webhook/get-parts?item=${encodeURIComponent(partNumber)}`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    if (!data || !data[0]) {
      return {
        original: partNumber,
        description: '',
        category: '',
        alternatives: []
      };
    }
    const record = data[0];
    const description = record.Description || '';
    const category = record.Category || '';
    const originalPart = record.ORD && record.ORD.trim() ? record.ORD : partNumber;

    // Build structured alt array
    const alternatives = [];
    if (record.FRU && record.FRU.length > 0) {
      record.FRU.forEach(num => alternatives.push({ type: 'FRU', value: num }));
    }
    if (record.MFG && record.MFG.length > 0) {
      record.MFG.forEach(num => alternatives.push({ type: 'MFG', value: num }));
    }
    if (record.OEM && record.OEM.length > 0) {
      record.OEM.forEach(num => alternatives.push({ type: 'OEM', value: num }));
    }
    if (record.OPT && record.OPT.length > 0) {
      record.OPT.forEach(num => alternatives.push({ type: 'OPT', value: num }));
    }

    return {
      original: originalPart,
      description,
      category,
      alternatives
    };
  } catch (err) {
    console.error('Error fetching alternative part numbers:', err);
    return {
      original: partNumber,
      description: '',
      category: '',
      alternatives: []
    };
  }
}

/**
 * Launches alternative expansions in the background, 
 * so we can do them in parallel with the main search.
 *
 * @param {string} baseNumber - The initial part number to expand
 * @param {Array} finalAlts   - The shared array where discovered alt objects go
 * @param {Function} onNewAlts - Callback invoked whenever new alt(s) appear
 */
function startExpansions(baseNumber, finalAlts, onNewAlts) {
  // Mark expansions as in progress
  expansionsInProgress = true;

  // We'll track visited parts
  const visited = new Set();

  // Run gatherCombinatoryAlternatives in the background
  gatherCombinatoryAlternatives(baseNumber, 0, visited, finalAlts, onNewAlts)
    .then(() => {
      // Once recursion completes, expansions are done
      expansionsInProgress = false;
      checkIfAllDone();  // might hide spinner + call analysis if activeRequests=0
    })
    .catch(err => {
      console.error('Expansion error:', err);
      expansionsInProgress = false;
      checkIfAllDone();
    });
}


/***************************************************
 * Recursive Gathering of Alt Parts to configNestedLevel
 ***************************************************/
async function gatherCombinatoryAlternatives(baseNumber, currentLevel, visited, result, onNewAlts) {
  // Check if search should be stopped
  if (stopSearchRequested) {
    return;
  }

  const upperBase = baseNumber.trim().toUpperCase();
  if (visited.has(upperBase)) return;
  visited.add(upperBase);

  const { alternatives } = await getAlternativePartNumbers(baseNumber);
  let newlyAdded = [];
  for (const alt of alternatives) {
    const altUpper = alt.value.trim().toUpperCase();
    if (!result.some(r => r.value.trim().toUpperCase() === altUpper)) {
      result.push(alt);
      newlyAdded.push(alt);
    }
  }
  if (newlyAdded.length > 0 && onNewAlts) {
    await onNewAlts(newlyAdded);
  }

  let goDeeper = false;
  if (configNestedLevel === -1) {
    goDeeper = true;
  } else if (configNestedLevel > 0) {
    goDeeper = currentLevel < configNestedLevel;
  }
  if (goDeeper) {
    for (const alt of alternatives) {
      if (stopSearchRequested) return; // Check before each recursive call
      await gatherCombinatoryAlternatives(alt.value, currentLevel + 1, visited, result, onNewAlts);
    }
  }
}


/***************************************************
 * Spinner, expansions, and final analysis
 ***************************************************/
function checkIfAllDone() {
  if (expansionsInProgress) return;
  if (activeRequestsCount > 0) return;
  if (analysisAlreadyCalled) return;

  analysisAlreadyCalled = true;

  // if we reach here => expansions done + no active requests => finalize
  const spinner = document.getElementById('loading-spinner');
  const stopBtn = document.getElementById('stop-search-btn');
  if (spinner) spinner.style.display = 'none';
  if (stopBtn) stopBtn.style.display = 'none';

  performFinalAnalysis();
}

async function performFinalAnalysis() {
  // One last summary update before analysis
  updateSummaryTab();

  try {
    // Gather results from your existing aggregator logic
    const analysisData = gatherResultsForAnalysis();
    const selectedModel = document.getElementById('llm-model').value;
    const promptText = document.getElementById('prompt').value;

    // Prepare query URL for the initial analysis, same as before
    const analyzeUrl = `https://${serverDomain}/webhook/analyze-data?model=${selectedModel}&prompt=${encodeURIComponent(promptText)}`;

    const response = await fetch(analyzeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(analysisData)
    });
    const analyzeResult = await response.json();

    let analyzeResultText = '';
    if (Array.isArray(analyzeResult) && analyzeResult.length > 0 && analyzeResult[0].text) {
      analyzeResultText = analyzeResult[0].text;
    } else {
      analyzeResultText = JSON.stringify(analyzeResult);
    }
    analyzeResultText = analyzeResultText
      .replaceAll("```html", '')
      .replaceAll("```", '');

    // Parse HTML content properly
try {
  const parser = new DOMParser();
  const doc = parser.parseFromString(analyzeResultText, 'text/html');
  if (doc.body && doc.body.innerHTML) {
    analyzeResultText = doc.body.innerHTML;
  }
} catch (e) {
  console.warn('Error parsing HTML content:', e);
}

    // Store the user prompt and the LLM's reply in our conversation array
    // The user's initial prompt:
    conversationHistory.push({
      role: 'user',
      content: promptText || '(No prompt provided)'
    });
    // The model's first reply:
    conversationHistory.push({
      role: 'assistant',
      content: analyzeResultText
    });

    // Update the analysis tab with the result
    const analyzeResultTextDiv = document.querySelector('#analysis-content .analyze-result-text');
    if (analyzeResultTextDiv) {
      analyzeResultTextDiv.innerHTML = '';
    }

    // Initialize the conversation UI in the analysis tab
    initializeConversationUI();

    // Switch to the analysis tab to show the results
    switchTab('analysis');

  } catch (err) {
    console.error('Analyze data error:', err);
  }
}

function initializeConversationUI() {
  // Create a container for the conversation if not already created
  chatContainer = document.getElementById('chat-container-analysis');
  if (!chatContainer) {
    console.error('Chat container element not found in analysis tab');
    return;
  }

  // Render the conversation so far + input
  renderConversationUI();
}

// index.js

// Replace your existing renderConversationUI function with the version below
// to enable automatic scrolling to the bottom of the chat container whenever
// new messages are rendered:

function renderConversationUI() {
  if (!chatContainer) return;

  // 1) Build the HTML for current messages
  let chatHTML = '<div class="chat-messages">';
  conversationHistory.forEach(msg => {
    if (msg.role === 'assistant') {
      // model's reply
      chatHTML += `
        <div class="chat-message assistant">
          <strong>Assistant:</strong> ${msg.content}
        </div>
      `;
    } else {
      // user
      chatHTML += `
        <div class="chat-message user">
          <strong>You:</strong> ${msg.content}
        </div>
      `;
    }
  });
  chatHTML += '</div>';

  // 2) Add an input area to continue the conversation
  chatHTML += `
    <div class="chat-input-area" style="margin-top: 10px;">
      <input type="text" id="chat-input" placeholder="Type your question..." style="width:80%;">
      <button id="chat-send-btn" style="width:18%;">Send</button>
    </div>
  `;

  // Replace the chat container content
  chatContainer.innerHTML = chatHTML;

  // 2a) Immediately scroll chat to the bottom
  const messagesDiv = chatContainer.querySelector('.chat-messages');
  if (messagesDiv) {
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  }

  // 3) Add an event listener for the "Send" button
  const sendBtn = document.getElementById('chat-send-btn');
  if (sendBtn) {
    sendBtn.addEventListener('click', handleUserChatSubmit);
  }

  // Also handle "Enter" key in the input
  const inputField = document.getElementById('chat-input');
  if (inputField) {
    inputField.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
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

  // Add the user's new message to the conversation
  conversationHistory.push({
    role: 'user',
    content: userMessage
  });

  // Clear the input
  inputField.value = '';

  // Re-render so the user sees their message
  renderConversationUI();

  // Send the entire conversation to the endpoint for the next assistant reply
  sendChatMessageToLLM();
}

async function sendChatMessageToLLM() {
  try {
    // We'll reuse the same model param from the UI
    const selectedModel = document.getElementById('llm-model').value;

    // Convert the entire conversation array to JSON
    const conversationJSON = encodeURIComponent(JSON.stringify(conversationHistory));

    // Build the endpoint (same as your 'analyze-data' but with added ?history=)
    const url = `https://${serverDomain}/webhook/analyze-data?model=${selectedModel}&prompt=${conversationJSON}`;

    // We can still pass the aggregator results if needed:
    const analysisData = gatherResultsForAnalysis();

    // POST the aggregator data as before, but rely on `history` to pass conversation
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(analysisData)
    });
    const result = await response.json();

    let assistantReply = '';
    if (Array.isArray(result) && result.length > 0 && result[0].text) {
      assistantReply = result[0].text;
    } else {
      assistantReply = JSON.stringify(result);
    }

    // Add the new assistant reply to the conversation
    conversationHistory.push({
      role: 'assistant',
      content: assistantReply
        .replaceAll("```html", '')
        .replaceAll("```", '')
    });

    // Re-render the chat
    renderConversationUI();
  } catch (err) {
    console.error('sendChatMessageToLLM error:', err);
  }
}


/***************************************************
 * The main handleSearch
 ***************************************************/
async function handleSearch() {
  // Reset the stop search flag
  stopSearchRequested = false;
  
  // Ensure that final analysis can happen again for each fresh search
  analysisAlreadyCalled = false;
  conversationHistory = [];

  // 1) Get part number
  const partNumberInput = document.getElementById('part-numbers');
  if (!partNumberInput) {
    alert('part number input not found');
    return;
  }
  const partNumber = partNumberInput.value.trim();
  if (!partNumber) {
    alert('Please enter a part number');
    return;
  }

  // 2) Clear summary
  const summaryDiv = document.getElementById('summary-content');
  if (summaryDiv) summaryDiv.innerHTML = '';
  
  // Clear analysis tab
  const analysisDiv = document.getElementById('analysis-content');
  if (analysisDiv) {
    const analyzeResultTextDiv = analysisDiv.querySelector('.analyze-result-text');
    if (analyzeResultTextDiv) analyzeResultTextDiv.textContent = '';
    const chatContainer = document.getElementById('chat-container-analysis');
    if (chatContainer) chatContainer.innerHTML = '';
  }

  // 3) Reset aggregator and counters
  Object.keys(searchResults).forEach(k => {
    searchResults[k] = [];
  });
  activeRequestsCount = 0;
  expansionsInProgress = false;  // Will set to 'true' if we do expansions

  // 4) Show spinner
  const spinner = document.getElementById('loading-spinner');
  const stopBtn = document.getElementById('stop-search-btn');
  if (spinner) spinner.style.display = 'inline-block';
  if (stopBtn) stopBtn.style.display = 'inline-block';

  // We'll store discovered alternative parts
  const finalAlternatives = [];

  // For partial UI updates
  let topDescription = '';
  let topCategory = '';
  let topOriginal = partNumber;

  // Helper that re-renders <div id="alternative-numbers"> 
  function updateAlternativeNumbersUI() {
    const altDiv = document.getElementById('alternative-numbers');
    if (!altDiv) return;

    let html = `
      <p><strong>Description:</strong> ${topDescription}</p>
      <p><strong>Category:</strong> ${topCategory}</p>
    `;
    if (finalAlternatives.length > 0) {
      html += `
        <h4>Alternative Part Numbers Found (up to level ${configNestedLevel === -1 ? '∞' : configNestedLevel}):</h4>
        <ul class="alternative-numbers-list">
          ${finalAlternatives.map(a => `
            <li class="alternative-number"><span>${a.type}: ${a.value}</span></li>
          `).join('')}
        </ul>
      `;
    } else {
      html += `<p>No alternative part numbers found.</p>`;
    }
    altDiv.innerHTML = html;
    altDiv.classList.add('active');
  }

  // Tracks which alt part numbers we've already "searched"
  const alreadySearched = new Set();

  // Callback for newly discovered alt parts.  
  async function onNewAlts(newlyAdded) {
    // Check if search should be stopped
    if (stopSearchRequested) return;
    
    // 1) Update the alt UI
    updateAlternativeNumbersUI();

    // 2) For each new alt, if not searched yet, do so
    const freshParts = [];
    for (const alt of newlyAdded) {
      const altUpper = alt.value.trim().toUpperCase();
      if (!alreadySearched.has(altUpper)) {
        alreadySearched.add(altUpper);
        freshParts.push({ number: alt.value, source: `${alt.type}: ${alt.value}` });
      }
    }
    if (freshParts.length > 0) {
      // Launch endpoint searches for these new parts
      await executeEndpointSearches(freshParts);
    }
  }

  try {
    // 1) Fetch top-level data (to get Description/Category, etc.)
    const topData = await getAlternativePartNumbers(partNumber);
    topOriginal = topData.original;
    topDescription = topData.description;
    topCategory = topData.category;

    // 2) If we want alternative expansions, start them in parallel
    if (configUseAlternatives) {
      // Kick off expansions in the background (no await)
      startExpansions(topOriginal, finalAlternatives, onNewAlts);
    } else {
      // If alt is disabled, just mention it in the UI
      const altDiv = document.getElementById('alternative-numbers');
      if (altDiv) {
        altDiv.innerHTML = '<p>Alternative search is disabled.</p>';
        altDiv.classList.add('active');
      }
    }

    // 3) Immediately search the user's original part
    alreadySearched.add(topOriginal.trim().toUpperCase());
    // We do NOT wait for expansions to finish
    await executeEndpointSearches([{ number: topOriginal, source: topOriginal }]);

    // 4) Possibly do a final check if expansions might be done immediately
    checkIfAllDone();

  } catch (err) {
    console.error('handleSearch error:', err);
  }
}


/***************************************************
 * A helper to do parallel endpoint searches for a 
 * given array of {number, source}
 ***************************************************/
async function executeEndpointSearches(partNumbers) {
  if (!partNumbers || partNumbers.length === 0 || stopSearchRequested) return;

  const tasks = [];

  if (document.getElementById('toggle-inventory').checked) {
    tasks.push(fetchInventoryData(partNumbers).finally(() => updateSummaryTab()));
  }
  if (document.getElementById('toggle-brokerbin').checked) {
    tasks.push(fetchBrokerBinData(partNumbers).finally(() => updateSummaryTab()));
  }
  if (document.getElementById('toggle-tdsynnex').checked) {
    tasks.push(fetchTDSynnexData(partNumbers).finally(() => updateSummaryTab()));
  }
  if (document.getElementById('toggle-ingram').checked) {
    tasks.push(fetchDistributorData(partNumbers).finally(() => updateSummaryTab()));
  }
  if (document.getElementById('toggle-amazon-connector').checked) {
    tasks.push(fetchAmazonConnectorData(partNumbers).finally(() => updateSummaryTab()));
  }
  if (document.getElementById('toggle-ebay-connector').checked) {
    tasks.push(fetchEbayConnectorData(partNumbers).finally(() => updateSummaryTab()));
  }
  if (document.getElementById('toggle-amazon').checked) {
    tasks.push(fetchAmazonData(partNumbers).finally(() => updateSummaryTab()));
  }
  if (document.getElementById('toggle-ebay').checked) {
    tasks.push(fetchEbayData(partNumbers).finally(() => updateSummaryTab()));
  }

  // Sales and Purchases
  tasks.push(fetchSalesData(partNumbers).finally(() => updateSummaryTab()));
  tasks.push(fetchPurchasesData(partNumbers).finally(() => updateSummaryTab()));

  // We do not always put Lenovo in here, but let's add it too if needed:
  if (document.getElementById('toggle-lenovo').checked) {
    // We'll call it once after the others
    // or you can put it directly in the tasks
    tasks.push(fetchLenovoData(partNumbers));
  }

  await Promise.all(tasks);
}

/***************************************************
 * Now define each fetch function, aggregator style
 * then rebuild the entire table from aggregator
 ***************************************************/

// 1) TDSynnex
async function fetchTDSynnexData(partNumbers) {
  if (stopSearchRequested) return;
  activeRequestsCount++;
  const loading = document.querySelector('.tdsynnex-results .loading');
  if (loading) loading.style.display = 'block';

  try {
    const newItems = [];
    for (const { number, source } of partNumbers) {
      if (stopSearchRequested) break;
      try {
        const res = await fetch(`https://${serverDomain}/webhook/tdsynnex-search?item=${encodeURIComponent(number)}`);
        if (!res.ok) continue;
        const xmlText = await res.text();
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
              city: warehouse.querySelector('warehouseInfo city')?.textContent,
              qty: warehouse.querySelector('qty')?.textContent
            }))
        };
        newItems.push(result);
      } catch (err) {
        console.warn('TDSynnex fetch error for', number, err);
      }
    }
    // aggregator
    searchResults.tdsynnex.push(...newItems);
    buildTDSynnexTable();
  } catch (err) {
    console.error('fetchTDSynnexData error:', err);
  } finally {
    if (loading) loading.style.display = 'none';
    activeRequestsCount--;
    checkIfAllDone();
  }
}

function buildTDSynnexTable() {
  const resultsDiv = document.querySelector('.tdsynnex-results .results-container');
  if (!resultsDiv) return;
  resultsDiv.innerHTML = '';

  const allItems = searchResults.tdsynnex;
  if (allItems.length === 0) return;

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
      ${allItems.map(item => `
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
  const container = document.createElement('div');
  container.className = 'table-container';
  container.appendChild(table);
  resultsDiv.appendChild(container);

  makeTableSortable(table);
}

// 2) Ingram
async function fetchDistributorData(partNumbers) {
  if (stopSearchRequested) return;
  activeRequestsCount++;
  const loading = document.querySelector('#distributors-content .loading');
  const resultsDiv = document.querySelector('#distributors-content .ingram-results .results-container');
  if (loading) loading.style.display = 'block';

  try {
    const newItems = [];
    for (const { number, source } of partNumbers) {
      if (stopSearchRequested) break;
      try {
        const res = await fetch(`https://${serverDomain}/webhook/ingram-search?item=${encodeURIComponent(number)}`);
        if (!res.ok) continue;
        const data = await res.json();
        const resultsWithSource = data.map(obj => ({ ...obj, sourcePartNumber: source }));
        newItems.push(...resultsWithSource);
      } catch (err) {
        console.warn('Ingram error for', number, err);
      }
    }
    searchResults.ingram.push(...newItems);
    buildIngramTable();
  } catch (err) {
    console.error('fetchDistributorData error:', err);
    if (resultsDiv) {
      resultsDiv.innerHTML = `<div class="error">Error: ${err.message}</div>`;
    }
  } finally {
    if (loading) loading.style.display = 'none';
    activeRequestsCount--;
    checkIfAllDone();
  }
}

function buildIngramTable() {
  const resultsDiv = document.querySelector('#distributors-content .ingram-results .results-container');
  if (!resultsDiv) return;
  resultsDiv.innerHTML = '';

  const items = searchResults.ingram;
  if (items.length === 0) return;

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
          </td>
        </tr>
      `).join('')}
    </tbody>
  `;
  const container = document.createElement('div');
  container.className = 'table-container';
  container.appendChild(table);
  resultsDiv.appendChild(container);

  makeTableSortable(table);
}

// 3) BrokerBin
async function fetchBrokerBinData(partNumbers) {
  if (stopSearchRequested) return;
  activeRequestsCount++;
  const loading = document.querySelector('.brokerbin-results .loading');
  const resultsDiv = document.querySelector('.brokerbin-results .results-container');
  if (loading) loading.style.display = 'block';

  try {
    const newItems = [];
    for (const { number, source } of partNumbers) {
      if (stopSearchRequested) break;
      try {
        const res = await fetch(`https://${serverDomain}/webhook/brokerbin-search?item=${encodeURIComponent(number)}`);
        if (!res.ok) continue;
        const data = await res.json();
        const withSrc = data.map(obj => ({ ...obj, sourcePartNumber: source }));
        newItems.push(...withSrc);
      } catch (err) {
        console.warn('BrokerBin error for', number, err);
      }
    }
    searchResults.brokerbin.push(...newItems);
    buildBrokerBinTable();
  } catch (error) {
    console.error('fetchBrokerBinData error:', error);
    if (resultsDiv) {
      resultsDiv.innerHTML = `<div class="error">Error: ${error.message}</div>`;
    }
  } finally {
    if (loading) loading.style.display = 'none';
    activeRequestsCount--;
    checkIfAllDone();
  }
}

function buildBrokerBinTable() {
  const resultsDiv = document.querySelector('.brokerbin-results .results-container');
  if (!resultsDiv) return;
  resultsDiv.innerHTML = '';

  const items = searchResults.brokerbin;
  if (items.length === 0) return;

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
  const container = document.createElement('div');
  container.className = 'table-container';
  container.appendChild(table);
  resultsDiv.appendChild(container);

  makeTableSortable(table);
}

// 4) Epicor Inventory
async function fetchInventoryData(partNumbers) {
  if (stopSearchRequested) return;
  activeRequestsCount++;
  const loading = document.querySelector('#inventory-content .loading');
  const resultsDiv = document.querySelector('#inventory-content .inventory-results');
  if (loading) loading.style.display = 'block';

  try {
    const newItems = [];
    for (const { number, source } of partNumbers) {
      if (stopSearchRequested) break;
      try {
        const res = await fetch(`https://${serverDomain}/webhook/epicor-search?item=${encodeURIComponent(number)}`);
        if (!res.ok) continue;
        const data = await res.json();
        const withSrc = data.map(obj => ({ ...obj, sourcePartNumber: source }));
        newItems.push(...withSrc);
      } catch (err) {
        console.warn('Epicor inventory error for', number, err);
      }
    }
    searchResults.epicor.push(...newItems);
    buildEpicorInventoryTable();
  } catch (err) {
    console.error('fetchInventoryData error:', err);
    if (resultsDiv) {
      resultsDiv.innerHTML = `<div class="error">Error: ${err.message}</div>`;
    }
  } finally {
    if (loading) loading.style.display = 'none';
    activeRequestsCount--;
    checkIfAllDone();
  }
}

// Epicor Search
function buildEpicorInventoryTable() {
  const resultsDiv = document.querySelector('#inventory-content .inventory-results');
  if (!resultsDiv) return;
  resultsDiv.innerHTML = '';

  // Filter out items where Company or PartNum are empty
  const allItems = searchResults.epicor;
  const filteredItems = allItems.filter(it =>
    it.Company && it.Company.trim() !== '' &&
    it.PartNum && it.PartNum.trim() !== ''
  );

  if (filteredItems.length === 0) return;

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
          <td>${(it.BasePrice !== undefined && it.BasePrice !== null) ? it.BasePrice : '-'}</td>
          <td>${it.InActive ? '<span class="text-error">Inactive</span>' : '<span class="text-success">Active</span>'}</td>
        </tr>
      `).join('')}
    </tbody>
  `;
  const container = document.createElement('div');
  container.className = 'table-container';
  container.appendChild(table);
  resultsDiv.appendChild(container);

  makeTableSortable(table);
}

// 5) Sales
async function fetchSalesData(partNumbers) {
  if (stopSearchRequested) return;
  activeRequestsCount++;
  const loading = document.querySelector('#sales-content .loading');
  const resultsDiv = document.querySelector('#sales-content .sales-results');
  if (loading) loading.style.display = 'block';

  try {
    const newItems = [];
    for (const { number, source } of partNumbers) {
      if (stopSearchRequested) break;
      try {
        const res = await fetch(`https://${serverDomain}/webhook/epicor-sales?item=${encodeURIComponent(number)}`);
        if (!res.ok) continue;
        const data = await res.json();

        // Only record lines that appear in OrderDtlPA
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
              OrderDate: line.OrderHedOrderDate,
              OrderQty: line.OrderQty,
              UnitPrice: line.UnitPrice,
              RequestDate: line.RequestDate,
              NeedByDate: line.NeedByDate
            });
          });
        });
      } catch (err) {
        console.warn('Sales fetch error for', number, err);
      }
    }

    searchResults.sales.push(...newItems);
    buildSalesTable();
  } catch (err) {
    console.error('fetchSalesData error:', err);
    if (resultsDiv) {
      resultsDiv.innerHTML = `<div class="error">Error: ${err.message}</div>`;
    }
  } finally {
    if (loading) loading.style.display = 'none';
    activeRequestsCount--;
    checkIfAllDone();
  }
}

function buildSalesTable() {
  const resultsDiv = document.querySelector('#sales-content .sales-results');
  if (!resultsDiv) return;
  resultsDiv.innerHTML = '';

  const items = searchResults.sales;
  if (items.length === 0) return;

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
      ${items.map(it => `
        <tr>
          <td>${it.sourcePartNumber}</td>
          <td>${it.PartNum || '-'}</td>
          <td>${it.LineDesc || '-'}</td>
          <td>${it.OrderNum || '-'}</td>
          <td>${it.OrderLine || '-'}</td>
          <td>${it.CustomerID || '-'}</td>
          <td>${it.CustomerName || '-'}</td>
          <td>${it.OrderDate ? new Date(it.OrderDate).toLocaleDateString() : '-'}</td>
          <td>${it.OrderQty || '-'}</td>
          <td>${it.UnitPrice || '-'}</td>
          <td>${it.RequestDate ? new Date(it.RequestDate).toLocaleDateString() : '-'}</td>
          <td>${it.NeedByDate ? new Date(it.NeedByDate).toLocaleDateString() : '-'}</td>
        </tr>
      `).join('')}
    </tbody>
  `;
  const container = document.createElement('div');
  container.className = 'table-container';
  container.appendChild(table);
  resultsDiv.appendChild(container);

  makeTableSortable(table);
}

// 6) Purchases
async function fetchPurchasesData(partNumbers) {
  if (stopSearchRequested) return;
  activeRequestsCount++;
  const loading = document.querySelector('#purchases-content .loading');
  const resultsDiv = document.querySelector('#purchases-content .purchases-results');
  if (loading) loading.style.display = 'block';

  try {
    const newItems = [];
    for (const { number, source } of partNumbers) {
      if (stopSearchRequested) break;
      try {
        const res = await fetch(`https://${serverDomain}/webhook/epicor-purchases?item=${encodeURIComponent(number)}`);
        if (!res.ok) continue;
        const data = await res.json();

        data.forEach(entry => {
          // Only record lines that appear in PAPurchasedBefore
          const purchasedItems = entry?.returnObj?.PAPurchasedBefore || [];
          if (purchasedItems.length > 0) {
            purchasedItems.forEach(line => {
              newItems.push({
                sourcePartNumber: source,
                PartNum: line.PartNum,
                VendorName: line.VendorName,
                VendorQty: line.VendorQty,
                VendorUnitCost: line.VendorUnitCost,
                PONum: line.PONum,
                ReceiptDate: line.ReceiptDate,
                OrderDate: line.OrderDate,
                DueDate: line.DueDate,
                // Extra fields for clarity
                IsAdvisor: false,
                PartDescription: line.PartDescription || '',
                PurchasedBefore: true
              });
            });
          }
          // (Removed fallback: do not add PurchaseAdvisor lines if PAPurchasedBefore is empty)
        });
      } catch (err) {
        console.warn('Purchases fetch error for', number, err);
      }
    }

    // Merge into the global aggregator
    searchResults.purchases.push(...newItems);

    // Build the table
    buildPurchasesTable();

  } catch (err) {
    console.error('fetchPurchasesData error:', err);
    if (resultsDiv) {
      resultsDiv.innerHTML = `<div class="error">Error: ${err.message}</div>`;
    }
  } finally {
    if (loading) loading.style.display = 'none';
    activeRequestsCount--;
    checkIfAllDone();
  }
}


// index.js

function buildPurchasesTable() {
  const resultsDiv = document.querySelector('#purchases-content .purchases-results');
  if (!resultsDiv) return;
  resultsDiv.innerHTML = '';

  // First, filter out items that have no meaningful part number (empty or missing)
  const allItems = searchResults.purchases;
  const filteredItems = allItems.filter(it =>
    it.PartNum && it.PartNum.trim() !== ''
  );

  if (filteredItems.length === 0) return;

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
      ${filteredItems.map(it => `
        <tr>
          <td>${it.sourcePartNumber}</td>
          <td>${it.PartNum || '-'}</td>
          <td>${it.VendorName || '-'}</td>
          <td>${it.VendorQty || '-'}</td>
          <td>${it.VendorUnitCost != null ? it.VendorUnitCost : '-'}</td>
          <td>${it.PONum || '-'}</td>
          <td>${it.ReceiptDate ? new Date(it.ReceiptDate).toLocaleDateString() : '-'}</td>
          <td>${it.OrderDate ? new Date(it.OrderDate).toLocaleDateString() : '-'}</td>
          <td>${it.DueDate ? new Date(it.DueDate).toLocaleDateString() : '-'}</td>
          <td>${it.IsAdvisor ? 'Yes' : 'No'}</td>
          <td>${it.PartDescription || '-'}</td>
          <td>${typeof it.PurchasedBefore === 'boolean' ? (it.PurchasedBefore ? 'Yes' : 'No') : '-'}</td>
        </tr>
      `).join('')}
    </tbody>
  `;
  
  const container = document.createElement('div');
  container.className = 'table-container';
  container.appendChild(table);
  resultsDiv.appendChild(container);

  makeTableSortable(table);
}


// 7) AmazonConnector
async function fetchAmazonConnectorData(partNumbers) {
  if (stopSearchRequested) return;
  if (!document.getElementById('toggle-amazon-connector').checked) return;
  activeRequestsCount++;
  const loading = document.querySelector('.amazon-connector-results .loading');
  const resultsDiv = document.querySelector('.amazon-connector-results .results-container');
  if (loading) loading.style.display = 'block';

  try {
    const newItems = [];
    for (const { number, source } of partNumbers) {
      if (stopSearchRequested) break;
      try {
        const resp = await fetch(`https://${serverDomain}/webhook/amazon-search?item=${encodeURIComponent(number)}`);
        if (!resp.ok) continue;
        const data = await resp.json();
        data.forEach(obj => newItems.push({ ...obj, sourcePartNumber: source }));
      } catch (err) {
        console.warn('AmazonConnector error', err);
      }
    }
    searchResults.amazonConnector.push(...newItems);
    buildAmazonConnectorTable();
  } catch (err) {
    console.error('fetchAmazonConnectorData error:', err);
    if (resultsDiv) {
      resultsDiv.innerHTML = `<div class="error">Error: ${err.message}</div>`;
    }
  } finally {
    if (loading) loading.style.display = 'none';
    activeRequestsCount--;
    checkIfAllDone();
  }
}

function buildAmazonConnectorTable() {
  const resultsDiv = document.querySelector('.amazon-connector-results .results-container');
  if (!resultsDiv) return;
  resultsDiv.innerHTML = '';

  const items = searchResults.amazonConnector;
  if (items.length === 0) return;

  const table = document.createElement('table');
  table.innerHTML = `
    <thead>
      <tr>
        <th>Source Part</th>
        <th>Image</th>
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
            <img src="${it.thumbnailImage || '-'}" alt="${it.title || ''}" class="product-image">
          </td>
          <td><a href="${it.url}" target="_blank">${it.title || '-'}</a></td>
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
  const container = document.createElement('div');
  container.className = 'table-container';
  container.appendChild(table);
  resultsDiv.appendChild(container);

  makeTableSortable(table);
}

// 8) eBayConnector
async function fetchEbayConnectorData(partNumbers) {
  if (stopSearchRequested) return;
  if (!document.getElementById('toggle-ebay-connector').checked) return;
  activeRequestsCount++;
  const loading = document.querySelector('.ebay-connector-results .loading');
  const resultsDiv = document.querySelector('.ebay-connector-results .results-container');
  if (loading) loading.style.display = 'block';

  try {
    const newItems = [];
    for (const { number, source } of partNumbers) {
      if (stopSearchRequested) break;
      try {
        const resp = await fetch(`https://${serverDomain}/webhook/ebay-search?item=${encodeURIComponent(number)}`);
        if (!resp.ok) continue;
        const data = await resp.json();
        data.forEach(obj => newItems.push({ ...obj, sourcePartNumber: source }));
      } catch (err) {
        console.warn('eBayConnector error', err);
      }
    }
    searchResults.ebayConnector.push(...newItems);
    buildEbayConnectorTable();
  } catch (err) {
    console.error('fetchEbayConnectorData error:', err);
    if (resultsDiv) {
      resultsDiv.innerHTML = `<div class="error">Error: ${err.message}</div>`;
    }
  } finally {
    if (loading) loading.style.display = 'none';
    activeRequestsCount--;
    checkIfAllDone();
  }
}

function buildEbayConnectorTable() {
  const resultsDiv = document.querySelector('.ebay-connector-results .results-container');
  if (!resultsDiv) return;
  resultsDiv.innerHTML = '';

  const items = searchResults.ebayConnector;
  if (items.length === 0) return;

  const table = document.createElement('table');
  table.innerHTML = `
    <thead>
      <tr>
        <th>Source Part</th>
        <th>Image</th>
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
              ? `<img src="${it.images[0]}" alt="${it.title}" class="product-image">` 
              : '-'}
          </td>
          <td><a href="${it.url}" target="_blank">${it.title}</a></td>
          <td>${it.priceWithCurrency || '-'}</td>
          <td>${it.condition || '-'}</td>
          <td><a href="${it.sellerUrl}" target="_blank">${it.sellerName}</a></td>
          <td>${it.itemLocation || '-'}</td>
          <td>${it.shipping || '-'}</td>
        </tr>
      `).join('')}
    </tbody>
  `;
  const container = document.createElement('div');
  container.className = 'table-container';
  container.appendChild(table);
  resultsDiv.appendChild(container);

  makeTableSortable(table);
}

// 9) AmazonScraper
async function fetchAmazonData(partNumbers) {
  if (stopSearchRequested) return;
  if (!document.getElementById('toggle-amazon').checked) return;
  activeRequestsCount++;
  const loading = document.querySelector('.amazon-results .loading');
  const resultsDiv = document.querySelector('.amazon-results .results-container');
  if (loading) loading.style.display = 'block';

  try {
    const newItems = [];
    for (const { number, source } of partNumbers) {
      if (stopSearchRequested) break;
      try {
        const resp = await fetch(`https://${serverDomain}/webhook/amazon-scraper?item=${encodeURIComponent(number)}`);
        if (!resp.ok) continue;
        const data = await resp.json();
        if (Array.isArray(data) && data.length > 0) {
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
        }
      } catch (err) {
        console.warn('AmazonScraper error', err);
      }
    }
    searchResults.amazon.push(...newItems);
    buildAmazonScraperTable();
  } catch (err) {
    console.error('fetchAmazonData error:', err);
    if (resultsDiv) {
      resultsDiv.innerHTML = `<div class="error">Error: ${err.message}</div>`;
    }
  } finally {
    if (loading) loading.style.display = 'none';
    activeRequestsCount--;
    checkIfAllDone();
  }
}

function buildAmazonScraperTable() {
  const resultsDiv = document.querySelector('.amazon-results .results-container');
  if (!resultsDiv) return;
  resultsDiv.innerHTML = '';

  const items = searchResults.amazon;
  if (items.length === 0) return;

  const table = document.createElement('table');
  table.innerHTML = `
    <thead>
      <tr>
        <th>Source Part</th>
        <th>Image</th>
        <th>Description</th>
        <th>Price</th>
      </tr>
    </thead>
    <tbody>
      ${items.map(it => `
        <tr>
          <td>${it.sourcePartNumber}</td>
          <td class="image-cell">
            ${it.image ? `<img src="${it.image}" alt="Product image" class="product-image">` : '-'}
          </td>
          <td>
            ${it.link && it.link !== '#' 
              ? `<a href="${it.link}" target="_blank">${it.title}</a>` 
              : it.title}
          </td>
          <td>${it.rawPrice}</td>
        </tr>
      `).join('')}
    </tbody>
  `;
  const container = document.createElement('div');
  container.className = 'table-container';
  container.appendChild(table);
  resultsDiv.appendChild(container);

  makeTableSortable(table);
}

// 10) eBayScraper
async function fetchEbayData(partNumbers) {
  if (stopSearchRequested) return;
  if (!document.getElementById('toggle-ebay').checked) return;
  activeRequestsCount++;
  const loading = document.querySelector('.ebay-results .loading');
  const resultsDiv = document.querySelector('.ebay-results .results-container');
  if (loading) loading.style.display = 'block';

  try {
    const newItems = [];
    for (const { number, source } of partNumbers) {
      if (stopSearchRequested) break;
      try {
        const resp = await fetch(`https://${serverDomain}/webhook/ebay-scraper?item=${encodeURIComponent(number)}`);
        if (!resp.ok) continue;
        const data = await resp.json();
        if (Array.isArray(data) && data.length > 0) {
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
        }
      } catch (err) {
        console.warn('ebayScraper error', err);
      }
    }
    searchResults.ebay.push(...newItems);
    buildEbayScraperTable();
  } catch (err) {
    console.error('fetchEbayData error:', err);
    if (resultsDiv) {
      resultsDiv.innerHTML = `<div class="error">Error: ${err.message}</div>`;
    }
  } finally {
    if (loading) loading.style.display = 'none';
    activeRequestsCount--;
    checkIfAllDone();
  }
}

function buildEbayScraperTable() {
  const resultsDiv = document.querySelector('.ebay-results .results-container');
  if (!resultsDiv) return;
  resultsDiv.innerHTML = '';

  const items = searchResults.ebay;
  if (items.length === 0) return;

  const table = document.createElement('table');
  table.innerHTML = `
    <thead>
      <tr>
        <th>Source Part</th>
        <th>Image</th>
        <th>Description</th>
        <th>Price</th>
      </tr>
    </thead>
    <tbody>
      ${items.map(it => `
        <tr>
          <td>${it.sourcePartNumber}</td>
          <td class="image-cell">
            ${it.image ? `<img src="${it.image}" alt="Product image" class="product-image">` : '-'}
          </td>
          <td>
            ${it.link && it.link !== '#' 
              ? `<a href="${it.link}" target="_blank">${it.title}</a>` 
              : it.title}
          </td>
          <td>${it.rawPrice}</td>
        </tr>
      `).join('')}
    </tbody>
  `;
  const container = document.createElement('div');
  container.className = 'table-container';
  container.appendChild(table);
  resultsDiv.appendChild(container);

  makeTableSortable(table);
}

/**
 * Build or update the Lenovo UI from all data in searchResults.lenovo
 */
function buildLenovoUI() {
  const lenovoContentDiv = document.getElementById('lenovo-content');
  if (!lenovoContentDiv) return;

  let subtabs = document.getElementById('lenovo-subtabs');
  let subcontent = document.getElementById('lenovo-subcontent');

  // If these elements don't exist, create them
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

  // Clear existing UI
  subtabs.innerHTML = '';
  subcontent.innerHTML = '';

  // If we have no accumulated results, show a message
  const allResults = searchResults.lenovo;
  if (!allResults || allResults.length === 0) {
    subtabs.innerHTML = '<div class="error">No Lenovo data found</div>';
    return;
  }

  // Build UI for each doc
  allResults.forEach((doc, index) => {
    // Each doc gets a subtab button
    const subtabButton = document.createElement('button');
    subtabButton.className = `subtab-button ${index === 0 ? 'active' : ''}`;
    const title = doc.title || 'Untitled Document';
    const cleanTitle = typeof title === 'string'
      ? title.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim()
      : 'Untitled Document';

    subtabButton.textContent = `${doc.sourcePartNumber} - ${cleanTitle}`;
    subtabButton.title = cleanTitle;
    subtabButton.onclick = () => switchLenovoSubtab(index);
    subtabs.appendChild(subtabButton);

    // Build content area
    const contentDiv = document.createElement('div');
    contentDiv.className = `subtab-content ${index === 0 ? 'active' : ''}`;
    contentDiv.setAttribute('data-subtab-index', index);

    let processedContent = decodeUnicodeEscapes(doc.content);
    if (!processedContent.trim().toLowerCase().startsWith('<table')) {
      processedContent = `<table class="lenovo-data-table">${processedContent}</table>`;
    }
    contentDiv.innerHTML = processedContent;
    subcontent.appendChild(contentDiv);
  });
}

/**
 * Modified fetchLenovoData to accumulate results into searchResults.lenovo
 * and then buildLenovoUI from that aggregator. Even if new calls return empty,
 * existing data remains displayed.
 */
async function fetchLenovoData(partNumbers) {
  if (stopSearchRequested) return;
  if (!document.getElementById('toggle-lenovo').checked) return;
  activeRequestsCount++;

  try {
    for (const { number, source } of partNumbers) {
      if (stopSearchRequested) break;
      try {
        const response = await fetch(`https://${serverDomain}/webhook/lenovo-scraper?item=${encodeURIComponent(number)}`);
        if (!response.ok) continue;
        const data = await response.json();
        if (data?.[0]?.data?.length > 0) {
          // Filter out empty content docs
          const docs = data[0].data
            .filter(doc => doc && doc.content && doc.content.trim() !== '')
            .map(doc => ({ ...doc, sourcePartNumber: source }));
          // Append these results to our global aggregator
          searchResults.lenovo.push(...docs);
        }
      } catch (error) {
        console.warn(`Lenovo error for ${number}:`, error);
      }
    }

    // Now build the UI from the entire aggregator
    buildLenovoUI();

  } catch (err) {
    console.error('Lenovo data fetch error:', err);
    // If there's absolutely no data after the error,
    // we can show an error message. Otherwise, keep what we have.
    if (!searchResults.lenovo.length) {
      const subtabs = document.getElementById('lenovo-subtabs');
      if (subtabs) {
        subtabs.innerHTML = `<div class="error">Error fetching Lenovo data: ${err.message}</div>`;
      }
    }
  } finally {
    activeRequestsCount--;
    checkIfAllDone();
  }
}

function switchLenovoSubtab(index) {
  document.querySelectorAll('.subtab-button').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.subtab-content').forEach(c => c.classList.remove('active'));
  document.querySelectorAll('.subtab-button')[index].classList.add('active');
  document.querySelector(`.subtab-content[data-subtab-index="${index}"]`).classList.add('active');
}

function decodeUnicodeEscapes(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/\\u[\dA-F]{4}/gi, match =>
    String.fromCharCode(parseInt(match.replace(/\\u/g, ''), 16))
  );
}

/***************************************************
 * Summary Tab
 ***************************************************/
function updateSummaryTab() {
  const summaryDiv = document.getElementById('summary-content');
  if (!summaryDiv) return;

  // Check if search was stopped
  const searchStopped = stopSearchRequested;
  
  // Look for existing stopped message
  const existingStoppedMsg = summaryDiv.querySelector('.search-stopped-message');
  if (searchStopped && !existingStoppedMsg) {
    const stoppedMessage = document.createElement('div');
    stoppedMessage.className = 'search-stopped-message';
    stoppedMessage.innerHTML = '<p><strong>Search was stopped by user.</strong> Partial results are displayed.</p>';
    stoppedMessage.style.padding = '10px';
    stoppedMessage.style.backgroundColor = '#ffecec';
    stoppedMessage.style.border = '1px solid #f5c6cb';
    stoppedMessage.style.borderRadius = '4px';
    stoppedMessage.style.marginBottom = '15px';
    summaryDiv.prepend(stoppedMessage);
  }

  // Replace content after the stopped message if it exists
  let summaryContent = '';

  // check toggles
  const anyEnabled = (
    document.getElementById('toggle-inventory').checked ||
    document.getElementById('toggle-brokerbin').checked ||
    document.getElementById('toggle-tdsynnex').checked ||
    document.getElementById('toggle-ingram').checked ||
    document.getElementById('toggle-amazon-connector').checked ||
    document.getElementById('toggle-ebay-connector').checked ||
    document.getElementById('toggle-amazon').checked ||
    document.getElementById('toggle-ebay').checked
  );
  if (!anyEnabled) {
    summaryContent = 'No search results yet.';
  } else {
    summaryContent = generateSummaryTableHtml();
  }

  // If there's a stopped message, keep it and replace the rest
  if (existingStoppedMsg) {
    // Remove all other content
    Array.from(summaryDiv.childNodes).forEach(node => {
      if (node !== existingStoppedMsg) {
        summaryDiv.removeChild(node);
      }
    });
    // Add new content
    summaryDiv.innerHTML += summaryContent;
  } else {
    // Replace all content
    summaryDiv.innerHTML = summaryContent;
  }
}

// index.js

// Locate the portion where we generate the summary table 
// and add handling for 'epicor' (inventory) best price 
// by reading the BasePrice field:

function generateSummaryTableHtml() {
  function createSummaryTable(key, label) {
    const dataArray = searchResults[key] || [];
    if (!dataArray.length) return '';

    // group by sourcePartNumber
    const grouped = {};
    dataArray.forEach(item => {
      const pnum = item.sourcePartNumber || 'Unknown';
      if (!grouped[pnum]) grouped[pnum] = [];
      grouped[pnum].push(item);
    });

    function findBestPrice(items) {
      let minPrice = null;
      items.forEach(it => {
        let priceVal = null;
        switch (key) {
          case 'amazonConnector':
            if (it.price && it.price.value) priceVal = parseFloat(it.price.value);
            break;
          case 'ebayConnector':
            priceVal = parsePrice(it.priceWithCurrency);
            break;
          case 'amazon':
            priceVal = parsePrice(it.rawPrice);
            break;
          case 'ebay':
            priceVal = parsePrice(it.rawPrice);
            break;
          case 'brokerbin':
            if (typeof it.price === 'number') {
              priceVal = it.price;
            } else if (typeof it.price === 'string') {
              priceVal = parseFloat(it.price);
            }
            break;
          case 'tdsynnex':
            priceVal = parseFloat(it.price);
            break;
          case 'epicor':
            // For Epicor (inventory) we use the BasePrice field
            priceVal = parseFloat(it.BasePrice);
            break;
        }
        if (priceVal != null && !isNaN(priceVal) && priceVal > 0) {
          if (minPrice == null || priceVal < minPrice) {
            minPrice = priceVal;
          }
        }
      });
      return minPrice;
    }

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
      <h3>${label} Summary</h3>
      <table>
        <thead>
          <tr>
            <th>Part Number</th>
            <th>Items Found</th>
            <th>Best Price</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    `;
  }

  let summaryHTML = '';

  if (document.getElementById('toggle-inventory').checked) {
    summaryHTML += createSummaryTable('epicor', 'Epicor (Inventory)');
  }
  if (document.getElementById('toggle-brokerbin').checked) {
    summaryHTML += createSummaryTable('brokerbin', 'BrokerBin');
  }
  if (document.getElementById('toggle-tdsynnex').checked) {
    summaryHTML += createSummaryTable('tdsynnex', 'TDSynnex');
  }
  if (document.getElementById('toggle-ingram').checked) {
    summaryHTML += createSummaryTable('ingram', 'Ingram');
  }
  if (document.getElementById('toggle-amazon-connector').checked) {
    summaryHTML += createSummaryTable('amazonConnector', 'AmazonConnector');
  }
  if (document.getElementById('toggle-ebay-connector').checked) {
    summaryHTML += createSummaryTable('ebayConnector', 'eBayConnector');
  }
  if (document.getElementById('toggle-amazon').checked) {
    summaryHTML += createSummaryTable('amazon', 'Amazon');
  }
  if (document.getElementById('toggle-ebay').checked) {
    summaryHTML += createSummaryTable('ebay', 'eBay');
  }

  return summaryHTML.trim() || 'No search results yet.';
}


/***************************************************
 * Gathers final results for LLM analysis
 ***************************************************/
function gatherResultsForAnalysis() {
  const results = {};
  if (document.getElementById('toggle-inventory').checked) {
    const invElem = document.querySelector('#inventory-content .inventory-results');
    results['epicor-search'] = invElem ? invElem.innerHTML : "";
  }
  if (document.getElementById('toggle-brokerbin').checked) {
    const bbElem = document.querySelector('.brokerbin-results .results-container');
    results['brokerbin-search'] = bbElem ? bbElem.innerHTML : "";
  }
  if (document.getElementById('toggle-tdsynnex').checked) {
    const tdElem = document.querySelector('.tdsynnex-results .results-container');
    results['tdsynnex-search'] = tdElem ? tdElem.innerHTML : "";
  }
  if (document.getElementById('toggle-ingram').checked) {
    const ingElem = document.querySelector('.ingram-results .results-container');
    results['ingram-search'] = ingElem ? ingElem.innerHTML : "";
  }
  if (document.getElementById('toggle-amazon-connector').checked) {
    const acElem = document.querySelector('.amazon-connector-results .results-container');
    results['amazon-connector'] = acElem ? acElem.innerHTML : "";
  }
  if (document.getElementById('toggle-ebay-connector').checked) {
    const ecElem = document.querySelector('.ebay-connector-results .results-container');
    results['ebay-connector'] = ecElem ? ecElem.innerHTML : "";
  }
  if (document.getElementById('toggle-amazon').checked) {
    const amzScrElem = document.querySelector('.amazon-results .results-container');
    results['amazon-scraper'] = amzScrElem ? amzScrElem.innerHTML : "";
  }
  if (document.getElementById('toggle-ebay').checked) {
    const eScrElem = document.querySelector('.ebay-results .results-container');
    results['ebay-scraper'] = eScrElem ? eScrElem.innerHTML : "";
  }

  return results;
}

/***************************************************
 * Google / MS sign-in from original snippet
 ***************************************************/
document.getElementById('google-signin-btn').addEventListener('click', () => {
  google.accounts.id.initialize({
    client_id: 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com',
    callback: handleGoogleCredentialResponse
  });
  google.accounts.id.prompt();
});
function handleGoogleCredentialResponse(response) {
  console.log('Google Credential Response:', response);
  document.getElementById('user-info').textContent = 'Signed in with Google';
}

const msalConfig = {
  auth: {
    clientId: "YOUR_MICROSOFT_CLIENT_ID",
    redirectUri: window.location.origin
  }
};
const msalInstance = new msal.PublicClientApplication(msalConfig);
document.getElementById('microsoft-signin-btn').addEventListener('click', () => {
  msalInstance.loginPopup({ scopes: ["User.Read"] })
    .then(loginResponse => {
      console.log('Microsoft Login Response:', loginResponse);
      document.getElementById('user-info').textContent = 'Signed in as: ' + loginResponse.account.username;
    })
    .catch(error => {
      console.error('Microsoft Login Error:', error);
    });
});
