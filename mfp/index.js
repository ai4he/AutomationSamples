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

// Default nested level is now 0 (only direct alternatives)
let configNestedLevel = 0;

// This value can be overridden by the UI element with id "nested-level-selector"
// (0 = direct alternatives; 1 = one level deeper; -1 = infinite expansion)

// This variable is still used for logging purposes.
let initialAltLimit = 3;

// For this version we are not using pause/resume. The search will run to completion (or until stopped).
let limitedSearchMode = false;

// Counter for alternatives found (used only for logging)
let altCountFound = 0;

// We are no longer using a paused search state.

// Stores the entire conversation as an array of message objects:
let conversationHistory = [];

// Reference to the chat container
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

// Flag for whether alternative expansions are in progress
let expansionsInProgress = false;

/***************************************************
 * Stop Search Function
 ***************************************************/
function stopSearch() {
  stopSearchRequested = true;
  console.log("Search stopping requested");
  
  const spinner = document.getElementById('loading-spinner');
  const stopBtn = document.getElementById('stop-search-btn');
  if (spinner) spinner.style.display = 'none';
  if (stopBtn) stopBtn.style.display = 'none';
  
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
  
  updateSummaryTab();
}

/***************************************************
 * Clean UI for new search
 ***************************************************/
function cleanupUI() {
  const altDiv = document.getElementById('alternative-numbers');
  if (altDiv) altDiv.innerHTML = '';
  
  const summaryDiv = document.getElementById('summary-content');
  if (summaryDiv) summaryDiv.innerHTML = '';
  
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
  
  const lenovoSubtabs = document.getElementById('lenovo-subtabs');
  const lenovoSubcontent = document.getElementById('lenovo-subcontent');
  if (lenovoSubtabs) lenovoSubtabs.innerHTML = '';
  if (lenovoSubcontent) lenovoSubcontent.innerHTML = '';
  
  const analysisDiv = document.getElementById('analysis-content');
  if (analysisDiv) {
    const analyzeResultTextDiv = analysisDiv.querySelector('.analyze-result-text');
    if (analyzeResultTextDiv) analyzeResultTextDiv.innerHTML = '';
    const chatContainer = document.getElementById('chat-container-analysis');
    if (chatContainer) chatContainer.innerHTML = '';
  }
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
 * Helper: safely parse JSON response
 ***************************************************/
async function safeJsonParse(response) {
  const text = await response.text();
  if (!text) {
    return [];
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error('JSON parse error: ' + e.message);
  }
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
  
  const headerText = table.querySelector(`th:nth-child(${columnIndex + 1})`).textContent.trim().toLowerCase();
  const isDateColumn = headerText.includes('date') || headerText.includes('time');

  rows.sort((a, b) => {
    const aText = a.children[columnIndex].textContent.trim();
    const bText = b.children[columnIndex].textContent.trim();
    
    if (isDateColumn) {
      const aDate = new Date(aText);
      const bDate = new Date(bText);
      if (!isNaN(aDate.getTime()) && !isNaN(bDate.getTime())) {
        return asc ? aDate - bDate : bDate - aDate;
      }
    }

    const aNum = parseFloat(aText.replace(/[^0-9.-]/g, ""));
    const bNum = parseFloat(bText.replace(/[^0-9.-]/g, ""));
    if (!isNaN(aNum) && !isNaN(bNum)) {
      return asc ? aNum - bNum : bNum - aNum;
    }
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

/***************************************************
 * Alternative Expansions
 * (The recursion now runs to completion, unless stopped.)
 ***************************************************/
function startExpansions(baseNumber, finalAlts, onNewAlts) {
  altCountFound = 0;
  expansionsInProgress = true;
  const visited = new Set();

  gatherCombinatoryAlternatives(baseNumber, 0, visited, finalAlts, onNewAlts)
    .then(() => {
      expansionsInProgress = false;
      checkIfAllDone();
    })
    .catch(err => {
      console.error('Expansion error:', err);
      expansionsInProgress = false;
      checkIfAllDone();
    });
}

async function gatherCombinatoryAlternatives(baseNumber, currentLevel, visited, result, onNewAlts) {
  if (stopSearchRequested) {
    console.log("Stopping search - user requested stop");
    return;
  }
  
  const upperBase = baseNumber.trim().toUpperCase();
  if (visited.has(upperBase)) return;
  visited.add(upperBase);

  try {
    const { alternatives } = await getAlternativePartNumbers(baseNumber);
    let newlyAdded = [];
    
    for (const alt of alternatives) {
      const altUpper = alt.value.trim().toUpperCase();
      if (!result.some(r => r.value.trim().toUpperCase() === altUpper)) {
        result.push(alt);
        newlyAdded.push(alt);
        altCountFound++;
        console.log(`Found alternative #${altCountFound}: ${alt.type} - ${alt.value}`);
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
        if (stopSearchRequested) return;
        await gatherCombinatoryAlternatives(alt.value, currentLevel + 1, visited, result, onNewAlts);
      }
    }
  } catch (err) {
    console.error(`Error in gatherCombinatoryAlternatives for ${baseNumber}:`, err);
  }
}

/***************************************************
 * Spinner, Expansions, and Final Analysis
 ***************************************************/
function checkIfAllDone() {
  if (expansionsInProgress) return;
  if (activeRequestsCount > 0) return;
  if (analysisAlreadyCalled) return;

  analysisAlreadyCalled = true;

  const spinner = document.getElementById('loading-spinner');
  const stopBtn = document.getElementById('stop-search-btn');
  if (spinner) spinner.style.display = 'none';
  if (stopBtn) stopBtn.style.display = 'none';

  performFinalAnalysis();
}

async function performFinalAnalysis() {
  // Show progress indicator for analysis
  const analysisProgress = document.getElementById('analysis-progress');
  if (analysisProgress) {
    analysisProgress.style.display = 'block';
    analysisProgress.textContent = "Analysis in progress…";
  }

  updateSummaryTab();

  try {
    const analysisData = gatherResultsForAnalysis();
    const selectedModel = document.getElementById('llm-model').value;
    const promptText = document.getElementById('prompt').value;
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

    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(analyzeResultText, 'text/html');
      if (doc.body && doc.body.innerHTML) {
        analyzeResultText = doc.body.innerHTML;
      }
    } catch (e) {
      console.warn('Error parsing HTML content:', e);
    }

    conversationHistory.push({
      role: 'user',
      content: promptText || '(No prompt provided)'
    });
    conversationHistory.push({
      role: 'assistant',
      content: analyzeResultText
    });

    const analyzeResultTextDiv = document.querySelector('#analysis-content .analyze-result-text');
    if (analyzeResultTextDiv) {
      analyzeResultTextDiv.innerHTML = '';
    }

    initializeConversationUI();
  } catch (err) {
    console.error('Analyze data error:', err);
  } finally {
    if (analysisProgress) {
      analysisProgress.style.display = 'none';
    }
  }
}

function initializeConversationUI() {
  chatContainer = document.getElementById('chat-container-analysis');
  if (!chatContainer) {
    console.error('Chat container element not found in analysis tab');
    return;
  }
  renderConversationUI();
}

function renderConversationUI() {
  if (!chatContainer) return;

  let chatHTML = '<div class="chat-messages">';
  conversationHistory.forEach(msg => {
    if (msg.role === 'assistant') {
      chatHTML += `
        <div class="chat-message assistant">
          <strong>Assistant:</strong> ${msg.content}
        </div>
      `;
    } else {
      chatHTML += `
        <div class="chat-message user">
          <strong>You:</strong> ${msg.content}
        </div>
      `;
    }
  });
  chatHTML += '</div>';

  chatHTML += `
    <div class="chat-input-area" style="margin-top: 10px;">
      <input type="text" id="chat-input" placeholder="Type your question..." style="width:80%;">
      <button id="chat-send-btn" style="width:18%;">Send</button>
    </div>
  `;

  chatContainer.innerHTML = chatHTML;

  const messagesDiv = chatContainer.querySelector('.chat-messages');
  if (messagesDiv) {
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  }

  const sendBtn = document.getElementById('chat-send-btn');
  if (sendBtn) {
    sendBtn.addEventListener('click', handleUserChatSubmit);
  }

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

  conversationHistory.push({
    role: 'user',
    content: userMessage
  });

  inputField.value = '';
  renderConversationUI();
  sendChatMessageToLLM();
}

async function sendChatMessageToLLM() {
  try {
    const selectedModel = document.getElementById('llm-model').value;
    const conversationJSON = encodeURIComponent(JSON.stringify(conversationHistory));
    const url = `https://${serverDomain}/webhook/analyze-data?model=${selectedModel}&prompt=${conversationJSON}`;
    const analysisData = gatherResultsForAnalysis();

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

    conversationHistory.push({
      role: 'assistant',
      content: assistantReply
        .replaceAll("```html", '')
        .replaceAll("```", '')
    });

    renderConversationUI();
  } catch (err) {
    console.error('sendChatMessageToLLM error:', err);
  }
}

/***************************************************
 * The main handleSearch
 ***************************************************/
async function handleSearch() {
  const nestedLevelInput = document.getElementById('nested-level-selector');
  if (nestedLevelInput) {
    configNestedLevel = parseInt(nestedLevelInput.value, 10);
  } else {
    configNestedLevel = 0;
  }
  
  stopSearchRequested = false;
  limitedSearchMode = false;
  altCountFound = 0;
  
  analysisAlreadyCalled = false;
  conversationHistory = [];

  cleanupUI();
  switchTab('summary');
  
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

  Object.keys(searchResults).forEach(k => {
    searchResults[k] = [];
  });
  activeRequestsCount = 0;
  expansionsInProgress = false;

  const spinner = document.getElementById('loading-spinner');
  const stopBtn = document.getElementById('stop-search-btn');
  if (spinner) spinner.style.display = 'inline-block';
  if (stopBtn) stopBtn.style.display = 'inline-block';

  const finalAlternatives = [];

  let topDescription = '';
  let topCategory = '';
  let topOriginal = partNumber;

  function updateAlternativeNumbersUI() {
    const altDiv = document.getElementById('alternative-numbers');
    if (!altDiv) return;

    let html = `
      <p><strong>Description:</strong> ${topDescription}</p>
      <p><strong>Category:</strong> ${topCategory}</p>
    `;
    if (finalAlternatives.length > 0) {
      html += `
        <h4>Alternative Part Numbers Found:</h4>
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

  const alreadySearched = new Set();

  async function onNewAlts(newlyAdded) {
    if (stopSearchRequested) return;
    
    updateAlternativeNumbersUI();

    const freshParts = [];
    for (const alt of newlyAdded) {
      const altUpper = alt.value.trim().toUpperCase();
      if (!alreadySearched.has(altUpper)) {
        alreadySearched.add(altUpper);
        freshParts.push({ number: alt.value, source: `${alt.type}: ${alt.value}` });
      }
    }
    if (freshParts.length > 0) {
      await executeEndpointSearches(freshParts);
    }
  }

  try {
    const topData = await getAlternativePartNumbers(partNumber);
    topOriginal = topData.original;
    topDescription = topData.description;
    topCategory = topData.category;

    updateAlternativeNumbersUI();

    if (configUseAlternatives) {
      startExpansions(topOriginal, finalAlternatives, onNewAlts);
    } else {
      const altDiv = document.getElementById('alternative-numbers');
      if (altDiv) {
        altDiv.innerHTML = '<p>Alternative search is disabled.</p>';
        altDiv.classList.add('active');
      }
    }

    alreadySearched.add(topOriginal.trim().toUpperCase());
    await executeEndpointSearches([{ number: topOriginal, source: topOriginal }]);

    checkIfAllDone();

  } catch (err) {
    console.error('handleSearch error:', err);
  }
}

/***************************************************
 * A helper to do parallel endpoint searches for a given array of {number, source}
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

  tasks.push(fetchSalesData(partNumbers).finally(() => updateSummaryTab()));
  tasks.push(fetchPurchasesData(partNumbers).finally(() => updateSummaryTab()));

  if (document.getElementById('toggle-lenovo').checked) {
    tasks.push(fetchLenovoData(partNumbers));
  }

  await Promise.all(tasks);
}

/***************************************************
 * Now define each fetch function, aggregator style.
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
        console.log(`TDSynnex: Fetching data for ${number}`);
        const res = await fetch(`https://${serverDomain}/webhook/tdsynnex-search?item=${encodeURIComponent(number)}`);
        
        // If the request wasn't successful or returned an error status
        if (!res.ok) {
          console.warn(`TDSynnex: HTTP error ${res.status} for ${number}`);
          // Still record this part as "not found"
          newItems.push({
            sourcePartNumber: source,
            synnexSKU: '-',
            mfgPN: number,
            description: '-',
            status: "Not found",
            price: '-',
            totalQuantity: '0',
            upcCode: '-',
            warehouses: []
          });
          continue;
        }
        
        const xmlText = await res.text();
        const xmlDoc = parseXML(xmlText);
        const priceList = xmlDoc.getElementsByTagName('PriceAvailabilityList')[0];
        
        if (!priceList) {
          console.warn("TDSynnex: No PriceAvailabilityList found for", number);
          // Record this part as "not found"
          newItems.push({
            sourcePartNumber: source,
            synnexSKU: '-',
            mfgPN: number,
            description: '-',
            status: "Not found",
            price: '-',
            totalQuantity: '0',
            upcCode: '-',
            warehouses: []
          });
          continue;
        }

        // Get status from the XML
        const status = xmlDoc.querySelector('status')?.textContent || "Unknown";
        
        // If status is "Not found", still record this part
        if (status === "Not found") {
          newItems.push({
            sourcePartNumber: source,
            synnexSKU: xmlDoc.querySelector('synnexSKU')?.textContent || '-',
            mfgPN: xmlDoc.querySelector('mfgPN')?.textContent || number,
            description: '-',
            status: "Not found",
            price: '-',
            totalQuantity: '0',
            upcCode: '-',
            warehouses: []
          });
          continue;
        }

        // If we got here, the part was found and has data
        const result = {
          sourcePartNumber: source,
          synnexSKU: xmlDoc.querySelector('synnexSKU')?.textContent || '-',
          mfgPN: xmlDoc.querySelector('mfgPN')?.textContent || number,
          description: xmlDoc.querySelector('description')?.textContent || '-',
          status: status,
          price: xmlDoc.querySelector('price')?.textContent || '-',
          totalQuantity: xmlDoc.querySelector('totalQuantity')?.textContent || '0',
          upcCode: xmlDoc.querySelector('upcCode')?.textContent || '-',
          warehouses: Array.from(xmlDoc.getElementsByTagName('AvailabilityByWarehouse'))
            .map(warehouse => ({
              city: warehouse.querySelector('warehouseInfo city')?.textContent,
              qty: warehouse.querySelector('qty')?.textContent
            }))
        };
        
        newItems.push(result);
      } catch (err) {
        console.warn('TDSynnex fetch error for', number, err);
        // Still record this part as "not found" even if there was an error
        newItems.push({
          sourcePartNumber: source,
          synnexSKU: '-',
          mfgPN: number,
          description: '-',
          status: "Error fetching data",
          price: '-',
          totalQuantity: '0',
          upcCode: '-',
          warehouses: []
        });
      }
    }
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
  if (allItems.length === 0) {
    return;
  }

  // Build a single table including both "found" and "not found" items,
  // showing quantity = 0 for any "Not found" entries.
  const table = document.createElement('table');
  table.innerHTML = `
    <thead>
      <tr>
        <th>Source Part</th>
        <th>Synnex SKU</th>
        <th>Mfg Part Number</th>
        <th>UPC Code</th>
        <th>Description</th>
        <th>Status</th>
        <th>Price</th>
        <th>Total Quantity</th>
        <th>Warehouses</th>
      </tr>
    </thead>
    <tbody>
      ${allItems.map(item => {
        const totalQty = (item.status === 'Not found') ? '0' : (item.totalQuantity || '0');
        return `
          <tr>
            <td>${item.sourcePartNumber || '-'}</td>
            <td>${item.synnexSKU || '-'}</td>
            <td>${item.mfgPN || '-'}</td>
            <td>${item.upcCode || '-'}</td>
            <td>${item.description || '-'}</td>
            <td>${item.status || '-'}</td>
            <td>${item.price || '-'}</td>
            <td>${totalQty}</td>
            <td>${
              Array.isArray(item.warehouses) && item.warehouses.length > 0
                ? item.warehouses.map(wh => `${wh.city}: ${wh.qty}`).join('<br>')
                : '-'
            }</td>
          </tr>
        `;
      }).join('')}
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
        let data;
        try {
          data = await safeJsonParse(res);
        } catch (parseError) {
          console.warn('Ingram JSON parse error for', number, parseError);
          continue;
        }
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

  // Flatten the result data.
  // The new endpoint returns an array of objects, each having a "data" property that is an array.
  let items = [];
  searchResults.ingram.forEach(obj => {
    if (obj.data && Array.isArray(obj.data)) {
      items.push(...obj.data);
    }
  });
  
  if (items.length === 0) return;

  // Create a container for the table with horizontal scrolling
  const container = document.createElement('div');
  container.className = 'table-container';
  container.style.overflowX = 'auto';
  container.style.width = '100%';

  // Build the table headers and rows.
  // We now extract the correct quantity using "availability.totalAvailability"
  // and display the availability flag from "availability.available".
  const table = document.createElement('table');
  table.innerHTML = `
    <thead>
      <tr>
        <th>Ingram Part Number</th>
        <th>Vendor Part Number</th>
        <th>Description</th>
        <th>Vendor Name</th>
        <th>Total Availability</th>
        <th>Available?</th>
        <th>Retail Price</th>
        <th>Customer Price</th>
        <th>UPC</th>
      </tr>
    </thead>
    <tbody>
      ${items.map(item => `
        <tr>
          <td>${item.ingramPartNumber || '-'}</td>
          <td>${item.vendorPartNumber || '-'}</td>
          <td>${item.description || '-'}</td>
          <td>${item.vendorName || '-'}</td>
          <td>${(item.availability && item.availability.totalAvailability !== undefined) ? item.availability.totalAvailability : '-'}</td>
          <td>${(item.availability && item.availability.available) ? 'Yes' : 'No'}</td>
          <td>${(item.pricing && item.pricing.retailPrice) ? item.pricing.retailPrice : '-'}</td>
          <td>${(item.pricing && item.pricing.customerPrice) ? item.pricing.customerPrice : '-'}</td>
          <td>${item.upc ? item.upc : '-'}</td>
        </tr>
      `).join('')}
    </tbody>
  `;

  container.appendChild(table);
  resultsDiv.appendChild(container);

  // Enable sorting functionality if it is defined in your code.
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

  // Use a scrollable container so that if many columns are present the user can scroll horizontally.
  const container = document.createElement('div');
  container.className = 'table-container';
  container.style.overflowX = 'auto';
  container.style.width = '100%';

  // Updated table: Added UPC Code column after Manufacturer.
  const table = document.createElement('table');
  table.innerHTML = `
    <thead>
      <tr>
        <th>Source Part</th>
        <th>Company</th>
        <th>Country</th>
        <th>Part</th>
        <th>Manufacturer</th>
        <th>UPC Code</th>
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
          <td>${it.upcCode || '-'}</td>
          <td>${it.cond || '-'}</td>
          <td>${it.description || '-'}</td>
          <td>${it.price ? '$' + parseFloat(it.price).toFixed(2) : '-'}</td>
          <td>${it.qty || '0'}</td>
          <td>${it.age_in_days || '-'}</td>
        </tr>
      `).join('')}
    </tbody>
  `;
  
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
        let data;
        try {
          data = await safeJsonParse(res);
        } catch (parseError) {
          console.warn('Epicor JSON parse error for', number, parseError);
          continue;
        }
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

function buildEpicorInventoryTable() {
  const resultsDiv = document.querySelector('#inventory-content .inventory-results');
  if (!resultsDiv) return;
  resultsDiv.innerHTML = '';

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
              Currency: line.CurrencyCode || '',
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

  const sortedItems = [...items].sort((a, b) => {
    const dateA = a.OrderDate ? new Date(a.OrderDate) : null;
    const dateB = b.OrderDate ? new Date(b.OrderDate) : null;
    if (!dateA && !dateB) return 0;
    if (!dateA) return 1;
    if (!dateB) return -1;
    return dateB - dateA;
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
        <th data-date="true">Order Date</th>
        <th>Order Qty</th>
        <th>Unit Price</th>
        <th>Currency</th>
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
          <td data-date="${it.OrderDate || ''}">${it.OrderDate ? new Date(it.OrderDate).toLocaleDateString() : '-'}</td>
          <td>${it.OrderQty || '-'}</td>
          <td>${it.UnitPrice || '-'}</td>
          <td>${it.Currency || '-'}</td>
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
  
  const headers = table.querySelectorAll("th");
  const orderDateColumnIndex = 7;
  if (headers[orderDateColumnIndex]) {
    headers[orderDateColumnIndex].setAttribute("data-sort-order", "desc");
  }
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
          const purchasedItems = entry?.returnObj?.PAPurchasedBefore || [];
          if (purchasedItems.length > 0) {
            purchasedItems.forEach(line => {
              newItems.push({
                sourcePartNumber: source,
                PartNum: line.PartNum,
                VendorName: line.VendorName,
                VendorQty: line.VendorQty,
                VendorUnitCost: line.VendorUnitCost,
                Currency: line.BaseCurrSymbol || line.CurrSymbol || '',
                PONum: line.PONum,
                ReceiptDate: line.ReceiptDate,
                OrderDate: line.OrderDate,
                DueDate: line.DueDate,
                IsAdvisor: false,
                PartDescription: line.PartDescription || '',
                PurchasedBefore: true
              });
            });
          }
        });
      } catch (err) {
        console.warn('Purchases fetch error for', number, err);
      }
    }

    searchResults.purchases.push(...newItems);
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

function buildPurchasesTable() {
  const resultsDiv = document.querySelector('#purchases-content .purchases-results');
  if (!resultsDiv) return;
  resultsDiv.innerHTML = '';

  const allItems = searchResults.purchases;
  const filteredItems = allItems.filter(it =>
    it.PartNum && it.PartNum.trim() !== ''
  );

  if (filteredItems.length === 0) return;
  
  const sortedItems = [...filteredItems].sort((a, b) => {
    const dateA = a.OrderDate ? new Date(a.OrderDate) : null;
    const dateB = b.OrderDate ? new Date(b.OrderDate) : null;
    if (!dateA && !dateB) return 0;
    if (!dateA) return 1;
    if (!dateB) return -1;
    return dateB - dateA;
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
        <th>Currency</th>
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
          <td>${it.VendorUnitCost != null ? it.VendorUnitCost : '-'}</td>
          <td>${it.Currency || '-'}</td>
          <td>${it.PONum || '-'}</td>
          <td>${it.ReceiptDate ? new Date(it.ReceiptDate).toLocaleDateString() : '-'}</td>
          <td data-date="${it.OrderDate || ''}">${it.OrderDate ? new Date(it.OrderDate).toLocaleDateString() : '-'}</td>
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
  
  const headers = table.querySelectorAll("th");
  const orderDateColumnIndex = 8;
  if (headers[orderDateColumnIndex]) {
    headers[orderDateColumnIndex].setAttribute("data-sort-order", "desc");
  }
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

/***************************************************
 * Lenovo UI and Data Fetching
 ***************************************************/
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
    subtabs.innerHTML = '<div class="error">No Lenovo data found</div>';
    return;
  }

  allResults.forEach((doc, index) => {
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
          const docs = data[0].data
            .filter(doc => doc && doc.content && doc.content.trim() !== '')
            .map(doc => ({ ...doc, sourcePartNumber: source }));
          searchResults.lenovo.push(...docs);
        }
      } catch (error) {
        console.warn(`Lenovo error for ${number}:`, error);
      }
    }
    buildLenovoUI();
  } catch (err) {
    console.error('Lenovo data fetch error:', err);
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

  const searchStopped = stopSearchRequested;
  const searchEnded = analysisAlreadyCalled && !searchStopped;
  
  let notifications = '';
  
  if (searchStopped) {
    notifications += `
      <div class="search-stopped-message" style="padding: 10px; background-color: #ffecec; border: 1px solid #f5c6cb; border-radius: 4px; margin-bottom: 15px;">
        <p><strong>Search was stopped by user.</strong> Partial results are displayed.</p>
      </div>
    `;
  }
  
  if (searchEnded) {
    notifications += `
      <div class="search-ended-message" style="padding: 10px; background-color: #e6f7e6; border: 1px solid #c3e6cb; border-radius: 4px; margin-bottom: 15px;">
        <p><strong>Search completed.</strong> Results are displayed below.</p>
      </div>
    `;
  }

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
  
  let summaryContent = '';
  if (!anyEnabled) {
    summaryContent = 'No search results yet.';
  } else {
    summaryContent = generateSummaryTableHtml();
  }

  summaryDiv.innerHTML = notifications + summaryContent;
}


function generateSummaryTableHtml() {

  // Nested helper function that creates a single summary table for a given data key and label
  function createSummaryTable(key, label) {
    const dataArray = searchResults[key] || [];
    if (!dataArray.length) return '';

    // Group items by sourcePartNumber
    const grouped = {};
    dataArray.forEach(item => {
      const pnum = item.sourcePartNumber || 'Unknown';
      if (!grouped[pnum]) grouped[pnum] = [];
      grouped[pnum].push(item);
    });

    // Utility to parse raw price strings
    function parsePriceValue(str) {
      if (!str) return null;
      const numeric = parseFloat(str.replace(/[^\d.]/g, ''));
      return isNaN(numeric) ? null : numeric;
    }

    // Compute lowest price among items
    function findBestPrice(items) {
      let minPrice = null;
      items.forEach(it => {
        let priceVal = null;
        switch (key) {
          case 'amazonConnector':
            if (it.price && it.price.value) {
              priceVal = parseFloat(it.price.value);
            }
            break;
          case 'ebayConnector':
            priceVal = parsePriceValue(it.priceWithCurrency);
            break;
          case 'amazon':
            priceVal = parsePriceValue(it.rawPrice);
            break;
          case 'ebay':
            priceVal = parsePriceValue(it.rawPrice);
            break;
          case 'brokerbin':
            // might be a number or a string
            if (typeof it.price === 'number') {
              priceVal = it.price;
            } else {
              priceVal = parsePriceValue(it.price);
            }
            break;
          case 'tdsynnex':
            priceVal = parseFloat(it.price);
            break;
          case 'epicor':
            priceVal = parseFloat(it.BasePrice);
            break;
          case 'ingram':
            if (it.price !== undefined && it.price !== null) {
              priceVal = parseFloat(it.price);
            }
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

    // Compute total quantity for each integration
    function parseQuantity(item) {
      switch (key) {
        case 'epicor':
          return parseFloat(item.Quantity) || 0;
        case 'ingram':
          // In your data structure, quantity is typically found in `availability`
          return parseFloat(item.availability) || 0;
        case 'tdsynnex':
          return parseFloat(item.totalQuantity) || 0;
        case 'brokerbin':
          return parseFloat(item.qty) || 0;
        default:
          // For connectors or scrapers, default to 0
          return 0;
      }
    }

    // Build table rows
    let rows = '';
    for (const part in grouped) {
      const items = grouped[part];
      const bestPrice = findBestPrice(items);

      // For the listed integrations, show total quantity (like Epicor)
      if (['epicor', 'ingram', 'tdsynnex', 'brokerbin'].includes(key)) {
        const totalQty = items.reduce((sum, it) => sum + parseQuantity(it), 0);
        rows += `
          <tr>
            <td>${part}</td>
            <td>${totalQty}</td>
            <td>${bestPrice != null ? '$' + bestPrice.toFixed(2) : '-'}</td>
          </tr>
        `;
      } else {
        // Otherwise, show how many rows were found
        rows += `
          <tr>
            <td>${part}</td>
            <td>${items.length}</td>
            <td>${bestPrice != null ? '$' + bestPrice.toFixed(2) : '-'}</td>
          </tr>
        `;
      }
    }

    return `
      <h3>${label} Summary</h3>
      <table>
        <thead>
          <tr>
            <th>Part Number</th>
            <th>${
              ['epicor', 'ingram', 'tdsynnex', 'brokerbin'].includes(key)
                ? 'Total Quantity'
                : 'Items Found'
            }</th>
            <th>Best Price</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    `;
  }

  // Build the summary HTML by including each data source if enabled
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

  // If no summary was generated, return a default message
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

document.addEventListener('DOMContentLoaded', function() {
  // Microsoft Sign-In using MSAL (OAuth) as an SPA
  const msalConfig = {
    auth: {
      clientId: "55d42531-ba08-4025-9b11-2edfa204e8fc", // Your app's client ID
      authority: "https://login.microsoftonline.com/9d2b3197-d8d2-43f1-9c75-478b57832274", // Your tenant ID
      redirectUri: "https://mfptech.com/mint/" // Must match exactly what is registered
    },
    system: {
      loggerOptions: {
        loggerCallback: (level, message, containsPii) => {
          console.log(message);
        },
        piiLoggingEnabled: false,
        logLevel: msal.LogLevel.Verbose
      }
    }
  };

  const msalInstance = new msal.PublicClientApplication(msalConfig);

  // Handle the redirect response when the app loads
  msalInstance.handleRedirectPromise()
    .then(loginResponse => {
      if (loginResponse) {
        console.log("Microsoft Login Response:", loginResponse);
        document.getElementById('user-info').textContent = "Signed in as: " + loginResponse.account.username;
        document.getElementById('auth-overlay').classList.add("logged-in");
      }
    })
    .catch(error => {
      console.error("Microsoft Login Error:", error);
      alert("Microsoft login failed. Please try again or contact support.");
    });

  // Bind the sign-in button to initiate the redirect login flow
  document.getElementById('microsoft-signin-btn').addEventListener('click', function() {
    msalInstance.loginRedirect({ scopes: ["User.Read"] });
  });
});
