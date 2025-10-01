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
  lenovo: [],
  lenovoWarranty: [],
  lenovoParts: [],
};
// Keep track of how many endpoint requests are currently active
let activeRequestsCount = 0;
// Flag for whether alternative expansions are in progress
let expansionsInProgress = false;
// Currently selected part number from dropdown (null initially)
let selectedPartNumber = null;
// Store alternatives data per part number
let partAlternativesData = {};
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
  const lenovoWarrantySubtabs = document.getElementById('lenovo-warranty-subtabs');
  const lenovoWarrantySubcontent = document.getElementById('lenovo-warranty-subcontent');
  if (lenovoWarrantySubtabs) lenovoWarrantySubtabs.innerHTML = '';
  if (lenovoWarrantySubcontent) lenovoWarrantySubcontent.innerHTML = '';
  const lenovoPartsSubtabs = document.getElementById('lenovo-parts-subtabs');
  const lenovoPartsSubcontent = document.getElementById('lenovo-parts-subcontent');
  if (lenovoPartsSubtabs) lenovoPartsSubtabs.innerHTML = '';
  if (lenovoPartsSubcontent) lenovoPartsSubcontent.innerHTML = '';

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
  // Refresh the current tab's content based on selected part
  refreshCurrentTab();
}
/***************************************************
 * New: Refresh current tab based on selected part
 ***************************************************/
function refreshCurrentTab() {
  const activeTab = document.querySelector('.tab-content.active');
  if (!activeTab) return;
  const tabId = activeTab.id;
  switch (tabId) {
    case 'summary':
      updateSummaryTab();
      break;
    case 'lenovo':
      buildLenovoUI();
      break;
    case 'lenovo-warranty':
      buildLenovoWarrantyUI();
      break;
    case 'lenovo-parts':
      buildLenovoPartsUI();
      break;
    case 'distributors':
      buildTDSynnexTable();
      buildIngramTable();
      buildBrokerBinTable();
      break;
    case 'marketplaces':
      buildAmazonConnectorTable();
      buildEbayConnectorTable();
      buildAmazonScraperTable();
      buildEbayScraperTable();
      break;
    case 'inventory':
      buildEpicorInventoryTable();
      break;
    case 'sales':
      buildSalesTable();
      break;
    case 'purchases':
      buildPurchasesTable();
      break;
    case 'analysis':
      // Analysis might need re-rendering if per-part, but currently global
      break;
  }
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
  // Configuración inicial
  const nestedLevelInput = document.getElementById('nested-level-selector');
  if (nestedLevelInput) {
    configNestedLevel = parseInt(nestedLevelInput.value, 10);
  }
 
  // Inicializar variables de estado
  stopSearchRequested = false;
  limitedSearchMode = false;
  analysisAlreadyCalled = false;

  // Clear alternatives data for new search
  partAlternativesData = {};

  // Limpiar la interfaz
  cleanupUI();
  
  // Get part numbers from input
  const partNumberInputs = document.getElementById('part-numbers').value
  if (!partNumberInputs) {
    alert('part number input not found');
    return;
  }
  const partNumbersRaw = partNumberInputs.split(/,|\|/);
  const partNumbers = new Set(partNumbersRaw.map(p => p.trim()).filter(p => p));
 
  if (partNumbers.size === 0) {
    alert('Please enter at least one part number');
    return;
  }
 
  const partsSelect = document.getElementById('part-numbers-select');
  partsSelect.innerHTML = '<option value="">Select a part number</option>';
  
  // Convertir el Set a un array para poder acceder al primer elemento
  const partNumbersArray = Array.from(partNumbers);
  
  partNumbersArray.forEach((partNumber, index) => {
    const option = document.createElement('option');
    option.value = partNumber;
    option.textContent = partNumber;
    
    // Seleccionar el primer número de parte por defecto
    if (index === 0) {
      option.selected = true;
      // Actualizar el número de parte seleccionado
      selectedPartNumber = partNumber;
    }
    
    partsSelect.appendChild(option);
  });

  // Add change event listener to dropdown
  partsSelect.addEventListener('change', handlePartSelection);
 
  Object.keys(searchResults).forEach(k => {
    searchResults[k] = [];
  });
  activeRequestsCount = 0;
  expansionsInProgress = false;
  const spinner = document.getElementById('loading-spinner');
  const stopBtn = document.getElementById('stop-search-btn');
  if (spinner) spinner.style.display = 'inline-block';
  if (stopBtn) stopBtn.style.display = 'inline-block';

  const alreadySearched = new Set();

  try {
    // Search all part numbers in parallel
    const searchPromises = Array.from(partNumbers).map(async (partNumber) => {
      if (stopSearchRequested) return;

      // Initialize alternatives array for this part
      const finalAlternatives = [];

      // Get alternatives data for this specific part
      const topData = await getAlternativePartNumbers(partNumber);
      const topOriginal = topData.original;

      // Store alternatives data for this part
      partAlternativesData[partNumber] = {
        description: topData.description,
        category: topData.category,
        original: topOriginal,
        alternatives: finalAlternatives
      };

      // Update UI immediately if this is the currently selected part
      if (selectedPartNumber === partNumber) {
        updateAlternativesForSelectedPart();
      }

      // Callback for when new alternatives are found
      async function onNewAlts(newlyAdded) {
        if (stopSearchRequested) return;

        // Update alternatives in the stored data
        partAlternativesData[partNumber].alternatives = [...finalAlternatives];

        // Update UI if this is the currently selected part
        if (selectedPartNumber === partNumber) {
          updateAlternativesForSelectedPart();
        }

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

      // Start expansions if enabled
      if (configUseAlternatives) {
        startExpansions(topOriginal, finalAlternatives, onNewAlts);
      }

      alreadySearched.add(topOriginal.trim().toUpperCase());
      await executeEndpointSearches([{ number: topOriginal, source: topOriginal }]);
    });

    await Promise.all(searchPromises);

    checkIfAllDone();
    // After all searches, show message to select a part
    document.getElementById('summary-content').innerHTML = '<p>Search completed for all parts. Please select a part number from the dropdown to view results.</p>';
  } catch (err) {
    console.error('handleSearch error:', err);
  }
}
/***************************************************
 * New: Handle dropdown selection
 ***************************************************/
function handlePartSelection(event) {
  selectedPartNumber = event.target.value;
  if (!selectedPartNumber) {
    // Clear all displays if no selection
    cleanupUI();
    document.getElementById('summary-content').innerHTML = '<p>Please select a part number to view results.</p>';
    // Clear alternatives display
    const altDiv = document.getElementById('alternative-numbers');
    if (altDiv) altDiv.innerHTML = '';
    return;
  }
  // Update alternatives display for selected part
  updateAlternativesForSelectedPart();
  // Refresh all tabs based on selected part
  refreshCurrentTab();
}
/***************************************************
 * Update alternatives display for selected part
 ***************************************************/
function updateAlternativesForSelectedPart() {
  const altDiv = document.getElementById('alternative-numbers');
  if (!altDiv || !selectedPartNumber) return;

  const partData = partAlternativesData[selectedPartNumber];
  if (!partData) {
    altDiv.innerHTML = '<p>No alternatives data available for this part.</p>';
    return;
  }

  let html = `
    <p><strong>Description:</strong> ${partData.description || 'N/A'}</p>
    <p><strong>Category:</strong> ${partData.category || 'N/A'}</p>
  `;

  if (partData.alternatives && partData.alternatives.length > 0) {
    html += `
      <h4>Alternative Part Numbers Found:</h4>
      <ul class="alternative-numbers-list">
        ${partData.alternatives.map(a => `
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
  if (document.getElementById('toggle-lenovo-warranty').checked) {
    tasks.push(fetchLenovoWarrantyData(partNumbers));
  }
  if (document.getElementById('toggle-lenovo-parts').checked) {
    tasks.push(fetchLenovoPartsData(partNumbers));
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
  let allItems = searchResults.tdsynnex;
  if (selectedPartNumber) {
    allItems = allItems.filter(item => item.sourcePartNumber === selectedPartNumber);
  }
  if (allItems.length === 0) {
    resultsDiv.innerHTML = '<p>No data available for selected part.</p>';
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
// Replace your entire fetchDistributorData function in index.js with the code below:
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
        if (!res.ok) {
          // If the response isn't OK, treat as "not found"
          newItems.push({
            sourcePartNumber: source,
            description: '-',
            category: '-',
            vendorName: '-',
            vendorPartNumber: '-',
            price: null,
            availability: { totalAvailability: 0 },
            upcCode: '-',
            productType: '-',
            discontinued: 'False',
            newProduct: 'False',
            status: 'Not found'
          });
          continue;
        }
        // The API response shape is generally: [ { data: [ ...actualItems ] } ]
        const data = await safeJsonParse(res);
        if (
          !Array.isArray(data) ||
          data.length === 0 ||
          !data[0].data ||
          !Array.isArray(data[0].data) ||
          data[0].data.length === 0
        ) {
          // No records returned
          newItems.push({
            sourcePartNumber: source,
            description: '-',
            category: '-',
            vendorName: '-',
            vendorPartNumber: '-',
            price: null,
            availability: { totalAvailability: 0 },
            upcCode: '-',
            productType: '-',
            discontinued: 'False',
            newProduct: 'False',
            status: 'Not found'
          });
        } else {
          const actualRecords = data[0].data;
          const resultsWithSource = actualRecords.map(obj => ({
            sourcePartNumber: source,
            description: obj.description || '-',
            category: '-', // Adjust if you have a category field in the data
            vendorName: obj.vendorName || '-',
            vendorPartNumber: obj.vendorPartNumber || '-',
            // Example uses customerPrice from 'pricing' object. Adjust if you prefer retailPrice, etc.
            price: (obj.pricing && obj.pricing.customerPrice !== null) ? obj.pricing.customerPrice : null,
            // Make sure to copy the entire availability object if you need it:
            availability: obj.availability || { totalAvailability: 0 },
            upcCode: obj.upc || '-',
            productType: obj.partNumberType || '-',
            discontinued: 'False', // Or derive from obj.productStatusCode if needed
            newProduct: 'False', // Or any logic you prefer
            status: 'OK'
          }));
          newItems.push(...resultsWithSource);
        }
      } catch (err) {
        console.warn('Ingram error for', number, err);
        newItems.push({
          sourcePartNumber: source,
          description: '-',
          category: '-',
          vendorName: '-',
          vendorPartNumber: '-',
          price: null,
          availability: { totalAvailability: 0 },
          upcCode: '-',
          productType: '-',
          discontinued: 'False',
          newProduct: 'False',
          status: 'Not found'
        });
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
// Add or replace this entire function in your index.js
function buildIngramTable() {
  const resultsDiv = document.querySelector('#distributors-content .ingram-results .results-container');
  if (!resultsDiv) return;
  resultsDiv.innerHTML = '';
  let items = searchResults.ingram;
  if (selectedPartNumber) {
    items = items.filter(item => item.sourcePartNumber === selectedPartNumber);
  }
  if (items.length === 0) {
    resultsDiv.innerHTML = '<p>No data available for selected part.</p>';
    return;
  }
  const container = document.createElement('div');
  container.className = 'table-container';
  container.style.overflowX = 'auto';
  container.style.width = '100%';
  // We've added a "Status" property to track "Not found" vs. real data
  const table = document.createElement('table');
  table.innerHTML = `
    <thead>
      <tr>
        <th>Source Part</th>
        <th>Description</th>
        <th>Category</th>
        <th>Vendor</th>
        <th>Part Number</th>
        <th>Price</th>
        <th>Availability</th>
        <th>UPC Code</th>
        <th>Product Type</th>
        <th>Status</th>
      </tr>
    </thead>
    <tbody>
      ${items.map(it => {
        // Use the totalAvailability from the returned availability object, defaulting to "0" if missing
        const availabilityValue = (it.availability && it.availability.totalAvailability != null)
          ? it.availability.totalAvailability
          : '0';
        return `
          <tr>
            <td>${it.sourcePartNumber}</td>
            <td>${it.description || '-'}</td>
            <td>${it.category || '-'}</td>
            <td>${it.vendorName || '-'}</td>
            <td>${it.vendorPartNumber || '-'}</td>
            <td>${it.price != null ? it.price : '-'}</td>
            <td>${availabilityValue}</td>
            <td>${it.upcCode || '-'}</td>
            <td>${it.productType || '-'}</td>
            <td>${it.status || '-'}</td>
          </tr>
        `;
      }).join('')}
    </tbody>
  `;
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
  let items = searchResults.brokerbin;
  if (selectedPartNumber) {
    items = items.filter(item => item.sourcePartNumber === selectedPartNumber);
  }
  if (items.length === 0) {
    resultsDiv.innerHTML = '<p>No data available for selected part.</p>';
    return;
  }
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
  let allItems = searchResults.epicor;
  if (selectedPartNumber) {
    allItems = allItems.filter(item => item.sourcePartNumber === selectedPartNumber);
  }
  const filteredItems = allItems.filter(it =>
    it.Company && it.Company.trim() !== '' &&
    it.PartNum && it.PartNum.trim() !== ''
  );
  if (filteredItems.length === 0) {
    resultsDiv.innerHTML = '<p>No data available for selected part.</p>';
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
  let items = searchResults.sales;
  if (selectedPartNumber) {
    items = items.filter(item => item.sourcePartNumber === selectedPartNumber);
  }
  if (items.length === 0) {
    resultsDiv.innerHTML = '<p>No data available for selected part.</p>';
    return;
  }
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
  let allItems = searchResults.purchases;
  if (selectedPartNumber) {
    allItems = allItems.filter(item => item.sourcePartNumber === selectedPartNumber);
  }
  const filteredItems = allItems.filter(it =>
    it.PartNum && it.PartNum.trim() !== ''
  );
  if (filteredItems.length === 0) {
    resultsDiv.innerHTML = '<p>No data available for selected part.</p>';
    return;
  }
 
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
  let items = searchResults.amazonConnector;
  if (selectedPartNumber) {
    items = items.filter(item => item.sourcePartNumber === selectedPartNumber);
  }
  if (items.length === 0) {
    resultsDiv.innerHTML = '<p>No data available for selected part.</p>';
    return;
  }
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
  let items = searchResults.ebayConnector;
  if (selectedPartNumber) {
    items = items.filter(item => item.sourcePartNumber === selectedPartNumber);
  }
  if (items.length === 0) {
    resultsDiv.innerHTML = '<p>No data available for selected part.</p>';
    return;
  }
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
  let items = searchResults.amazon;
  if (selectedPartNumber) {
    items = items.filter(item => item.sourcePartNumber === selectedPartNumber);
  }
  if (items.length === 0) {
    resultsDiv.innerHTML = '<p>No data available for selected part.</p>';
    return;
  }
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
  let items = searchResults.ebay;
  if (selectedPartNumber) {
    items = items.filter(item => item.sourcePartNumber === selectedPartNumber);
  }
  if (items.length === 0) {
    resultsDiv.innerHTML = '<p>No data available for selected part.</p>';
    return;
  }
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
 * Lenovo Warranty UI and Data Fetching
 ***************************************************/
function buildLenovoWarrantyUI() {
  const lenovoWarrantyDiv = document.getElementById('lenovo-warranty-content');
  if (!lenovoWarrantyDiv) return;
  let subtabs = document.getElementById('lenovo-warranty-subtabs');
  let subcontent = document.getElementById('lenovo-warranty-subcontent');
  if (!subtabs) {
    subtabs = document.createElement('div');
    subtabs.id = 'lenovo-warranty-subtabs';
    subtabs.className = 'subtabs';
    lenovoWarrantyDiv.appendChild(subtabs);
  }
  if (!subcontent) {
    subcontent = document.createElement('div');
    subcontent.id = 'lenovo-warranty-subcontent';
    lenovoWarrantyDiv.appendChild(subcontent);
  }
  subtabs.innerHTML = '';
  subcontent.innerHTML = '';
  let allResults = searchResults.lenovoWarranty;
  if (selectedPartNumber) {
    allResults = allResults.filter(doc => doc.sourcePartNumber === selectedPartNumber);
  }
  if (!allResults || allResults.length === 0) {
    subtabs.innerHTML = '<div class="error">No Lenovo Warranty data found for selected part</div>';
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
    subtabButton.onclick = () => switchLenovoWarrantySubtab(index);
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
  }
  );
}
async function fetchLenovoWarrantyData(partNumbers) {
  if (stopSearchRequested) return;
  if (!document.getElementById('toggle-lenovo-warranty').checked) return;
  activeRequestsCount++;
  try {
    for (const { number, source } of partNumbers) {
      if (stopSearchRequested) break;
      try {
        const response = await fetch(`https://${serverDomain}/webhook/lenovo-api/product?item=${encodeURIComponent(number)}`);
        if (!response.ok) continue;
        const data = await response.json();
        console.log({lenovoWarrantyData: data, number, source});
        if (data[0]?.htmlSpecifications) {
          const doc = {
            id: data[0].id || 'Unknown ID',
            title: data[0].product || 'Untitled Document',
            content: data[0].htmlSpecifications,
            sourcePartNumber: source
          };
          searchResults.lenovoWarranty.push(doc);
        }
      } catch (error) {
        console.warn(`Lenovo Warranty error for ${number}:`, error);
      }
    }
    buildLenovoWarrantyUI();
  } catch (err) {
    console.error('Lenovo Warranty data fetch error:', err);
    if (!searchResults.lenovoWarranty.length) {
      const subtabs = document.getElementById('lenovo-warranty-subtabs');
      if (subtabs) {
        subtabs.innerHTML = `<div class="error">Error fetching Lenovo Warranty data: ${err.message}</div>`;
      }
    }
  } finally {
    activeRequestsCount--;
    checkIfAllDone();
  }
}
function switchLenovoWarrantySubtab(index) {
  document.querySelectorAll('.subtab-button').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.subtab-content').forEach(c => c.classList.remove('active'));
  document.querySelectorAll('.subtab-button')[index].classList.add('active');
  document.querySelector(`.subtab-content[data-subtab-index="${index}"]`).classList.add('active');
}
/***************************************************
 * Lenovo Parts UI and Data Fetching
 ***************************************************/
function buildLenovoPartsUI() {
  const lenovoPartsDiv = document.getElementById('lenovo-parts-content');
  if (!lenovoPartsDiv) return;
  let subtabs = document.getElementById('lenovo-parts-subtabs');
  let subcontent = document.getElementById('lenovo-parts-subcontent');
  if (!subtabs) {
    subtabs = document.createElement('div');
    subtabs.id = 'lenovo-parts-subtabs';
    subtabs.className = 'subtabs';
    lenovoPartsDiv.appendChild(subtabs);
  }
  if (!subcontent) {
    subcontent = document.createElement('div');
    subcontent.id = 'lenovo-parts-subcontent';
    lenovoPartsDiv.appendChild(subcontent);
  }
  subtabs.innerHTML = '';
  subcontent.innerHTML = '';
  let allResults = searchResults.lenovoParts;
  if (selectedPartNumber) {
    allResults = allResults.filter(doc => doc.sourcePartNumber === selectedPartNumber);
  }
  if (!allResults || allResults.length === 0) {
    subtabs.innerHTML = '<div class="error">No Lenovo Parts data found for selected part</div>';
    return;
  }
  allResults.forEach((doc, index) => {
    const subtabButton = document.createElement('button');
    subtabButton.className = `subtab-button ${index === 0 ? 'active' : ''}`;
    subtabButton.textContent = doc.sourcePartNumber;
    subtabButton.onclick = () => switchLenovoPartsSubtab(index);
    subtabs.appendChild(subtabButton);
    const contentDiv = document.createElement('div');
    contentDiv.className = `subtab-content ${index === 0 ? 'active' : ''}`;
    contentDiv.setAttribute('data-subtab-index', index);

    // Build paginated table for parts
    const itemsPerPage = 50;
    const totalPages = Math.ceil(doc.parts.length / itemsPerPage);

    function renderPartsPage(page) {
      const start = page * itemsPerPage;
      const end = start + itemsPerPage;
      const pageParts = doc.parts.slice(start, end);

      let tableHTML = `
        <div class="pagination-info">
          <p>Showing ${start + 1} to ${Math.min(end, doc.parts.length)} of ${doc.parts.length} parts</p>
        </div>
        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Type</th>
                <th>Name</th>
                <th>Level</th>
              </tr>
            </thead>
            <tbody>
      `;

      pageParts.forEach(part => {
        tableHTML += `
          <tr>
            <td>${part.id || 'N/A'}</td>
            <td>${part.type || 'N/A'}</td>
            <td>${part.name || 'N/A'}</td>
            <td>${part.level || 'N/A'}</td>
          </tr>
        `;
      });

      tableHTML += `
            </tbody>
          </table>
        </div>
      `;

      // Add pagination controls
      if (totalPages > 1) {
        tableHTML += '<div class="pagination-controls" style="margin-top: 15px; text-align: center;">';

        // Previous button
        if (page > 0) {
          tableHTML += `<button class="page-btn" data-page="${page - 1}" style="margin: 0 5px;">Previous</button>`;
        }

        // Page info
        tableHTML += `<span style="margin: 0 10px;">Page ${page + 1} of ${totalPages}</span>`;

        // Next button
        if (page < totalPages - 1) {
          tableHTML += `<button class="page-btn" data-page="${page + 1}" style="margin: 0 5px;">Next</button>`;
        }

        tableHTML += '</div>';
      }

      return tableHTML;
    }

    // Create wrapper with page tracking
    const wrapper = document.createElement('div');
    wrapper.className = 'parts-content-wrapper';
    wrapper.id = `lenovo-parts-page-${index}`;

    // Initial render
    wrapper.innerHTML = renderPartsPage(0);

    // Add event delegation for pagination
    wrapper.addEventListener('click', (e) => {
      if (e.target.classList.contains('page-btn')) {
        const newPage = parseInt(e.target.dataset.page);
        wrapper.innerHTML = renderPartsPage(newPage);
      }
    });

    contentDiv.appendChild(wrapper);
    subcontent.appendChild(contentDiv);
  });
}

async function fetchLenovoPartsData(partNumbers) {
  if (stopSearchRequested) return;
  if (!document.getElementById('toggle-lenovo-parts').checked) return;
  activeRequestsCount++;
  try {
    for (const { number, source } of partNumbers) {
      if (stopSearchRequested) break;
      try {
        const response = await fetch(`https://${serverDomain}/webhook/lenovo-api/part?item=${encodeURIComponent(number)}`);
        if (!response.ok) continue;
        const data = await response.json();
        console.log({lenovoPartsData: data, number, source});
        if (Array.isArray(data) && data.length > 0) {
          const doc = {
            sourcePartNumber: source,
            parts: data.map(item => ({
              id: item.id || 'N/A',
              type: item.type || 'N/A',
              name: item.name || 'N/A',
              level: item.level || 'N/A'
            }))
          };
          searchResults.lenovoParts.push(doc);
        }
      } catch (error) {
        console.warn(`Lenovo Parts error for ${number}:`, error);
      }
    }
    buildLenovoPartsUI();
  } catch (err) {
    console.error('Lenovo Parts data fetch error:', err);
    if (!searchResults.lenovoParts.length) {
      const subtabs = document.getElementById('lenovo-parts-subtabs');
      if (subtabs) {
        subtabs.innerHTML = `<div class="error">Error fetching Lenovo Parts data: ${err.message}</div>`;
      }
    }
  } finally {
    activeRequestsCount--;
    checkIfAllDone();
  }
}

function switchLenovoPartsSubtab(index) {
  const subtabs = document.getElementById('lenovo-parts-subtabs');
  const subcontent = document.getElementById('lenovo-parts-subcontent');
  if (!subtabs || !subcontent) return;

  subtabs.querySelectorAll('.subtab-button').forEach(btn => btn.classList.remove('active'));
  subcontent.querySelectorAll('.subtab-content').forEach(c => c.classList.remove('active'));

  const buttons = subtabs.querySelectorAll('.subtab-button');
  const contents = subcontent.querySelectorAll('.subtab-content');

  if (buttons[index]) buttons[index].classList.add('active');
  if (contents[index]) contents[index].classList.add('active');
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
  let allResults = searchResults.lenovo;
  if (selectedPartNumber) {
    allResults = allResults.filter(doc => doc.sourcePartNumber === selectedPartNumber);
  }
  if (!allResults || allResults.length === 0) {
    subtabs.innerHTML = '<div class="error">No Lenovo data found for selected part</div>';
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
  if (!selectedPartNumber) {
    summaryDiv.innerHTML = '<p>Please select a part number to view summary.</p>';
    return;
  }
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
// Replace your entire generateSummaryTableHtml function in index.js with the code below:
// *** REPLACE the entire generateSummaryTableHtml function in index.js with the code below ***
function generateSummaryTableHtml() {
  /** small helper reused in several places **/
  function parsePrice(str) {
    if (!str) return null;
    const numeric = parseFloat(str.replace(/[^\d.]/g, ''));
    return isNaN(numeric) ? null : numeric;
  }
  /** builds one summary table for a given data‑key **/
  function createSummaryTable(key, label) {
    let dataArray = searchResults[key] || [];
    if (selectedPartNumber) {
      dataArray = dataArray.filter(item => item.sourcePartNumber === selectedPartNumber);
    }
    if (!dataArray.length) return '';
    /* special handling for the (rare) case where every single
       TDSynnex row is “Not found” – we still want to show the user
       something meaningful instead of a blank area */
    if (key === 'tdsynnex') {
      const allNotFound = dataArray.every(item => item.status === "Not found");
      if (allNotFound) {
        return `
          <h3>${label} Summary</h3>
          <table>
            <thead>
              <tr>
                <th>Part Number</th><th>Status</th><th>Best Price</th>
              </tr>
            </thead>
            <tbody>
              ${dataArray.map(item => `
                <tr>
                  <td>${item.mfgPN || item.sourcePartNumber}</td>
                  <td>Not available</td>
                  <td>-</td>
                </tr>
              `).join('')}
            </tbody>
          </table>`;
      }
    }
    /* group every result under its originating sourcePartNumber */
    const grouped = {};
    dataArray.forEach(item => {
      const pnum = item.sourcePartNumber || 'Unknown';
      if (!grouped[pnum]) grouped[pnum] = [];
      grouped[pnum].push(item);
    });
    /* extracts the lowest price we can find for a single grouped item list */
    function findBestPrice(items) {
      let min = null;
      items.forEach(it => {
        let p = null;
        switch (key) {
          case 'amazonConnector':
            if (it.price && it.price.value) p = parseFloat(it.price.value);
            break;
          case 'ebayConnector':
          case 'amazon':
          case 'ebay':
            p = parsePrice(it.priceWithCurrency || it.rawPrice);
            break;
          case 'brokerbin':
            p = parseFloat(it.price);
            break;
          case 'tdsynnex':
            p = parseFloat(it.price);
            break;
          case 'ingram':
            p = parseFloat(it.price);
            break;
          case 'epicor':
            p = parseFloat(it.BasePrice);
            break;
        }
        if (!isNaN(p) && p > 0 && (min == null || p < min)) min = p;
      });
      return min;
    }
    /* rows builder */
    let rows = '';
    for (const part in grouped) {
      const bestPrice = findBestPrice(grouped[part]);
      /* quantity calculations differ per source */
      if (key === 'epicor' || key === 'tdsynnex' || key === 'ingram') {
        let totalQty = 0;
        if (key === 'epicor') {
          grouped[part].forEach(it => {
            const q = parseFloat(it.Quantity);
            if (!isNaN(q)) totalQty += q;
          });
        } else if (key === 'tdsynnex') {
          grouped[part].forEach(it => {
            const q = parseFloat(it.totalQuantity);
            if (!isNaN(q)) totalQty += q;
          });
        } else if (key === 'ingram') {
          grouped[part].forEach(it => {
            /* NEW – availability can now be either a number/string
               or the full object returned by Ingram. */
            let q = 0;
            if (it.availability != null) {
              if (typeof it.availability === 'object') {
                const val = it.availability.totalAvailability;
                q = parseInt(val, 10);
              } else {
                q = parseInt(it.availability, 10);
              }
            }
            if (!isNaN(q)) totalQty += q;
          });
        }
        rows += `
          <tr>
            <td>${part}</td>
            <td>${totalQty}</td>
            <td>${bestPrice != null ? '$' + bestPrice.toFixed(2) : '-'}</td>
          </tr>`;
      } else {
        /* other sources – count rows instead of quantities */
        rows += `
          <tr>
            <td>${part}</td>
            <td>${grouped[part].length}</td>
            <td>${bestPrice != null ? '$' + bestPrice.toFixed(2) : '-'}</td>
          </tr>`;
      }
    }
    return `
      <h3>${label} Summary</h3>
      <table>
        <thead>
          <tr>
            <th>Part Number</th>
            <th>${(key === 'epicor' || key === 'tdsynnex' || key === 'ingram') ? 'Total Quantity' : 'Items Found'}</th>
            <th>Best Price</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;
  }
  /* Build each section if its toggle is active */
  let summaryHTML = '';
  if (document.getElementById('toggle-inventory').checked) summaryHTML += createSummaryTable('epicor', 'Epicor (Inventory)');
  if (document.getElementById('toggle-brokerbin').checked) summaryHTML += createSummaryTable('brokerbin', 'BrokerBin');
  if (document.getElementById('toggle-tdsynnex').checked) summaryHTML += createSummaryTable('tdsynnex', 'TDSynnex');
  if (document.getElementById('toggle-ingram').checked) summaryHTML += createSummaryTable('ingram', 'Ingram');
  if (document.getElementById('toggle-amazon-connector').checked) summaryHTML += createSummaryTable('amazonConnector','AmazonConnector');
  if (document.getElementById('toggle-ebay-connector').checked) summaryHTML += createSummaryTable('ebayConnector', 'eBayConnector');
  if (document.getElementById('toggle-amazon').checked) summaryHTML += createSummaryTable('amazon', 'Amazon');
  if (document.getElementById('toggle-ebay').checked) summaryHTML += createSummaryTable('ebay', 'eBay');
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