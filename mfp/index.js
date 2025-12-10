/***************************************************
 * Workflow Selection
 ***************************************************/
let currentWorkflow = null;

function selectWorkflow(workflow, skipInputSave = false) {
  // Save current workflow data before switching
  if (currentWorkflow) {
    saveCurrentWorkflowData(skipInputSave);
  }

  // Update current workflow
  currentWorkflow = workflow;

  // Hide welcome screen
  const welcomeScreen = document.getElementById('welcome-screen');
  if (welcomeScreen) {
    welcomeScreen.style.display = 'none';
  }

  // Show main interface
  const mainInterface = document.getElementById('main-interface');
  if (mainInterface) {
    mainInterface.style.display = 'block';
  }

  // Show/hide appropriate dropdown
  const serversDropdown = document.getElementById('servers-dropdown-container');
  const partsDropdown = document.getElementById('parts-dropdown-container');
  if (workflow === 'servers') {
    if (serversDropdown) serversDropdown.style.display = 'block';
    if (partsDropdown) partsDropdown.style.display = 'none';
  } else {
    if (serversDropdown) serversDropdown.style.display = 'none';
    if (partsDropdown) partsDropdown.style.display = 'block';
  }

  // Update workflow button active states
  const serversBtn = document.getElementById('servers-workflow-btn');
  const partsBtn = document.getElementById('parts-workflow-btn');
  if (serversBtn && partsBtn) {
    if (workflow === 'servers') {
      serversBtn.classList.add('active');
      partsBtn.classList.remove('active');
    } else {
      serversBtn.classList.remove('active');
      partsBtn.classList.add('active');
    }
  }

  // Filter tabs based on workflow
  const allTabButtons = document.querySelectorAll('.tab-button');
  allTabButtons.forEach(button => {
    const buttonWorkflow = button.getAttribute('data-workflow');
    if (buttonWorkflow === workflow) {
      button.style.display = 'inline-block';
    } else {
      button.style.display = 'none';
    }
  });

  // Filter checkboxes based on workflow
  const allCheckboxLabels = document.querySelectorAll('.checkbox-group label[data-workflow]');
  allCheckboxLabels.forEach(label => {
    const labelWorkflow = label.getAttribute('data-workflow');
    const checkbox = label.querySelector('input[type="checkbox"]');
    if (labelWorkflow === workflow) {
      label.style.display = 'inline-block';
      // Check all visible checkboxes for the selected workflow
      if (checkbox) {
        checkbox.checked = true;
      }
    } else {
      label.style.display = 'none';
      // Uncheck hidden checkboxes to prevent unnecessary API calls
      if (checkbox) {
        checkbox.checked = false;
      }
    }
  });

  // Hide/show alternative-numbers div based on workflow
  const alternativesDiv = document.getElementById('alternative-numbers');
  if (alternativesDiv) {
    if (workflow === 'parts') {
      alternativesDiv.style.display = 'block';
    } else {
      alternativesDiv.style.display = 'none';
    }
  }

  // Restore workflow-specific data
  restoreWorkflowData(workflow);

  // Update alternatives visibility based on workflow
  updateAlternativesForSelectedPart();

  // Switch to appropriate default tab
  if (workflow === 'servers') {
    switchTab('lenovo-asbuilt');
  } else {
    switchTab('summary');
  }

  // Store workflow preference
  sessionStorage.setItem('selectedWorkflow', workflow);
}

/***************************************************
 * Save/Restore Workflow Data
 ***************************************************/
function saveCurrentWorkflowData(skipInputSave = false) {
  const inputElement = document.getElementById('part-numbers');
  const currentInputValue = inputElement ? inputElement.value : '';

  if (currentWorkflow === 'servers') {
    serversWorkflowData.searchResults = { ...searchResults };
    serversWorkflowData.partAlternativesData = { ...partAlternativesData };
    serversWorkflowData.selectedPartNumber = selectedPartNumber;
    // Only save input value if not skipping (allows pre-setting before workflow switch)
    if (!skipInputSave) {
      serversWorkflowData.inputValue = currentInputValue;
    }
  } else if (currentWorkflow === 'parts') {
    partsWorkflowData.searchResults = { ...searchResults };
    partsWorkflowData.partAlternativesData = { ...partAlternativesData };
    partsWorkflowData.selectedPartNumber = selectedPartNumber;
    if (!skipInputSave) {
      partsWorkflowData.inputValue = currentInputValue;
    }
  }
}

function restoreWorkflowData(workflow) {
  let workflowData = workflow === 'servers' ? serversWorkflowData : partsWorkflowData;

  // Restore search results
  Object.keys(searchResults).forEach(key => {
    searchResults[key] = workflowData.searchResults[key] || [];
  });

  // Restore part alternatives data
  partAlternativesData = { ...workflowData.partAlternativesData };

  // Restore selected part number
  selectedPartNumber = workflowData.selectedPartNumber;

  // Restore input value
  const inputElement = document.getElementById('part-numbers');
  if (inputElement) {
    inputElement.value = workflowData.inputValue || '';
  }

  // Update dropdown
  updateWorkflowDropdown(workflow);

  // Refresh all UI
  refreshAllTabs();
}

function updateWorkflowDropdown(workflow) {
  const workflowData = workflow === 'servers' ? serversWorkflowData : partsWorkflowData;
  const selectId = workflow === 'servers' ? 'servers-select' : 'parts-select';
  const select = document.getElementById(selectId);

  if (!select) return;

  // Clear dropdown
  select.innerHTML = `<option value="">Select a ${workflow === 'servers' ? 'server' : 'part number'}</option>`;

  // Populate from partAlternativesData
  const items = Object.keys(workflowData.partAlternativesData);
  items.forEach(item => {
    const option = document.createElement('option');
    option.value = item;
    option.textContent = item;
    if (item === workflowData.selectedPartNumber) {
      option.selected = true;
    }
    select.appendChild(option);
  });
}

function handleDropdownChange(workflowType) {
  const selectId = workflowType === 'servers' ? 'servers-select' : 'parts-select';
  const select = document.getElementById(selectId);
  if (!select) return;

  selectedPartNumber = select.value || null;

  // Save to workflow data
  if (currentWorkflow === 'servers') {
    serversWorkflowData.selectedPartNumber = selectedPartNumber;
  } else {
    partsWorkflowData.selectedPartNumber = selectedPartNumber;
  }

  // Update alternatives display for the selected part
  updateAlternativesForSelectedPart();

  // Refresh all tabs to show selected part data
  refreshAllTabs();
}

function refreshAllTabs() {
  // Refresh based on current tab
  refreshCurrentTab();
}

/***************************************************
 * Configuration Variables
 ***************************************************/
var serverDomain = "workflows.haielab.org";
// You can override the domain or keep the same
// let serverDomain = "n8n.haielab.org";
// Master toggles for LLM model (if you want to set a default)
var llmModel = "gemini";
// If false => skip alt part number logic entirely
let configUseAlternatives = true;
// Default nested level is now 0 (only direct alternatives)
let configNestedLevel = 0;
// Track which part numbers have already been searched in Lenovo As-Built to avoid duplicates
let asBuiltSearched = new Set();
// Track which part numbers have already been searched in Lenovo Products to avoid duplicates
let warrantySearched = new Set();
// Flag to prevent loader from hiding while main search is in progress
let mainSearchInProgress = false;
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
 * Workflow-specific Data Stores
 ***************************************************/
// Servers workflow data
let serversWorkflowData = {
  searchResults: {
    lenovo: [],
    lenovoWarranty: [],
    lenovoParts: [],
    lenovoAsBuilt: [],
  },
  partAlternativesData: {},
  selectedPartNumber: null,
  searchedItems: [], // List of searched serials/parts for dropdown
  inputValue: '' // Stores the search input value for this workflow
};

// Parts workflow data
let partsWorkflowData = {
  searchResults: {
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
    lenovoPress: [],
    googleSearch: [],
  },
  partAlternativesData: {},
  selectedPartNumber: null,
  searchedItems: [], // List of searched parts for dropdown
  inputValue: '' // Stores the search input value for this workflow
};

/***************************************************
 * Global aggregator for endpoint results (active workflow)
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
  lenovoPress: [],
  googleSearch: [],
  lenovo: [],
  lenovoWarranty: [],
  lenovoParts: [],
  lenovoAsBuilt: [],
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
  mainSearchInProgress = false;
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
  const lenovoAsBuiltSubtabs = document.getElementById('lenovo-asbuilt-subtabs');
  const lenovoAsBuiltSubcontent = document.getElementById('lenovo-asbuilt-subcontent');
  const lenovoAsBuiltHeader = document.getElementById('lenovo-asbuilt-header');
  if (lenovoAsBuiltSubtabs) lenovoAsBuiltSubtabs.innerHTML = '';
  if (lenovoAsBuiltSubcontent) lenovoAsBuiltSubcontent.innerHTML = '';
  if (lenovoAsBuiltHeader) lenovoAsBuiltHeader.innerHTML = '';

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

  // Find and activate the corresponding tab button in the tabs bar
  const allTabButtons = document.querySelectorAll('.tab-button');
  allTabButtons.forEach(button => {
    const onclickAttr = button.getAttribute('onclick');
    if (onclickAttr && onclickAttr.includes(`'${tabId}'`)) {
      button.classList.add('active');
    }
  });

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
    case 'all':
      buildAllConsolidatedTable();
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
    case 'lenovo-asbuilt':
      buildLenovoAsBuiltUI();
      break;
    case 'lenovo-press':
      buildLenovoPressUI();
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
    case 'google-search':
      buildGoogleSearchTable();
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
    const response = await fetch(`https://${serverDomain}/webhook/get-parts-prioritized?item=${encodeURIComponent(partNumber)}`);
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
let checkIfAllDoneTimer = null;

function checkIfAllDone() {
  // Clear any existing timer
  if (checkIfAllDoneTimer) {
    clearTimeout(checkIfAllDoneTimer);
    checkIfAllDoneTimer = null;
  }

  // Basic checks
  if (mainSearchInProgress) return;
  if (expansionsInProgress) return;
  if (activeRequestsCount > 0) return;
  if (analysisAlreadyCalled) return;

  // Debounce with a small delay to ensure no requests are about to start
  checkIfAllDoneTimer = setTimeout(() => {
    // Double-check conditions after delay
    if (mainSearchInProgress) return;
    if (expansionsInProgress) return;
    if (activeRequestsCount > 0) return;
    if (analysisAlreadyCalled) return;

    analysisAlreadyCalled = true;
    // Don't hide spinner here - let performFinalAnalysis() hide it when done
    performFinalAnalysis();
  }, 500); // 500ms delay to catch any pending requests
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
    // Hide analysis progress indicator
    if (analysisProgress) {
      analysisProgress.style.display = 'none';
    }
    // Hide spinner and stop button now that analysis is complete
    const spinner = document.getElementById('loading-spinner');
    const stopBtn = document.getElementById('stop-search-btn');
    if (spinner) spinner.style.display = 'none';
    if (stopBtn) stopBtn.style.display = 'none';
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

  // Clear alternatives data for new search (workflow-specific)
  partAlternativesData = {};

  // Limpiar la interfaz
  cleanupUI();
  
  // Get part numbers from input
  const partNumberInputs = document.getElementById('part-numbers').value
  if (!partNumberInputs) {
    alert('part number input not found');
    return;
  }
  const partNumbersRaw = partNumberInputs.split(/,|\||\s+/);
  const partNumbers = new Set(partNumbersRaw.map(p => p.trim()).filter(p => p));
 
  if (partNumbers.size === 0) {
    alert('Please enter at least one part number');
    return;
  }
 
  // Convertir el Set a un array para poder acceder al primer elemento
  const partNumbersArray = Array.from(partNumbers);

  // Get correct dropdown based on current workflow
  const selectId = currentWorkflow === 'servers' ? 'servers-select' : 'parts-select';
  console.log('[handleSearch] Current workflow:', currentWorkflow);
  console.log('[handleSearch] Will populate dropdown:', selectId);
  console.log('[handleSearch] Part numbers to add:', partNumbersArray);
  const partsSelect = document.getElementById(selectId);

  if (partsSelect) {
    partsSelect.innerHTML = `<option value="">Select a ${currentWorkflow === 'servers' ? 'server' : 'part number'}</option>`;

    partNumbersArray.forEach((partNumber, index) => {
      console.log('[handleSearch] Adding to dropdown:', partNumber);
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
  }

  Object.keys(searchResults).forEach(k => {
    searchResults[k] = [];
  });
  activeRequestsCount = 0;
  expansionsInProgress = false;
  asBuiltSearched.clear(); // Clear the As-Built search tracking for new search
  warrantySearched.clear(); // Clear the Lenovo Products search tracking for new search
  const spinner = document.getElementById('loading-spinner');
  const stopBtn = document.getElementById('stop-search-btn');
  if (spinner) spinner.style.display = 'inline-block';
  if (stopBtn) stopBtn.style.display = 'inline-block';

  const globalAlreadySearched = new Set();

  try {
    // Set flag to prevent loader from hiding while main search is in progress
    mainSearchInProgress = true;

    // Search each part number IN PARALLEL for better performance
    await Promise.all(partNumbersArray.map(async (partNumber) => {
      if (stopSearchRequested) return;

      // Initialize alternatives array for this part
      const finalAlternatives = [];

      // START LENOVO AS-BUILT AND LENOVO PRODUCTS IMMEDIATELY (don't need alternatives from get-parts)
      // This allows these tabs to fetch data without waiting for the alternatives API
      fetchLenovoAsBuiltData([{ number: partNumber, source: partNumber }]);
      fetchLenovoWarrantyData([{ number: partNumber, source: partNumber }]);

      // For 'servers' workflow, skip get-parts call entirely
      if (currentWorkflow === 'servers') {
        // Just search with the original part number in Lenovo endpoints
        const partsToSearch = [{ number: partNumber, source: partNumber }];

        // Store minimal data for this part
        partAlternativesData[partNumber] = {
          description: null,
          category: null,
          original: partNumber,
          alternatives: []
        };

        // Execute Lenovo-only searches
        await executeEndpointSearches(partsToSearch);
        return; // Skip the rest of the parts workflow
      }

      // Get alternatives data for this specific part (only for 'parts' workflow)
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
          if (!globalAlreadySearched.has(altUpper)) {
            globalAlreadySearched.add(altUpper);
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

      globalAlreadySearched.add(topOriginal.trim().toUpperCase());
      await executeEndpointSearches([{ number: topOriginal, source: topOriginal }]);
    }));

    // Main search is complete, now allow loader to hide when all requests finish
    mainSearchInProgress = false;
    checkIfAllDone();

  } catch (err) {
    console.error('handleSearch error:', err);
    mainSearchInProgress = false;
  }
}
/***************************************************
 * Get all related part numbers (selected + all alternatives)
 ***************************************************/
function getAllRelatedPartNumbers(basePartNumber) {
  if (!basePartNumber) return [];

  const related = [basePartNumber];
  const partData = partAlternativesData[basePartNumber];

  if (partData && partData.alternatives && partData.alternatives.length > 0) {
    // Add all alternative part numbers with their type prefixes (e.g., "FRU: 00AD006")
    partData.alternatives.forEach(alt => {
      related.push(`${alt.type}: ${alt.value}`);
    });
  }

  return related;
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
/**
 * Extract description and category from distributor results when not available from alternatives
 */
function getDescriptionFromDistributors(partNumbers) {
  // PRIORITY ORDER (lower number = higher priority):
  // 1. Lenovo API (already checked in get-parts-prioritized)
  // 2. Lenovo Conversions (already checked in get-parts-prioritized)
  // 3. LSSC Sales (already checked in get-parts-prioritized)
  // 4. MFP Inventory (already checked in get-parts-prioritized)
  // 5. Ingram
  // 6. TDSynnex
  // 7. BrokerBin
  // 8. Google Search (last resort)

  // Convert to array if single part number
  const partsArray = Array.isArray(partNumbers) ? partNumbers : [partNumbers];

  console.log('[getDescriptionFromDistributors] Looking for parts:', partsArray);
  console.log('[getDescriptionFromDistributors] Available sources:', {
    lenovoPress: searchResults.lenovoPress?.length || 0,
    ingram: searchResults.ingram?.length || 0,
    brokerbin: searchResults.brokerbin?.length || 0,
    tdsynnex: searchResults.tdsynnex?.length || 0,
    googleSearch: searchResults.googleSearch?.length || 0
  });

  // Collect all descriptions with priority
  // Priority order: 1. Lenovo Press, 2. Ingram, 3. BrokerBin, 4. TDSynnex, 5. Google Search
  const descriptions = [];
  const categories = [];

  // Search through all related part numbers
  for (const partNumber of partsArray) {
    // Priority 1: Lenovo Press (highest priority)
    // Try to extract description from the HTML content table
    if (searchResults.lenovoPress && searchResults.lenovoPress.length > 0) {
      const lenovoPressResult = searchResults.lenovoPress.find(item =>
        item.sourcePartNumber === partNumber
      );
      if (lenovoPressResult) {
        console.log('[getDescriptionFromDistributors] Found in Lenovo Press:', lenovoPressResult);
        // Try to extract description from HTML content
        let extractedDescription = null;
        if (lenovoPressResult.content) {
          // Parse the HTML content to find the description
          // Look for the part number row and get the description column
          const tempDiv = document.createElement('div');
          tempDiv.innerHTML = lenovoPressResult.content;
          const rows = tempDiv.querySelectorAll('tr');
          for (const row of rows) {
            const cells = row.querySelectorAll('td');
            if (cells.length >= 3) {
              // Check if this row contains our part number
              const cellText = cells[0]?.textContent?.trim() || '';
              if (cellText === partNumber || cellText.includes(partNumber)) {
                // Description is typically in the 3rd column (index 2)
                extractedDescription = cells[2]?.textContent?.trim() || null;
                if (extractedDescription) break;
              }
            }
          }
        }
        if (extractedDescription && extractedDescription !== '-') {
          descriptions.push({
            value: extractedDescription,
            priority: 1,
            source: 'Lenovo Press',
            partNumber: partNumber
          });
        }
      }
    }

    // Priority 2: Ingram
    if (searchResults.ingram && searchResults.ingram.length > 0) {
      const ingramResult = searchResults.ingram.find(item =>
        item.vendorPartNumber === partNumber ||
        item.customerPartNumber === partNumber ||
        item.sourcePartNumber === partNumber
      );
      if (ingramResult) {
        console.log('[getDescriptionFromDistributors] Found in Ingram:', ingramResult);
        if (ingramResult.description && ingramResult.description !== '-') {
          descriptions.push({
            value: ingramResult.description,
            priority: 2,
            source: 'Ingram',
            partNumber: partNumber
          });
        }
        if (ingramResult.category && ingramResult.category !== '-') {
          categories.push({
            value: ingramResult.category,
            priority: 2,
            source: 'Ingram',
            partNumber: partNumber
          });
        }
      }
    }

    // Priority 3: BrokerBin
    if (searchResults.brokerbin && searchResults.brokerbin.length > 0) {
      const brokerbinResult = searchResults.brokerbin.find(item =>
        item.part === partNumber ||
        item.sourcePartNumber === partNumber
      );
      if (brokerbinResult) {
        console.log('[getDescriptionFromDistributors] Found in BrokerBin:', brokerbinResult);
        if (brokerbinResult.description && brokerbinResult.description !== '-') {
          descriptions.push({
            value: brokerbinResult.description,
            priority: 3,
            source: 'BrokerBin',
            partNumber: partNumber
          });
        }
      }
    }

    // Priority 4: TDSynnex
    if (searchResults.tdsynnex && searchResults.tdsynnex.length > 0) {
      const tdsynnexResult = searchResults.tdsynnex.find(item =>
        item.mfgPartNumber === partNumber ||
        item.synnexSKU === partNumber ||
        item.sourcePartNumber === partNumber
      );
      if (tdsynnexResult) {
        console.log('[getDescriptionFromDistributors] Found in TDSynnex:', tdsynnexResult);
        if (tdsynnexResult.description && tdsynnexResult.description !== '-') {
          descriptions.push({
            value: tdsynnexResult.description,
            priority: 4,
            source: 'TDSynnex',
            partNumber: partNumber
          });
        }
      }
    }

    // Priority 5: Google Search (last resort)
    if (searchResults.googleSearch && searchResults.googleSearch.length > 0) {
      const googleResult = searchResults.googleSearch.find(item =>
        item.partNumber === partNumber ||
        item.sourcePartNumber === partNumber
      );
      if (googleResult) {
        console.log('[getDescriptionFromDistributors] Found in Google Search:', googleResult);
        if (googleResult.title && googleResult.title !== '-') {
          descriptions.push({
            value: googleResult.title,
            priority: 5,
            source: 'Google Search',
            partNumber: partNumber
          });
        }
      }
    }
  }

  // Select best description based on priority
  let description = null;
  let category = null;

  if (descriptions.length > 0) {
    descriptions.sort((a, b) => a.priority - b.priority);
    description = descriptions[0].value;
    console.log(`[getDescriptionFromDistributors] Description from: ${descriptions[0].source} (priority ${descriptions[0].priority}) for part: ${descriptions[0].partNumber}`);
  }

  if (categories.length > 0) {
    categories.sort((a, b) => a.priority - b.priority);
    category = categories[0].value;
    console.log(`[getDescriptionFromDistributors] Category from: ${categories[0].source} (priority ${categories[0].priority}) for part: ${categories[0].partNumber}`);
  }

  console.log('[getDescriptionFromDistributors] Result:', { description, category });
  return { description, category };
}

function updateAlternativesForSelectedPart() {
  const altDiv = document.getElementById('alternative-numbers');
  if (!altDiv || !selectedPartNumber) return;

  // Hide alternatives section if we're in servers workflow
  if (currentWorkflow === 'servers') {
    altDiv.style.display = 'none';
    return;
  }

  // Show alternatives section for parts workflow
  altDiv.style.display = 'block';

  const partData = partAlternativesData[selectedPartNumber];
  if (!partData) {
    altDiv.innerHTML = '<p>No alternatives data available for this part.</p>';
    return;
  }

  console.log('[updateAlternativesForSelectedPart] Selected part:', selectedPartNumber);
  console.log('[updateAlternativesForSelectedPart] Part data from alternatives:', partData);

  // Always try to get the best description based on priority
  // Priority: Lenovo Press > Ingram > BrokerBin > TDSynnex > Google Search > partData
  let description = partData.description;
  let category = partData.category;

  console.log('[updateAlternativesForSelectedPart] Initial values from partData:', { description, category });

  // Get all related part numbers (selected + alternatives)
  const relatedParts = getAllRelatedPartNumbers(selectedPartNumber);
  console.log('[updateAlternativesForSelectedPart] Searching descriptions for parts:', relatedParts);

  const distributorInfo = getDescriptionFromDistributors(relatedParts);
  console.log('[updateAlternativesForSelectedPart] Distributor info:', distributorInfo);

  // Use distributor description if found (it has priority order built-in)
  if (distributorInfo.description) {
    description = distributorInfo.description;
  }
  if (distributorInfo.category) {
    category = distributorInfo.category;
  }

  console.log('[updateAlternativesForSelectedPart] Final values:', { description, category });

  let html = `
    <p><strong>Description:</strong> ${description || 'N/A'}</p>
    <p><strong>Category:</strong> ${category || 'N/A'}</p>
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
 * Add part number to search without re-searching existing parts
 ***************************************************/
async function addPartNumberToSearch(partNumber) {
  if (!partNumber || !partNumber.trim()) {
    alert('Invalid part number');
    return;
  }

  partNumber = partNumber.trim();

  console.log('[addPartNumberToSearch] Called with:', partNumber);
  console.log('[addPartNumberToSearch] Current workflow:', currentWorkflow);

  // If we're in 'servers' workflow and clicking a part link,
  // we want to search it in 'parts' workflow
  if (currentWorkflow === 'servers') {
    console.log('[addPartNumberToSearch] Switching to parts workflow and searching');

    // Add the part number to the PARTS input (not servers)
    // Calculate the new input value for parts workflow
    const currentPartsInputValue = partsWorkflowData.inputValue || '';
    let newPartsInputValue = currentPartsInputValue.trim();

    if (newPartsInputValue) {
      // Check if part number already exists in input (split by comma, pipe, or space)
      const existingParts = newPartsInputValue.split(/[,|\s]+/).map(p => p.trim()).filter(p => p);
      if (!existingParts.includes(partNumber)) {
        newPartsInputValue = newPartsInputValue + ' ' + partNumber;
      }
    } else {
      newPartsInputValue = partNumber;
    }

    // Save the NEW value directly to partsWorkflowData
    partsWorkflowData.inputValue = newPartsInputValue;

    searchPartNumber(partNumber);
    return;
  }

  // If already in 'parts' workflow, just add to dropdown and refresh
  const partsSelect = document.getElementById('parts-select');

  if (!partsSelect) return;

  // Check if part number already exists in dropdown
  const existingOptions = Array.from(partsSelect.options);
  const alreadyExists = existingOptions.some(opt => opt.value === partNumber);

  if (alreadyExists) {
    // If it exists, just select it
    selectedPartNumber = partNumber;
    partsSelect.value = partNumber;
    updateAlternativesForSelectedPart();
    refreshCurrentTab();
    return;
  }

  // Add to dropdown
  const option = document.createElement('option');
  option.value = partNumber;
  option.textContent = partNumber;
  option.selected = true;
  partsSelect.appendChild(option);

  // Update selected part number
  selectedPartNumber = partNumber;

  // Switch to summary tab
  switchTab('summary');

  // Clear summary content to show loading state
  const summaryDiv = document.getElementById('summary-content');
  if (summaryDiv) {
    summaryDiv.innerHTML = '<p>Loading data for new part number...</p>';
  }

  // Show loading indicator
  const spinner = document.getElementById('loading-spinner');
  if (spinner) spinner.style.display = 'inline-block';

  try {
    // Get alternatives data for this part
    const topData = await getAlternativePartNumbers(partNumber);
    const topOriginal = topData.original;

    // Store alternatives data for this part
    partAlternativesData[partNumber] = {
      description: topData.description,
      category: topData.category,
      original: topOriginal,
      alternatives: []
    };

    // Update UI for selected part
    updateAlternativesForSelectedPart();

    // Execute endpoint searches only for this new part
    await executeEndpointSearches([{ number: topOriginal, source: topOriginal }]);

    // Update summary and refresh current tab
    updateSummaryTab();
    refreshCurrentTab();
  } catch (err) {
    console.error('Error adding part number to search:', err);
    alert('Error adding part number to search: ' + err.message);
  } finally {
    if (spinner) spinner.style.display = 'none';
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
  // Sales and Purchases are only for 'parts' workflow
  if (currentWorkflow === 'parts') {
    tasks.push(fetchSalesData(partNumbers).finally(() => updateSummaryTab()));
    tasks.push(fetchPurchasesData(partNumbers).finally(() => updateSummaryTab()));
  }
  // Google Search for parts workflow
  if (currentWorkflow === 'parts' && document.getElementById('toggle-google-search').checked) {
    tasks.push(fetchGoogleSearchData(partNumbers).finally(() => updateSummaryTab()));
  }
  // Note: toggle-lenovo checkbox was removed - Lenovo tab not needed anymore
  if (document.getElementById('toggle-lenovo-warranty').checked) {
    tasks.push(fetchLenovoWarrantyData(partNumbers));
  }
  if (document.getElementById('toggle-lenovo-parts').checked) {
    tasks.push(fetchLenovoPartsData(partNumbers));
  }
  if (document.getElementById('toggle-lenovo-asbuilt').checked) {
    tasks.push(fetchLenovoAsBuiltData(partNumbers));
  }
  if (document.getElementById('toggle-lenovo-press').checked) {
    tasks.push(fetchLenovoPressData(partNumbers));
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
    buildAllConsolidatedTable();
    // Update alternatives display in case description/category are now available
    updateAlternativesForSelectedPart();
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
    const relatedParts = getAllRelatedPartNumbers(selectedPartNumber);
    allItems = allItems.filter(item => relatedParts.includes(item.sourcePartNumber));
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
    buildAllConsolidatedTable();
    // Update alternatives display in case description/category are now available
    updateAlternativesForSelectedPart();
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
    const relatedParts = getAllRelatedPartNumbers(selectedPartNumber);
    items = items.filter(item => relatedParts.includes(item.sourcePartNumber));
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
    buildAllConsolidatedTable();
    // Update alternatives display in case description/category are now available
    updateAlternativesForSelectedPart();
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
    const relatedParts = getAllRelatedPartNumbers(selectedPartNumber);
    items = items.filter(item => relatedParts.includes(item.sourcePartNumber));
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
    buildAllConsolidatedTable();
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
    const relatedParts = getAllRelatedPartNumbers(selectedPartNumber);
    allItems = allItems.filter(item => relatedParts.includes(item.sourcePartNumber));
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
    buildAllConsolidatedTable();
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
    const relatedParts = getAllRelatedPartNumbers(selectedPartNumber);
    items = items.filter(item => relatedParts.includes(item.sourcePartNumber));
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
    buildAllConsolidatedTable();
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
    const relatedParts = getAllRelatedPartNumbers(selectedPartNumber);
    allItems = allItems.filter(item => relatedParts.includes(item.sourcePartNumber));
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
    buildAllConsolidatedTable();
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
    const relatedParts = getAllRelatedPartNumbers(selectedPartNumber);
    items = items.filter(item => relatedParts.includes(item.sourcePartNumber));
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
    buildAllConsolidatedTable();
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
    const relatedParts = getAllRelatedPartNumbers(selectedPartNumber);
    items = items.filter(item => relatedParts.includes(item.sourcePartNumber));
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
    buildAllConsolidatedTable();
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
    const relatedParts = getAllRelatedPartNumbers(selectedPartNumber);
    items = items.filter(item => relatedParts.includes(item.sourcePartNumber));
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
// 10) eBay Browse API
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
        const resp = await fetch(`https://${serverDomain}/webhook/ebay-browse?item=${encodeURIComponent(number)}`);
        if (!resp.ok) continue;
        const data = await resp.json();

        // eBay Browse API returns data in { items: [...] } format
        if (data && data.items && Array.isArray(data.items)) {
          for (const item of data.items) {
            // Format price with currency
            let priceDisplay = '-';
            if (item.price) {
              priceDisplay = `${item.currency || 'USD'} $${item.price}`;
              if (item.shippingCost && item.shippingCost !== '0.0') {
                priceDisplay += ` (+$${item.shippingCost} shipping)`;
              }
            }

            newItems.push({
              sourcePartNumber: source,
              title: item.title || '-',
              rawPrice: priceDisplay,
              image: item.image || null,
              link: item.link || '#',
              condition: item.condition || 'Unknown',
              location: item.location || '',
              seller: item.sellerName || '',
              feedbackScore: item.feedbackScore || null
            });
          }
        }
      } catch (err) {
        console.warn('eBay Browse API error', err);
      }
    }
    searchResults.ebay.push(...newItems);
    buildEbayScraperTable();
    buildAllConsolidatedTable();
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
    const relatedParts = getAllRelatedPartNumbers(selectedPartNumber);
    items = items.filter(item => relatedParts.includes(item.sourcePartNumber));
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
        <th>Condition</th>
        <th>Price</th>
        <th>Seller</th>
        <th>Location</th>
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
          <td>${it.condition || '-'}</td>
          <td>${it.rawPrice}</td>
          <td>${it.seller || '-'}${it.feedbackScore ? ` (${it.feedbackScore})` : ''}</td>
          <td>${it.location || '-'}</td>
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
 * Google Search Data Fetching and UI
 ***************************************************/
async function fetchGoogleSearchData(partNumbers) {
  if (stopSearchRequested) return;
  activeRequestsCount++;

  const loading = document.querySelector('.google-search-results .loading');
  if (loading) loading.style.display = 'block';

  try {
    const newItems = [];
    for (const { number, source } of partNumbers) {
      if (stopSearchRequested) break;
      try {
        console.log(`Google Search: Searching for ${number}`);
        const res = await fetch(`https://${serverDomain}/webhook/google-search?item=${encodeURIComponent(number)}`);

        if (!res.ok) {
          console.warn(`Google Search: HTTP error ${res.status} for ${number}`);
          continue;
        }

        const data = await res.json();
        console.log(`Google Search: Raw response for ${number}:`, data);

        // Handle response - might be array directly or wrapped in an object
        let results = Array.isArray(data) ? data : (data.items || []);
        console.log(`Google Search: Received ${results.length} results for ${number}`);

        // Add source part number to each result
        const withSource = results.map(item => ({
          ...item,
          sourcePartNumber: source
        }));

        newItems.push(...withSource);
      } catch (err) {
        console.warn('Google Search error for', number, err);
      }
    }

    searchResults.googleSearch.push(...newItems);
    buildGoogleSearchTable();
    buildAllConsolidatedTable();
    // Update alternatives display in case description/category are now available
    updateAlternativesForSelectedPart();
  } catch (err) {
    console.error('fetchGoogleSearchData error:', err);
  } finally {
    if (loading) loading.style.display = 'none';
    activeRequestsCount--;
    checkIfAllDone();
  }
}

function buildGoogleSearchTable() {
  const resultsDiv = document.querySelector('.google-search-results .results-container');
  if (!resultsDiv) return;
  resultsDiv.innerHTML = '';

  let items = searchResults.googleSearch;
  console.log(`buildGoogleSearchTable: Total items before filter: ${items.length}`);
  console.log(`buildGoogleSearchTable: selectedPartNumber: ${selectedPartNumber}`);

  if (selectedPartNumber) {
    const relatedParts = getAllRelatedPartNumbers(selectedPartNumber);
    console.log(`buildGoogleSearchTable: relatedParts:`, relatedParts);
    console.log(`buildGoogleSearchTable: Sample item sourcePartNumber:`, items[0]?.sourcePartNumber);
    items = items.filter(item => relatedParts.includes(item.sourcePartNumber));
    console.log(`buildGoogleSearchTable: Items after filter: ${items.length}`);
  }

  if (items.length === 0) {
    resultsDiv.innerHTML = '<p>No Google search results available for selected part.</p>';
    return;
  }

  const table = document.createElement('table');
  table.innerHTML = `
    <thead>
      <tr>
        <th>Source Part</th>
        <th>Image</th>
        <th>Title</th>
        <th>Snippet</th>
        <th>Domain</th>
        <th>Link</th>
      </tr>
    </thead>
    <tbody>
      ${items.map(item => {
        // Check if image data exists (from pagemap or direct image field)
        let imageUrl = null;
        if (item.pagemap && item.pagemap.cse_thumbnail && item.pagemap.cse_thumbnail.length > 0) {
          imageUrl = item.pagemap.cse_thumbnail[0].src;
        } else if (item.pagemap && item.pagemap.cse_image && item.pagemap.cse_image.length > 0) {
          imageUrl = item.pagemap.cse_image[0].src;
        } else if (item.image) {
          imageUrl = item.image;
        }

        return `
        <tr>
          <td>${item.sourcePartNumber || '-'}</td>
          <td>${imageUrl ? `<img src="${imageUrl}" alt="Product" style="max-width: 80px; max-height: 80px; object-fit: contain;">` : '-'}</td>
          <td>${item.title || '-'}</td>
          <td>${item.snippet || '-'}</td>
          <td>${item.displayLink || '-'}</td>
          <td><a href="${item.link || '#'}" target="_blank">View</a></td>
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
    const relatedParts = getAllRelatedPartNumbers(selectedPartNumber);
    allResults = allResults.filter(doc => relatedParts.includes(doc.sourcePartNumber));
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

    // If no htmlSpecifications, show simple card with image, name, and id
    if (!doc.content) {
      contentDiv.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; padding: 20px; gap: 20px;">
          ${doc.image ? `<img src="${doc.image}" alt="${doc.title}" style="max-width: 300px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">` : ''}
          <div style="text-align: center;">
            <h3 style="margin: 0 0 10px 0; color: #333;">${doc.title}</h3>
            <p style="margin: 0; color: #666;">ID: ${doc.id}</p>
          </div>
        </div>
      `;
    } else {
      // If htmlSpecifications exists, show it with image at the top
      let processedContent = decodeUnicodeEscapes(doc.content);
      if (!processedContent.trim().toLowerCase().startsWith('<table')) {
        processedContent = `<table class="lenovo-data-table">${processedContent}</table>`;
      }
      contentDiv.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 20px; padding: 20px;">
          <div style="display: flex; align-items: flex-start; gap: 20px; padding: 15px; background: #f8f9fa; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
            ${doc.image ? `<img src="${doc.image}" alt="${doc.title}" style="max-width: 200px; height: auto; border-radius: 6px; box-shadow: 0 2px 6px rgba(0,0,0,0.1);">` : ''}
            <div style="flex: 1;">
              <h3 style="margin: 0 0 8px 0; color: #333; font-size: 1.3em;">${doc.title}</h3>
              <p style="margin: 0; color: #666; font-size: 0.95em;">Product ID: <strong>${doc.id}</strong></p>
            </div>
          </div>
          <div>${processedContent}</div>
        </div>
      `;
    }
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

      // Skip if we already searched this part number
      const numberUpper = number.trim().toUpperCase();
      if (warrantySearched.has(numberUpper)) {
        console.log(`Lenovo Products: Skipping ${number} (already searched)`);
        continue;
      }
      warrantySearched.add(numberUpper);

      try {
        const response = await fetch(`https://${serverDomain}/webhook/lenovo-api/product?item=${encodeURIComponent(number)}`);
        if (!response.ok) continue;
        const data = await response.json();

          const doc = {
            id: data[0].id || 'Unknown ID',
            title: data[0].product || 'Untitled Document',
            content: data[0].htmlSpecifications ?? null,
            image: data[0].image || null,
            sourcePartNumber: source
          };
          searchResults.lenovoWarranty.push(doc);

      } catch (error) {
        console.warn(`Lenovo Warranty error for ${number}:`, error);
      }
    }
    buildLenovoWarrantyUI();
    buildAllConsolidatedTable();
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
  const subtabs = document.getElementById('lenovo-warranty-subtabs');
  const subcontent = document.getElementById('lenovo-warranty-subcontent');
  if (!subtabs || !subcontent) return;

  subtabs.querySelectorAll('.subtab-button').forEach(btn => btn.classList.remove('active'));
  subcontent.querySelectorAll('.subtab-content').forEach(c => c.classList.remove('active'));

  const buttons = subtabs.querySelectorAll('.subtab-button');
  const contents = subcontent.querySelectorAll('.subtab-content');

  if (buttons[index]) buttons[index].classList.add('active');
  if (contents[index]) contents[index].classList.add('active');
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
    const relatedParts = getAllRelatedPartNumbers(selectedPartNumber);
    allResults = allResults.filter(doc => relatedParts.includes(doc.sourcePartNumber));
  }
  if (!allResults || allResults.length === 0) {
    subtabs.innerHTML = '<div class="error">No Lenovo Parts data found for selected part</div>';
    return;
  }

  // Add header with download button
  let headerDiv = document.getElementById('lenovo-parts-header');
  if (!headerDiv) {
    headerDiv = document.createElement('div');
    headerDiv.id = 'lenovo-parts-header';
    lenovoPartsDiv.insertBefore(headerDiv, subtabs);
  }
  headerDiv.innerHTML = `
    <div style="display: flex; justify-content: flex-end; align-items: center; margin-bottom: 10px;">
      <button onclick="downloadLenovoPartsListExcel()" style="padding: 8px 16px; background: #2563eb; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 14px; font-weight: 500; display: flex; align-items: center; gap: 6px; white-space: nowrap;">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
          <polyline points="7 10 12 15 17 10"></polyline>
          <line x1="12" y1="15" x2="12" y2="3"></line>
        </svg>
        Download Parts List
      </button>
    </div>
  `;

  allResults.forEach((doc, index) => {
    const subtabButton = document.createElement('button');
    subtabButton.className = `subtab-button ${index === 0 ? 'active' : ''}`;
    subtabButton.textContent = doc.sourcePartNumber;
    subtabButton.onclick = () => switchLenovoPartsSubtab(index);
    subtabs.appendChild(subtabButton);
    const contentDiv = document.createElement('div');
    contentDiv.className = `subtab-content ${index === 0 ? 'active' : ''}`;
    contentDiv.setAttribute('data-subtab-index', index);

    // Filter out parts that start with (PPN), have N/A id, or both type and name are N/A
    const filteredParts = doc.parts.filter(part => {
      const partId = part.id || '';
      const partType = part.type || 'N/A';
      const partName = part.name || 'N/A';

      // Exclude if ID starts with (PPN)
      if (partId.startsWith('(PPN)')) return false;

      // Exclude if ID is N/A
      if (partId === 'N/A' || partId === '') return false;

      // Exclude if both type and name are N/A
      if (partType === 'N/A' && partName === 'N/A') return false;

      return true;
    });

    // Build paginated table for parts
    const itemsPerPage = 50;
    const totalPages = Math.ceil(filteredParts.length / itemsPerPage);

    function renderPartsPage(page) {
      const start = page * itemsPerPage;
      const end = start + itemsPerPage;
      const pageParts = filteredParts.slice(start, end);

      let tableHTML = `
        <div class="pagination-info">
          <p>Showing ${start + 1} to ${Math.min(end, filteredParts.length)} of ${filteredParts.length} parts</p>
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
        const partId = part.id || 'N/A';
        const isClickable = partId !== 'N/A';
        tableHTML += `
          <tr>
            <td>${isClickable ? `<a href="#" class="part-id-link" data-part-id="${partId}" style="color: #007bff; text-decoration: underline; cursor: pointer;">${partId}</a>` : partId}</td>
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

    // Add event delegation for pagination and part ID clicks
    wrapper.addEventListener('click', (e) => {
      if (e.target.classList.contains('page-btn')) {
        const newPage = parseInt(e.target.dataset.page);
        wrapper.innerHTML = renderPartsPage(newPage);
      } else if (e.target.classList.contains('part-id-link')) {
        e.preventDefault();
        const partId = e.target.dataset.partId;
        addPartNumberToSearch(partId);
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
    buildAllConsolidatedTable();
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
 * Lenovo As-Built UI and Data Fetching
 ***************************************************/
async function fetchLenovoAsBuiltData(partNumbers) {
  if (stopSearchRequested) return;
  if (!document.getElementById('toggle-lenovo-asbuilt').checked) return;
  activeRequestsCount++;
  try {
    for (const { number, source } of partNumbers) {
      if (stopSearchRequested) break;

      // Skip if we already searched this part number
      const numberUpper = number.trim().toUpperCase();
      if (asBuiltSearched.has(numberUpper)) {
        console.log(`Lenovo As-Built: Skipping ${number} (already searched)`);
        continue;
      }
      asBuiltSearched.add(numberUpper);

      try {
        const response = await fetch(`https://${serverDomain}/webhook/lenovo-parts?item=${encodeURIComponent(number)}`);
        if (!response.ok) continue;
        const data = await response.json();
        if (data && data.products && Array.isArray(data.products) && data.products.length > 0) {
          const doc = {
            sourcePartNumber: source,
            products: data.products
          };
          searchResults.lenovoAsBuilt.push(doc);
        }
      } catch (error) {
        console.warn(`Lenovo As-Built error for ${number}:`, error);
      }
    }
    buildLenovoAsBuiltUI();
    buildAllConsolidatedTable();
  } catch (err) {
    console.error('Lenovo As-Built data fetch error:', err);
    if (!searchResults.lenovoAsBuilt.length) {
      const subtabs = document.getElementById('lenovo-asbuilt-subtabs');
      if (subtabs) {
        subtabs.innerHTML = `<div class="error">Error fetching Lenovo As-Built data: ${err.message}</div>`;
      }
    }
  } finally {
    activeRequestsCount--;
    checkIfAllDone();
  }
}

function buildLenovoAsBuiltUI() {
  const lenovoAsBuiltDiv = document.getElementById('lenovo-asbuilt-content');
  if (!lenovoAsBuiltDiv) return;

  // Create or get header section
  let headerSection = document.getElementById('lenovo-asbuilt-header');
  if (!headerSection) {
    headerSection = document.createElement('div');
    headerSection.id = 'lenovo-asbuilt-header';
    headerSection.className = 'lenovo-asbuilt-header';
    lenovoAsBuiltDiv.insertBefore(headerSection, lenovoAsBuiltDiv.firstChild);
  }

  let subtabs = document.getElementById('lenovo-asbuilt-subtabs');
  let subcontent = document.getElementById('lenovo-asbuilt-subcontent');
  if (!subtabs) {
    subtabs = document.createElement('div');
    subtabs.id = 'lenovo-asbuilt-subtabs';
    subtabs.className = 'subtabs';
    lenovoAsBuiltDiv.appendChild(subtabs);
  }
  if (!subcontent) {
    subcontent = document.createElement('div');
    subcontent.id = 'lenovo-asbuilt-subcontent';
    lenovoAsBuiltDiv.appendChild(subcontent);
  }

  // Build header with product info from lenovoWarranty data
  let warrantyData = searchResults.lenovoWarranty;
  if (selectedPartNumber) {
    const relatedParts = getAllRelatedPartNumbers(selectedPartNumber);
    warrantyData = warrantyData.filter(doc => relatedParts.includes(doc.sourcePartNumber));
  }

  if (warrantyData && warrantyData.length > 0) {
    const doc = warrantyData[0]; // Use first result
    const title = doc.title || 'Product Information';
    const cleanTitle = typeof title === 'string'
      ? title.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim()
      : 'Product Information';

    headerSection.innerHTML = `
      <div style="display: flex; align-items: flex-start; gap: 20px; padding: 20px; background: #f8f9fa; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); margin-bottom: 20px;">
        ${doc.image ? `<img src="${doc.image}" alt="${cleanTitle}" style="max-width: 200px; height: auto; border-radius: 6px; box-shadow: 0 2px 6px rgba(0,0,0,0.1);">` : ''}
        <div style="flex: 1;">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 15px; margin-bottom: 10px;">
            <h3 style="margin: 0; color: #333; font-size: 1.4em;">${cleanTitle}</h3>
            <button onclick="downloadAsBuiltPartsListExcel()" style="padding: 8px 16px; background: #2563eb; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 14px; font-weight: 500; display: flex; align-items: center; gap: 6px; white-space: nowrap;">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
              Download Parts List
            </button>
          </div>
          <div style="display: grid; grid-template-columns: auto 1fr; gap: 8px 15px; font-size: 0.95em; align-items: center;">
            <span style="font-weight: 600; color: #6b7280;">Serial Number:</span>
            <span style="color: #1f2937;">${doc.sourcePartNumber || 'N/A'}</span>
            ${doc.id ? `
              <span style="font-weight: 600; color: #6b7280;">Product ID:</span>
              <span style="color: #1f2937;">${doc.id}</span>
            ` : ''}
            <span style="font-weight: 600; color: #6b7280;">Filter:</span>
            <div style="position: relative; display: flex; align-items: center; max-width: 400px;">
              <input
                type="text"
                id="asbuilt-filter-input"
                placeholder="Search by part number..."
                style="padding: 8px 35px 8px 12px; border: 1px solid #d1d5db; border-radius: 4px; font-size: 14px; width: 100%; outline: none; transition: border-color 0.2s;"
                oninput="debouncedFilterAsBuiltProducts()"
              />
              <div style="position: absolute; right: 8px; top: 30%; transform: translateY(-30%); display: flex; align-items: center; justify-content: center; pointer-events: none;">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: #9ca3af;">
                  <circle cx="11" cy="11" r="8"></circle>
                  <path d="m21 21-4.35-4.35"></path>
                </svg>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  } else {
    headerSection.innerHTML = '';
  }

  subtabs.innerHTML = '';
  subcontent.innerHTML = '';

  let allResults = searchResults.lenovoAsBuilt;
  if (selectedPartNumber) {
    const relatedParts = getAllRelatedPartNumbers(selectedPartNumber);
    allResults = allResults.filter(doc => relatedParts.includes(doc.sourcePartNumber));
  }
  if (!allResults || allResults.length === 0) {
    subtabs.innerHTML = '<div class="error">No Lenovo As-Built data found for selected part</div>';
    return;
  }
  allResults.forEach((doc, index) => {
    const subtabButton = document.createElement('button');
    subtabButton.className = `subtab-button ${index === 0 ? 'active' : ''}`;
    subtabButton.textContent = doc.sourcePartNumber;
    subtabButton.onclick = () => switchLenovoAsBuiltSubtab(index);
    subtabs.appendChild(subtabButton);
    const contentDiv = document.createElement('div');
    contentDiv.className = `subtab-content ${index === 0 ? 'active' : ''}`;
    contentDiv.setAttribute('data-subtab-index', index);

    const itemsPerPage = 10;

    // Store original products and current filtered products
    let currentProducts = doc.products;
    let currentFilterTerm = '';

    function generatePaginationNumbers(currentPage, totalPages) {
      const pages = [];
      const maxVisible = 7; // Maximum number of page buttons to show

      if (totalPages <= maxVisible) {
        // Show all pages if total is small
        for (let i = 0; i < totalPages; i++) {
          pages.push(i);
        }
      } else {
        // Always show first page
        pages.push(0);

        let startPage = Math.max(1, currentPage - 2);
        let endPage = Math.min(totalPages - 2, currentPage + 2);

        // Add ellipsis after first page if needed
        if (startPage > 1) {
          pages.push('...');
        }

        // Add middle pages
        for (let i = startPage; i <= endPage; i++) {
          pages.push(i);
        }

        // Add ellipsis before last page if needed
        if (endPage < totalPages - 2) {
          pages.push('...');
        }

        // Always show last page
        pages.push(totalPages - 1);
      }

      return pages;
    }

    function renderProductsPage(page) {
      const start = page * itemsPerPage;
      const end = start + itemsPerPage;
      const pageProducts = currentProducts.slice(start, end);

      let html = `
        <div class="pagination-info" style="margin-bottom: 15px; color: #6b7280;">
          <p>Showing ${start + 1} to ${Math.min(end, currentProducts.length)} of ${currentProducts.length} products${currentFilterTerm ? ' (filtered)' : ''}</p>
        </div>
      `;

      pageProducts.forEach(product => {
        const mainImage = product.imageUrls && product.imageUrls[0] ? product.imageUrls[0] : '';
        const imageCount = product.imageUrls ? product.imageUrls.length : 0;
        const cruTierMap = {
          '1': 'CRU Mandatory',
          '2': 'Optional',
          '9': 'FRU Only',
          '10': 'Serviceable'
        };
        const serviceableText = cruTierMap[product.cruTier] || 'N/A';

        html += `
          <div class="lenovo-product-card" data-product-id="${product.id}">
            <div class="product-header">
              <div class="product-image-container" style="position: relative;">
                ${mainImage ? `<img src="${mainImage}" alt="${product.name}" class="product-main-image clickable-image" data-image-src="${mainImage}" onerror="this.src='data:image/svg+xml,%3Csvg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'150\\' height=\\'150\\'%3E%3Crect fill=\\'%23f3f4f6\\' width=\\'150\\' height=\\'150\\'/%3E%3Ctext x=\\'50%25\\' y=\\'50%25\\' dominant-baseline=\\'middle\\' text-anchor=\\'middle\\' font-family=\\'Arial\\' font-size=\\'14\\' fill=\\'%236b7280\\'%3ENo Image%3C/text%3E%3C/svg%3E';" />` : `<div class="product-main-image" style="display:flex;align-items:center;justify-content:center;color:#6b7280;">No Image</div>`}
                ${imageCount > 1 ? `<div class="image-count-badge toggle-gallery">📷 (${imageCount})</div>` : ''}
              </div>
              <div class="product-info">
                <h3>${product.name || 'N/A'}</h3>
                <div class="product-details">
                  <span class="detail-label">Part No</span>
                  <span class="detail-value">${product.id || 'N/A'}</span>
                  <span class="detail-label">Commodity</span>
                  <span class="detail-value">${product.commodity || 'N/A'}</span>
                  ${product.mfgPart ? `
                    <span class="detail-label">Mfg Part</span>
                    <span class="detail-value"><a href="#" class="mfg-part-link" onclick="showBarcodeModal('${encodeURIComponent(JSON.stringify({
                      mfgPart: product.mfgPart,
                      mfgParts: product.mfgParts || [],
                      barCodes: product.barCodes || []
                    }))}'); return false;">${product.mfgPart}</a></span>
                  ` : ''}
                  ${product.installed ? `
                    <span class="detail-label">Installed</span>
                    <span class="detail-value">${product.installed}</span>
                  ` : ''}
                  <span class="detail-label">Compatible Models</span>
                  <span class="detail-value">${product.compatibleModelsCount || 0}</span>
                  <span class="detail-label">Serviceable</span>
                  <span class="detail-value">${serviceableText}</span>
                </div>
              </div>
            </div>
        `;

        // Add image gallery if there are multiple images
        if (imageCount > 1) {
          html += `
            <div class="image-gallery">
              <div class="gallery-header">
                <span class="gallery-title">Pictures</span>
                <button class="gallery-close-btn toggle-gallery">✕</button>
              </div>
              <div class="gallery-images">
                ${product.imageUrls.map(imgUrl => `
                  <div class="gallery-image-item">
                    <img src="${imgUrl}" alt="${product.name}" class="clickable-image" data-image-src="${imgUrl}" />
                  </div>
                `).join('')}
              </div>
            </div>
          `;
        }

        html += ``;

        if (product.substitutes && product.substitutes.length > 0) {
          html += `
            <div class="product-tabs">
              <button class="product-tab-btn collapsed toggle-substitutes">Substitutes (${product.substitutes.length})</button>
            </div>
            <div class="substitutes-content">
              <table class="substitutes-table">
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Part No</th>
                    <th>Sub Type</th>
                    <th>Compatible Models</th>
                    <th>Photo</th>
                  </tr>
                </thead>
                <tbody>
          `;

          product.substitutes.forEach((sub, subIndex) => {
            const subImage = sub.imageUrls && sub.imageUrls[0] ? sub.imageUrls[0] : '';
            const subImageCount = sub.imageUrls ? sub.imageUrls.length : 0;
            html += `
              <tr data-substitute-index="${subIndex}">
                <td>${sub.name || 'N/A'}</td>
                <td><a href="#" class="part-id-link" data-part-id="${sub.id}" style="color: #2563eb; text-decoration: underline; cursor: pointer;">${sub.id || 'N/A'}</a></td>
                <td><span class="sub-type-badge">${sub.type || 'N/A'}</span></td>
                <td>
                  ${sub.compatibleModelsCount || 0}
                  ${sub.compatibleModelsCount !== product.compatibleModelsCount ?
                    `<span class="models-badge">${sub.compatibleModelsCount}/${product.compatibleModelsCount}</span>` :
                    `<span class="models-badge" style="background:#dcfce7;color:#166534;">✓ Match</span>`
                  }
                </td>
                <td>
                  ${subImage ? `
                    <div style="position: relative; display: inline-block;">
                      <img src="${subImage}" alt="${sub.name}" class="substitute-image clickable-image" data-image-src="${subImage}" />
                      ${subImageCount > 1 ? `<div class="image-count-badge toggle-substitute-gallery" data-substitute-index="${subIndex}" style="position: absolute; bottom: 2px; right: 2px; font-size: 10px; padding: 2px 6px;">📷 ${subImageCount}</div>` : ''}
                    </div>
                  ` : 'N/A'}
                </td>
              </tr>
            `;

            // Add image gallery for substitute if there are multiple images
            if (subImageCount > 1) {
              html += `
                <tr class="substitute-gallery-row" data-substitute-index="${subIndex}" style="display: none;">
                  <td colspan="5">
                    <div class="image-gallery expanded" style="margin: 10px 0;">
                      <div class="gallery-header">
                        <span class="gallery-title">Pictures - ${sub.id}</span>
                        <button class="gallery-close-btn toggle-substitute-gallery" data-substitute-index="${subIndex}">✕</button>
                      </div>
                      <div class="gallery-images">
                        ${sub.imageUrls.map(imgUrl => `
                          <div class="gallery-image-item">
                            <img src="${imgUrl}" alt="${sub.name}" class="clickable-image" data-image-src="${imgUrl}" />
                          </div>
                        `).join('')}
                      </div>
                    </div>
                  </td>
                </tr>
              `;
            }
          });

          html += `
                </tbody>
              </table>
            </div>
          `;
        } else {
          html += `<p style="color: #6b7280; padding: 10px 0;">No substitutes available</p>`;
        }

        html += `</div>`;
      });

      // Add pagination controls
      const totalPages = Math.ceil(currentProducts.length / itemsPerPage);
      if (totalPages > 1) {
        html += '<div class="product-pagination">';

        // Previous button
        if (page > 0) {
          html += `<button class="page-btn" data-page="${page - 1}" style="padding: 8px 12px; border: 1px solid #d1d5db; background: white; color: #374151; border-radius: 4px; cursor: pointer; font-weight: 500;">← Previous</button>`;
        }

        // Page numbers
        const pageNumbers = generatePaginationNumbers(page, totalPages);
        pageNumbers.forEach(pageNum => {
          if (pageNum === '...') {
            html += `<span style="padding: 8px 4px; color: #6b7280;">...</span>`;
          } else {
            const isActive = pageNum === page;
            const activeStyles = isActive
              ? 'background: #2563eb; color: white; border-color: #2563eb;'
              : 'background: white; color: #374151; border-color: #d1d5db;';
            html += `<button class="page-btn ${isActive ? 'active' : ''}" data-page="${pageNum}" style="padding: 8px 12px; border: 1px solid; border-radius: 4px; cursor: pointer; min-width: 40px; font-weight: 500; ${activeStyles}">${pageNum + 1}</button>`;
          }
        });

        // Next button
        if (page < totalPages - 1) {
          html += `<button class="page-btn" data-page="${page + 1}" style="padding: 8px 12px; border: 1px solid #d1d5db; background: white; color: #374151; border-radius: 4px; cursor: pointer; font-weight: 500;">Next →</button>`;
        }

        html += '</div>';
      }

      return html;
    }

    // Function to apply filter and re-render
    function applyFilter(searchTerm) {
      currentFilterTerm = searchTerm;

      if (!searchTerm) {
        // No filter, show all products
        currentProducts = doc.products;
      } else {
        // Filter products based on search term
        const term = searchTerm.toLowerCase();
        currentProducts = doc.products.filter(product => {
          // Search in product ID
          if (product.id && product.id.toLowerCase().includes(term)) {
            return true;
          }

          // Search in substitute part numbers
          if (product.substitutes && product.substitutes.length > 0) {
            return product.substitutes.some(sub =>
              sub.id && sub.id.toLowerCase().includes(term)
            );
          }

          return false;
        });
      }

      // Re-render first page with filtered products
      wrapper.innerHTML = renderProductsPage(0);
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'asbuilt-content-wrapper';
    wrapper.innerHTML = renderProductsPage(0);

    // Store the filter function on the wrapper so it can be called externally
    wrapper.applyFilter = applyFilter;

    wrapper.addEventListener('click', (e) => {
      if (e.target.classList.contains('page-btn')) {
        const newPage = parseInt(e.target.dataset.page);
        wrapper.innerHTML = renderProductsPage(newPage);
      } else if (e.target.classList.contains('part-id-link')) {
        e.preventDefault();
        const partId = e.target.dataset.partId;
        addPartNumberToSearch(partId);
      } else if (e.target.classList.contains('clickable-image')) {
        const imageSrc = e.target.dataset.imageSrc;
        if (imageSrc) {
          openImageModal(imageSrc, e.target);
        }
      } else if (e.target.classList.contains('toggle-substitutes')) {
        e.target.classList.toggle('collapsed');
        const substitutesContent = e.target.closest('.lenovo-product-card').querySelector('.substitutes-content');
        if (substitutesContent) {
          substitutesContent.classList.toggle('expanded');
        }
      } else if (e.target.classList.contains('toggle-gallery')) {
        const productCard = e.target.closest('.lenovo-product-card');
        const gallery = productCard.querySelector('.image-gallery');
        if (gallery) {
          gallery.classList.toggle('expanded');
        }
      } else if (e.target.classList.contains('toggle-substitute-gallery')) {
        const substituteIndex = e.target.dataset.substituteIndex;
        const galleryRow = wrapper.querySelector(`.substitute-gallery-row[data-substitute-index="${substituteIndex}"]`);
        if (galleryRow) {
          if (galleryRow.style.display === 'none') {
            galleryRow.style.display = 'table-row';
          } else {
            galleryRow.style.display = 'none';
          }
        }
      }
    });

    contentDiv.appendChild(wrapper);
    subcontent.appendChild(contentDiv);
  });
}

function switchLenovoAsBuiltSubtab(index) {
  const subtabs = document.getElementById('lenovo-asbuilt-subtabs');
  const subcontent = document.getElementById('lenovo-asbuilt-subcontent');
  if (!subtabs || !subcontent) return;

  subtabs.querySelectorAll('.subtab-button').forEach(btn => btn.classList.remove('active'));
  subcontent.querySelectorAll('.subtab-content').forEach(c => c.classList.remove('active'));

  const buttons = subtabs.querySelectorAll('.subtab-button');
  const contents = subcontent.querySelectorAll('.subtab-content');

  if (buttons[index]) buttons[index].classList.add('active');
  if (contents[index]) contents[index].classList.add('active');

  // Clear the filter input when switching tabs
  const filterInput = document.getElementById('asbuilt-filter-input');
  if (filterInput) {
    filterInput.value = '';
  }

  // Apply empty filter to show all products in the new tab
  const activeWrapper = subcontent.querySelector('.subtab-content.active .asbuilt-content-wrapper');
  if (activeWrapper && typeof activeWrapper.applyFilter === 'function') {
    activeWrapper.applyFilter('');
  }
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
    const relatedParts = getAllRelatedPartNumbers(selectedPartNumber);
    allResults = allResults.filter(doc => relatedParts.includes(doc.sourcePartNumber));
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
  // Lenovo tab removed - this function is no longer called
  return;
  
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
    buildAllConsolidatedTable();
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
  const subtabs = document.getElementById('lenovo-subtabs');
  const subcontent = document.getElementById('lenovo-subcontent');
  if (!subtabs || !subcontent) return;

  subtabs.querySelectorAll('.subtab-button').forEach(btn => btn.classList.remove('active'));
  subcontent.querySelectorAll('.subtab-content').forEach(c => c.classList.remove('active'));

  const buttons = subtabs.querySelectorAll('.subtab-button');
  const contents = subcontent.querySelectorAll('.subtab-content');

  if (buttons[index]) buttons[index].classList.add('active');
  if (contents[index]) contents[index].classList.add('active');
}

/***************************************************
 * Lenovo Press UI and Data Fetching (PARTS workflow)
 ***************************************************/
function buildLenovoPressUI() {
  const lenovoPressContentDiv = document.getElementById('lenovo-press-content');
  if (!lenovoPressContentDiv) return;
  let subtabs = document.getElementById('lenovo-press-subtabs');
  let subcontent = document.getElementById('lenovo-press-subcontent');
  if (!subtabs) {
    subtabs = document.createElement('div');
    subtabs.id = 'lenovo-press-subtabs';
    subtabs.className = 'subtabs';
    lenovoPressContentDiv.appendChild(subtabs);
  }
  if (!subcontent) {
    subcontent = document.createElement('div');
    subcontent.id = 'lenovo-press-subcontent';
    lenovoPressContentDiv.appendChild(subcontent);
  }
  subtabs.innerHTML = '';
  subcontent.innerHTML = '';
  let allResults = searchResults.lenovoPress;
  if (selectedPartNumber) {
    const relatedParts = getAllRelatedPartNumbers(selectedPartNumber);
    allResults = allResults.filter(doc => relatedParts.includes(doc.sourcePartNumber));
  }
  if (!allResults || allResults.length === 0) {
    subtabs.innerHTML = '<div class="error">No Lenovo Press data found for selected part</div>';
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
    subtabButton.onclick = () => switchLenovoPressSubtab(index);
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
async function fetchLenovoPressData(partNumbers) {
  if (stopSearchRequested) return;
  activeRequestsCount++;
  if (!document.getElementById('toggle-lenovo-press').checked) return;
  
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
          searchResults.lenovoPress.push(...docs);
        }
      } catch (error) {
        console.warn(`Lenovo Press error for ${number}:`, error);
      }
    }
    buildLenovoPressUI();
    buildAllConsolidatedTable();
    // Update description since Lenovo Press has highest priority
    updateAlternativesForSelectedPart();
  } catch (err) {
    console.error('Lenovo Press data fetch error:', err);
    if (!searchResults.lenovoPress.length) {
      const subtabs = document.getElementById('lenovo-press-subtabs');
      if (subtabs) {
        subtabs.innerHTML = `<div class="error">Error fetching Lenovo Press data: ${err.message}</div>`;
      }
    }
  } finally {
    
    activeRequestsCount--;
    checkIfAllDone();
  }
}
function switchLenovoPressSubtab(index) {
  const subtabs = document.getElementById('lenovo-press-subtabs');
  const subcontent = document.getElementById('lenovo-press-subcontent');
  if (!subtabs || !subcontent) return;

  subtabs.querySelectorAll('.subtab-button').forEach(btn => btn.classList.remove('active'));
  subcontent.querySelectorAll('.subtab-content').forEach(c => c.classList.remove('active'));

  const buttons = subtabs.querySelectorAll('.subtab-button');
  const contents = subcontent.querySelectorAll('.subtab-content');

  if (buttons[index]) buttons[index].classList.add('active');
  if (contents[index]) contents[index].classList.add('active');
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
      const relatedParts = getAllRelatedPartNumbers(selectedPartNumber);
      dataArray = dataArray.filter(item => relatedParts.includes(item.sourcePartNumber));
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

/***************************************************
 * Image Modal Functions with Gallery Navigation
 ***************************************************/
let galleryImages = [];
let currentImageIndex = 0;
let currentZoomLevel = 0; // 0 = no zoom, 1 = 2x, 2 = 3x
let isPanning = false;
let panStartX = 0;
let panStartY = 0;
let panCurrentX = 0;
let panCurrentY = 0;

function collectGalleryImages(clickedElement) {
  // Collect images only from the same product context as the clicked image
  const images = [];

  // Check if the clicked image is inside a substitute gallery row
  const substituteGalleryRow = clickedElement.closest('.substitute-gallery-row');

  if (substituteGalleryRow) {
    // We're inside a substitute gallery, collect only those images
    // Find the substitute data row (the row before this gallery row)
    const substituteIndex = substituteGalleryRow.dataset.substituteIndex;
    const substituteDataRow = document.querySelector(`tr[data-substitute-index="${substituteIndex}"]:not(.substitute-gallery-row)`);

    let productInfo = null;
    if (substituteDataRow) {
      const cells = substituteDataRow.querySelectorAll('td');
      productInfo = {
        name: cells[0]?.textContent || 'Substitute Product',
        id: cells[1]?.querySelector('.part-id-link')?.textContent || 'N/A',
        type: cells[2]?.querySelector('.sub-type-badge')?.textContent || 'N/A',
        compatibleModels: cells[3]?.textContent?.trim().split('\n')[0]?.trim() || '0'
      };
    }

    const gallery = substituteGalleryRow.querySelector('.image-gallery');
    if (gallery) {
      gallery.querySelectorAll('.clickable-image').forEach(img => {
        const imageSrc = img.dataset.imageSrc;
        if (imageSrc) {
          images.push({
            src: imageSrc,
            productInfo: productInfo
          });
        }
      });
    }

    return images.length > 0 ? images : [{
      src: clickedElement.dataset.imageSrc,
      productInfo: productInfo
    }];
  }

  // Check if the clicked image is a substitute main image (not in gallery)
  const isSubstituteImage = clickedElement.classList.contains('substitute-image');

  if (isSubstituteImage) {
    // Find the substitute row
    const substituteRow = clickedElement.closest('tr');

    if (substituteRow) {
      // Extract substitute info from the row cells
      const cells = substituteRow.querySelectorAll('td');
      const productInfo = {
        name: cells[0]?.textContent || 'Substitute Product',
        id: cells[1]?.querySelector('.part-id-link')?.textContent || 'N/A',
        type: cells[2]?.querySelector('.sub-type-badge')?.textContent || 'N/A',
        compatibleModels: cells[3]?.textContent?.trim().split('\n')[0]?.trim() || '0'
      };

      // First, add the main substitute image
      images.push({
        src: clickedElement.dataset.imageSrc,
        productInfo: productInfo
      });

      // Check if there's a gallery row for this substitute
      const substituteIndex = clickedElement.closest('td')?.querySelector('.image-count-badge')?.dataset.substituteIndex;
      if (substituteIndex) {
        const galleryRow = document.querySelector(`.substitute-gallery-row[data-substitute-index="${substituteIndex}"]`);
        if (galleryRow) {
          const gallery = galleryRow.querySelector('.image-gallery');
          if (gallery) {
            gallery.querySelectorAll('.clickable-image').forEach(img => {
              const imageSrc = img.dataset.imageSrc;
              if (imageSrc && !images.find(i => i.src === imageSrc)) {
                images.push({
                  src: imageSrc,
                  productInfo: productInfo
                });
              }
            });
          }
        }
      }
    }

    return images;
  }

  // Find the product card that contains the clicked image
  const productCard = clickedElement.closest('.lenovo-product-card');

  if (!productCard) {
    // If no product card found, just return the single image
    return [{
      src: clickedElement.dataset.imageSrc,
      productInfo: null
    }];
  }

  // Get product info
  const productId = productCard.dataset.productId;
  const productName = productCard.querySelector('.product-info h3')?.textContent;
  const serialNumber = productCard.querySelector('.detail-value')?.textContent;

  const productInfo = {
    id: productId,
    name: productName,
    serial: serialNumber
  };

  // It's a main product image, collect all images from the main product (not substitutes)
  // Find all image galleries in the product card that are NOT inside substitute rows
  const galleries = productCard.querySelectorAll('.image-gallery');

  galleries.forEach(gallery => {
    // Skip galleries that are inside substitute rows (they have class substitute-gallery-row)
    if (!gallery.closest('.substitute-gallery-row')) {
      // This is a main product gallery
      gallery.querySelectorAll('.clickable-image').forEach(img => {
        const imageSrc = img.dataset.imageSrc;
        if (imageSrc && !images.find(i => i.src === imageSrc)) {
          images.push({
            src: imageSrc,
            productInfo: productInfo
          });
        }
      });
    }
  });

  // Also include the main product image if not already in the list
  const mainProductImage = productCard.querySelector('.product-main-image.clickable-image');
  if (mainProductImage && mainProductImage.dataset.imageSrc) {
    const mainSrc = mainProductImage.dataset.imageSrc;
    if (!images.find(i => i.src === mainSrc)) {
      // Add at the beginning
      images.unshift({
        src: mainSrc,
        productInfo: productInfo
      });
    }
  }

  return images.length > 0 ? images : [{
    src: clickedElement.dataset.imageSrc,
    productInfo: productInfo
  }];
}

function openImageModal(imageSrc, clickedElement) {
  const modal = document.getElementById('image-modal');
  const modalImg = document.getElementById('modal-image');

  if (!modal || !modalImg || !imageSrc || !clickedElement) return;

  // Collect gallery images only from the same product/context
  galleryImages = collectGalleryImages(clickedElement);

  // Find the index of the current image
  currentImageIndex = galleryImages.findIndex(img => img.src === imageSrc);
  if (currentImageIndex === -1) {
    currentImageIndex = 0;
  }

  // Reset zoom
  currentZoomLevel = 0;
  modalImg.classList.remove('zoomed', 'zoomed-max');

  // Show modal
  modal.classList.add('active');
  showImageAtIndex(currentImageIndex);
  updateNavigationArrows();
}

function showImageAtIndex(index) {
  const modalImg = document.getElementById('modal-image');
  const infoCard = document.getElementById('modal-info-card');

  if (index < 0 || index >= galleryImages.length) return;

  const imageData = galleryImages[index];
  modalImg.src = imageData.src;

  // Reset zoom and pan when changing images
  resetZoomAndPan();

  // Update info card
  if (imageData.productInfo) {
    const info = imageData.productInfo;

    // Build the info card HTML based on what data is available
    let detailsHTML = '';

    // Check if it's a substitute (has 'type' field) or main product (has 'serial' field)
    if (info.type) {
      // It's a substitute product
      detailsHTML = `
        <span class="modal-info-label">Part No:</span>
        <span class="modal-info-value">${info.id || 'N/A'}</span>

        <span class="modal-info-label">Type:</span>
        <span class="modal-info-value">${info.type || 'N/A'}</span>

        <span class="modal-info-label">Compatible Models:</span>
        <span class="modal-info-value">${info.compatibleModels || '0'}</span>
      `;
    } else {
      // It's a main product
      detailsHTML = `
        ${info.serial ? `
          <span class="modal-info-label">Serial:</span>
          <span class="modal-info-value">${info.serial}</span>
        ` : ''}
        ${info.id ? `
          <span class="modal-info-label">Product ID:</span>
          <span class="modal-info-value">${info.id}</span>
        ` : ''}
      `;
    }

    infoCard.innerHTML = `
      <div class="modal-info-title">${info.name || 'Product'}</div>
      <div class="modal-info-details">
        ${detailsHTML}
        <span class="modal-info-label">Image:</span>
        <span class="modal-info-value">${index + 1} of ${galleryImages.length}</span>
      </div>
    `;
    infoCard.classList.add('active');
  } else {
    infoCard.classList.remove('active');
  }
}

function resetZoomAndPan() {
  const modalImg = document.getElementById('modal-image');
  currentZoomLevel = 0;
  panCurrentX = 0;
  panCurrentY = 0;
  modalImg.classList.remove('zoomed', 'zoomed-max', 'dragging');
  modalImg.style.transform = '';
}

function updateImageTransform() {
  const modalImg = document.getElementById('modal-image');
  const scale = currentZoomLevel === 1 ? 2 : currentZoomLevel === 2 ? 3 : 1;

  if (currentZoomLevel === 0) {
    modalImg.style.transform = '';
  } else {
    modalImg.style.transform = `scale(${scale}) translate(${panCurrentX}px, ${panCurrentY}px)`;
  }
}

function updateNavigationArrows() {
  const prevArrow = document.querySelector('.modal-nav-prev');
  const nextArrow = document.querySelector('.modal-nav-next');

  if (galleryImages.length > 1) {
    prevArrow.classList.add('active');
    nextArrow.classList.add('active');
  } else {
    prevArrow.classList.remove('active');
    nextArrow.classList.remove('active');
  }
}

function navigateImage(direction) {
  currentImageIndex += direction;

  // Wrap around
  if (currentImageIndex < 0) {
    currentImageIndex = galleryImages.length - 1;
  } else if (currentImageIndex >= galleryImages.length) {
    currentImageIndex = 0;
  }

  showImageAtIndex(currentImageIndex);
}

function closeImageModal() {
  const modal = document.getElementById('image-modal');
  const infoCard = document.getElementById('modal-info-card');

  if (modal) {
    modal.classList.remove('active');
    infoCard.classList.remove('active');

    // Reset zoom and pan
    resetZoomAndPan();
  }
}

// Zoom functionality - with click detection to avoid zooming when dragging
let clickStartTime = 0;
let clickStartX = 0;
let clickStartY = 0;

document.addEventListener('mousedown', function(e) {
  const modalImg = document.getElementById('modal-image');

  if (e.target === modalImg) {
    clickStartTime = Date.now();
    clickStartX = e.clientX;
    clickStartY = e.clientY;

    if (currentZoomLevel > 0) {
      // Enable panning
      isPanning = true;
      panStartX = e.clientX - panCurrentX;
      panStartY = e.clientY - panCurrentY;
      modalImg.classList.add('dragging');
      e.preventDefault();
    }
  }
});

document.addEventListener('mousemove', function(e) {
  if (isPanning && currentZoomLevel > 0) {
    panCurrentX = e.clientX - panStartX;
    panCurrentY = e.clientY - panStartY;
    updateImageTransform();
    e.preventDefault();
  }
});

document.addEventListener('mouseup', function(e) {
  const modalImg = document.getElementById('modal-image');

  if (e.target === modalImg) {
    const clickDuration = Date.now() - clickStartTime;
    const clickDistance = Math.sqrt(
      Math.pow(e.clientX - clickStartX, 2) +
      Math.pow(e.clientY - clickStartY, 2)
    );

    // Only trigger zoom if it was a quick click and didn't move much (not a drag)
    if (clickDuration < 300 && clickDistance < 10) {
      const oldZoomLevel = currentZoomLevel;
      currentZoomLevel = (currentZoomLevel + 1) % 3;

      // Adjust pan position to maintain visual position when changing zoom levels
      if (currentZoomLevel === 0) {
        // Reset pan when going back to no zoom
        panCurrentX = 0;
        panCurrentY = 0;
      } else if (oldZoomLevel > 0 && currentZoomLevel > 0) {
        // When going between zoom levels (1->2 or 2->1), adjust pan to maintain position
        const oldScale = oldZoomLevel === 1 ? 2 : 3;
        const newScale = currentZoomLevel === 1 ? 2 : 3;
        panCurrentX = panCurrentX * (oldScale / newScale);
        panCurrentY = panCurrentY * (oldScale / newScale);
      }

      modalImg.classList.remove('zoomed', 'zoomed-max');

      if (currentZoomLevel === 1) {
        modalImg.classList.add('zoomed');
      } else if (currentZoomLevel === 2) {
        modalImg.classList.add('zoomed-max');
      }

      updateImageTransform();
    }
  }

  if (isPanning) {
    isPanning = false;
    modalImg.classList.remove('dragging');
  }
});

// Close modal when clicking outside the image
document.addEventListener('click', function(e) {
  const modal = document.getElementById('image-modal');

  if (e.target === modal) {
    closeImageModal();
  }
});

// Keyboard navigation
document.addEventListener('keydown', function(e) {
  const modal = document.getElementById('image-modal');

  if (modal.classList.contains('active')) {
    if (e.key === 'Escape') {
      closeImageModal();
    } else if (e.key === 'ArrowLeft') {
      navigateImage(-1);
    } else if (e.key === 'ArrowRight') {
      navigateImage(1);
    }
  }
});

/***************************************************
 * Download Parts List as Excel
 ***************************************************/
function downloadAsBuiltPartsListExcel() {
  let allResults = searchResults.lenovoAsBuilt;
  if (selectedPartNumber) {
    const relatedParts = getAllRelatedPartNumbers(selectedPartNumber);
    allResults = allResults.filter(doc => relatedParts.includes(doc.sourcePartNumber));
  }

  if (!allResults || allResults.length === 0) {
    alert('No Lenovo As-Built data available to export');
    return;
  }

  // Collect all products from all part numbers
  const allProducts = [];
  allResults.forEach(doc => {
    if (doc.products && doc.products.length > 0) {
      doc.products.forEach(product => {
        allProducts.push(product);
      });
    }
  });

  if (allProducts.length === 0) {
    alert('No products available to export');
    return;
  }

  // Map CRU tiers to serviceable text
  const cruTierMap = {
    '1': '9 (FRU)',
    '2': 'Optional',
    '9': 'FRU Only',
    '10': 'Serviceable',
    '0': '0 (C)'
  };

  // Prepare data for Excel - headers first
  const excelData = [];

  // Add column headers as first row
  excelData.push(['Description', 'Commodity Type', 'Part Number', 'Mfg Part', 'Bar Codes', 'Installed', 'Customer Serviceable', 'Substitute Parts', 'CRU Tier', 'Image URL']);

  // Add product data
  allProducts.forEach(product => {
    // Collect substitute part numbers
    const substituteParts = [];
    if (product.substitutes && product.substitutes.length > 0) {
      product.substitutes.forEach(sub => {
        if (sub.id) {
          substituteParts.push(sub.id);
        }
      });
    }
    const substituteString = substituteParts.length > 0 ? substituteParts.join(', ') : '';

    // Get serviceable text
    const serviceableText = cruTierMap[product.cruTier] || product.cruTier || '';

    // Get first image URL if available (using imageUrls array)
    const imageUrl = (product.imageUrls && product.imageUrls.length > 0) ? product.imageUrls[0] : '';

    // Get barCodes as comma-separated string
    const barCodesString = (product.barCodes && product.barCodes.length > 0)
      ? product.barCodes.filter(bc => bc).join(', ')
      : '';

    excelData.push([
      product.name || '',
      product.commodity || '',
      product.id || '',
      product.mfgPart || '',
      barCodesString,
      product.installed || '',
      serviceableText,
      substituteString,
      product.cruTier || '',
      imageUrl
    ]);
  });

  // Create workbook and worksheet
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(excelData);

  // Apply styles to header row (row 1, index 0)
  const headerStyle = {
    fill: { fgColor: { rgb: "2563EB" } },
    font: { bold: true, sz: 14, color: { rgb: "FFFFFF" } },
    alignment: { horizontal: "center", vertical: "center" }
  };

  // Apply header styles to each column
  const columns = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
  columns.forEach(col => {
    const cellRef = col + '1';
    if (!ws[cellRef]) ws[cellRef] = { t: 's', v: '' };
    ws[cellRef].s = headerStyle;
  });

  // Set column widths
  ws['!cols'] = [
    { wch: 50 }, // Description
    { wch: 30 }, // Commodity Type
    { wch: 15 }, // Part Number
    { wch: 25 }, // Mfg Part
    { wch: 30 }, // Bar Codes
    { wch: 10 }, // Installed
    { wch: 20 }, // Customer Serviceable
    { wch: 35 }, // Substitute Parts
    { wch: 10 }, // CRU Tier
    { wch: 50 }  // Image URL
  ];

  // Set row height for header
  ws['!rows'] = [{ hpt: 25 }];

  // Add worksheet to workbook
  XLSX.utils.book_append_sheet(wb, ws, 'Parts List');

  // Generate filename with serial number
  let warrantyData = searchResults.lenovoWarranty;
  if (selectedPartNumber) {
    const relatedParts = getAllRelatedPartNumbers(selectedPartNumber);
    warrantyData = warrantyData.filter(doc => relatedParts.includes(doc.sourcePartNumber));
  }
  const serialNumber = warrantyData && warrantyData.length > 0
    ? warrantyData[0].sourcePartNumber
    : 'parts_list';

  const filename = `${serialNumber}_parts_list.xlsx`;

  // Download the file
  XLSX.writeFile(wb, filename);
}

/***************************************************
 * Download Lenovo Parts List as Excel
 ***************************************************/
function downloadLenovoPartsListExcel() {
  let allResults = searchResults.lenovoParts;
  if (selectedPartNumber) {
    const relatedParts = getAllRelatedPartNumbers(selectedPartNumber);
    allResults = allResults.filter(doc => relatedParts.includes(doc.sourcePartNumber));
  }

  if (!allResults || allResults.length === 0) {
    alert('No Lenovo Parts data available to export');
    return;
  }

  // Collect all parts from all documents, applying the same filters as the UI
  const allParts = [];
  allResults.forEach(doc => {
    if (doc.parts && doc.parts.length > 0) {
      doc.parts.forEach(part => {
        const partId = part.id || '';
        const partType = part.type || 'N/A';
        const partName = part.name || 'N/A';

        // Apply same filters as UI
        if (partId.startsWith('(PPN)')) return;
        if (partId === 'N/A' || partId === '') return;
        if (partType === 'N/A' && partName === 'N/A') return;

        allParts.push({
          sourcePartNumber: doc.sourcePartNumber,
          ...part
        });
      });
    }
  });

  if (allParts.length === 0) {
    alert('No parts available to export');
    return;
  }

  // Prepare data for Excel - headers first
  const excelData = [];
  excelData.push(['Source Part Number', 'ID', 'Type', 'Name', 'Level']);

  // Add parts data
  allParts.forEach(part => {
    excelData.push([
      part.sourcePartNumber || '',
      part.id || '',
      part.type || '',
      part.name || '',
      part.level || ''
    ]);
  });

  // Create workbook and worksheet
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(excelData);

  // Set column widths
  ws['!cols'] = [
    { wch: 20 }, // Source Part Number
    { wch: 20 }, // ID
    { wch: 25 }, // Type
    { wch: 50 }, // Name
    { wch: 10 }  // Level
  ];

  // Set row height for header
  ws['!rows'] = [{ hpt: 25 }];

  // Add worksheet to workbook
  XLSX.utils.book_append_sheet(wb, ws, 'All Parts');

  // Generate filename
  const serialNumber = selectedPartNumber || (allResults.length > 0 ? allResults[0].sourcePartNumber : 'lenovo_parts');
  const filename = `${serialNumber}_all_parts.xlsx`;

  // Download the file
  XLSX.writeFile(wb, filename);
}

/***************************************************
 * Filter As-Built Products by Part Number
 ***************************************************/
// Debounce timer for search
let asbuiltFilterDebounceTimer = null;

// Debounced version of filter function
function debouncedFilterAsBuiltProducts() {
  // Clear existing timer
  if (asbuiltFilterDebounceTimer) {
    clearTimeout(asbuiltFilterDebounceTimer);
  }

  // Set new timer
  asbuiltFilterDebounceTimer = setTimeout(() => {
    filterAsBuiltProducts();
  }, 400); // 400ms debounce
}

function filterAsBuiltProducts() {
  const filterInput = document.getElementById('asbuilt-filter-input');
  if (!filterInput) return;

  const searchTerm = filterInput.value.trim();

  // Get the active subtab wrapper
  const activeWrapper = document.querySelector('#lenovo-asbuilt-subcontent .subtab-content.active .asbuilt-content-wrapper');
  if (!activeWrapper) return;

  // Call the applyFilter function if it exists
  if (typeof activeWrapper.applyFilter === 'function') {
    activeWrapper.applyFilter(searchTerm);
  }
}

/***************************************************
 * Build All Consolidated Table
 ***************************************************/
function buildAllConsolidatedTable() {
  const allResultsContainer = document.querySelector('#all-content .all-results');
  if (!allResultsContainer) return;

  // Filter by selected part number if one is selected
  let partDataEntries = Object.entries(partAlternativesData);
  if (selectedPartNumber && partAlternativesData[selectedPartNumber]) {
    partDataEntries = [[selectedPartNumber, partAlternativesData[selectedPartNumber]]];
  }

  if (partDataEntries.length === 0) {
    allResultsContainer.innerHTML = '<p>No data available. Please search for a part number first.</p>';
    return;
  }

  // Build consolidated table HTML
  let tableHTML = `
    <div class="table-container" style="overflow-x: auto;">
      <table style="min-width: 2000px;">
        <thead>
          <tr>
            <th>Part number searched</th>
            <th>Alternative part 1</th>
            <th>Alternative part 2</th>
            <th>Alternative part 3</th>
            <th>Description</th>
            <th>Category</th>
            <th>Ingram Quantity (total)</th>
            <th>Ingram Price</th>
            <th>TDSynnex Quantity (total)</th>
            <th>TDSynnex Price</th>
            <th>BrokerBin Avg Price ($ cheapest)</th>
            <th>BrokerBin Sum Qty ($ cheapest)</th>
            <th>eBay Avg Price ($ cheapest)</th>
            <th>eBay Sum Quantity ($ cheapest)</th>
            <th>MFP Stock Quantity (total)</th>
            <th>MFP Stock Price</th>
            <th>MFP Sales Price (last of last 5 sales)</th>
            <th>MFP Sales Price (avg of last 5 sales)</th>
            <th>MFP Customer (last)</th>
            <th>MFP Purchases Quantity (Sum of last 5 purchases)</th>
            <th>MFP Purchase Price (Avg last 5 purchases)</th>
            <th>MFP Supplier (last)</th>
            <th>Buy Price Recommendation</th>
            <th>Sell Price Recommendation</th>
          </tr>
        </thead>
        <tbody>
  `;

  // Process each main part number
  for (const [mainPart, partData] of partDataEntries) {
    const alternatives = partData.alternatives || [];
    const alt1 = alternatives[0] ? `${alternatives[0].type}: ${alternatives[0].value}` : '';
    const alt2 = alternatives[1] ? `${alternatives[1].type}: ${alternatives[1].value}` : '';
    const alt3 = alternatives[2] ? `${alternatives[2].type}: ${alternatives[2].value}` : '';

    // Build array of all part numbers to search (main + alternatives)
    const allPartsToSearch = [mainPart];
    for (const alt of alternatives) {
      if (alt.value && !allPartsToSearch.includes(alt.value)) {
        allPartsToSearch.push(alt.value);
      }
    }

    // Get data from main part AND all alternatives
    const ingramData = getIngramDataForParts(allPartsToSearch);
    const tdsynnexData = getTDSynnexDataForParts(allPartsToSearch);
    const brokerbinData = getBrokerBinDataForParts(allPartsToSearch);
    const ebayData = getEbayDataForParts(allPartsToSearch);
    const inventoryData = getInventoryDataForParts(allPartsToSearch);
    const salesData = getSalesDataForParts(allPartsToSearch);
    const purchasesData = getPurchasesDataForParts(allPartsToSearch);

    // Get description and category from available sources
    // Priority: 1. Lenovo Press, 2. Ingram, 3. BrokerBin, 4. TDSynnex, 5. Inventory
    let description = 'N/A';
    let category = 'N/A';

    // Priority 1: Lenovo Press - extract description from HTML content
    let lenovoPressDescription = null;
    if (searchResults.lenovoPress && searchResults.lenovoPress.length > 0) {
      // Search for any of the part numbers (main or alternatives)
      for (const searchPart of allPartsToSearch) {
        if (lenovoPressDescription) break;
        const lenovoPressResult = searchResults.lenovoPress.find(item => item.sourcePartNumber === searchPart);
        if (lenovoPressResult?.content) {
          const tempDiv = document.createElement('div');
          tempDiv.innerHTML = lenovoPressResult.content;
          const rows = tempDiv.querySelectorAll('tr');
          for (const row of rows) {
            const cells = row.querySelectorAll('td');
            if (cells.length >= 3) {
              const cellText = cells[0]?.textContent?.trim() || '';
              // Check if this row contains any of our part numbers
              for (const partToMatch of allPartsToSearch) {
                if (cellText === partToMatch || cellText.includes(partToMatch)) {
                  lenovoPressDescription = cells[2]?.textContent?.trim() || null;
                  if (lenovoPressDescription && lenovoPressDescription !== '-') break;
                }
              }
              if (lenovoPressDescription && lenovoPressDescription !== '-') break;
            }
          }
        }
      }
    }

    if (lenovoPressDescription && lenovoPressDescription !== '-') {
      description = lenovoPressDescription;
    } else if (ingramData.description) {
      description = ingramData.description;
      category = ingramData.category || 'N/A';
    } else if (brokerbinData.description) {
      description = brokerbinData.description;
    } else if (inventoryData.description) {
      description = inventoryData.description;
      category = inventoryData.category || 'N/A';
    }

    // Get category from Ingram if we got description from Lenovo Press (Lenovo Press doesn't have category)
    if (lenovoPressDescription && lenovoPressDescription !== '-' && category === 'N/A') {
      if (ingramData.category) {
        category = ingramData.category;
      } else if (inventoryData.category) {
        category = inventoryData.category;
      }
    }

    tableHTML += `
      <tr>
        <td>${mainPart}</td>
        <td>${alt1}</td>
        <td>${alt2}</td>
        <td>${alt3}</td>
        <td>${description}</td>
        <td>${category}</td>
        <td>${ingramData.totalQty}</td>
        <td>${ingramData.price}</td>
        <td>${tdsynnexData.totalQty}</td>
        <td>${tdsynnexData.price}</td>
        <td>${brokerbinData.avgPrice}</td>
        <td>${brokerbinData.sumQty}</td>
        <td>${ebayData.avgPrice}</td>
        <td>${ebayData.sumQty}</td>
        <td>${inventoryData.totalQty}</td>
        <td>${inventoryData.price}</td>
        <td>${salesData.lastPrice}</td>
        <td>${salesData.avgPrice}</td>
        <td>${salesData.lastCustomer}</td>
        <td>${purchasesData.sumQty}</td>
        <td>${purchasesData.avgPrice}</td>
        <td>${purchasesData.lastSupplier}</td>
        <td>-</td>
        <td>-</td>
      </tr>
    `;
  }

  tableHTML += `
        </tbody>
      </table>
    </div>
  `;

  allResultsContainer.innerHTML = tableHTML;
}

// Helper functions to extract data from each source
function getIngramDataForParts(parts) {
  const ingramResults = searchResults.ingram.filter(item => parts.includes(item.sourcePartNumber));
  const totalQty = ingramResults.reduce((sum, item) => {
    const availability = item.availability;
    if (typeof availability === 'object' && availability.totalAvailability !== undefined) {
      return sum + (parseInt(availability.totalAvailability) || 0);
    }
    return sum + (parseInt(availability) || 0);
  }, 0);
  const prices = ingramResults.map(item => parseFloat(item.price)).filter(p => !isNaN(p));
  const price = prices.length > 0 ? `$${Math.min(...prices).toFixed(2)}` : '-';
  const description = ingramResults.length > 0 ? (ingramResults[0].description || null) : null;
  const category = ingramResults.length > 0 ? (ingramResults[0].category || null) : null;
  return { totalQty, price, description, category };
}

function getTDSynnexDataForParts(parts) {
  const tdResults = searchResults.tdsynnex.filter(item => parts.includes(item.sourcePartNumber));
  const totalQty = tdResults.reduce((sum, item) => sum + (parseInt(item.totalQuantity) || 0), 0);
  const prices = tdResults.map(item => parseFloat(item.price)).filter(p => !isNaN(p));
  const price = prices.length > 0 ? `$${Math.min(...prices).toFixed(2)}` : '-';
  return { totalQty, price };
}

function getBrokerBinDataForParts(parts) {
  const bbResults = searchResults.brokerbin.filter(item => parts.includes(item.sourcePartNumber));
  const prices = bbResults.map(item => parseFloat(item.price)).filter(p => !isNaN(p) && p > 0);
  const avgPrice = prices.length > 0 ? `$${(prices.reduce((a,b) => a+b, 0) / prices.length).toFixed(2)}` : '-';
  const sumQty = bbResults.reduce((sum, item) => sum + (parseInt(item.quantity) || 0), 0);
  const description = bbResults.length > 0 ? (bbResults[0].description || null) : null;
  return { avgPrice, sumQty, description };
}

function getEbayDataForParts(parts) {
  const ebayResults = searchResults.ebay.filter(item => parts.includes(item.sourcePartNumber));
  const prices = ebayResults.map(item => parseFloat(item.price)).filter(p => !isNaN(p) && p > 0);
  const avgPrice = prices.length > 0 ? `$${(prices.reduce((a,b) => a+b, 0) / prices.length).toFixed(2)}` : '-';
  const sumQty = ebayResults.length;
  return { avgPrice, sumQty };
}

function getInventoryDataForParts(parts) {
  // Filter by sourcePartNumber OR PartNum (Epicor uses PartNum)
  const invResults = searchResults.epicor.filter(item =>
    parts.includes(item.sourcePartNumber) ||
    (item.PartNum && parts.includes(item.PartNum.trim()))
  );
  // Epicor uses Quantity (capital Q) not quantity
  const totalQty = invResults.reduce((sum, item) => sum + (Number.parseInt(item.Quantity) || Number.parseInt(item.quantity) || 0), 0);
  // Epicor uses BasePrice (capital B) not basePrice
  const prices = invResults.map(item => Number.parseFloat(item.BasePrice) || Number.parseFloat(item.basePrice)).filter(p => !Number.isNaN(p) && p > 0);
  const price = prices.length > 0 ? `$${prices[0].toFixed(2)}` : '-';
  // Epicor uses PartDescription not description
  const description = invResults.length > 0 ? (invResults[0].PartDescription || invResults[0].description || null) : null;
  // Epicor uses ClassDescription not class
  const category = invResults.length > 0 ? (invResults[0].ClassDescription || invResults[0].class || null) : null;
  return { totalQty, price, description, category };
}

function getSalesDataForParts(parts) {
  // Filter by sourcePartNumber OR PartNum
  const salesResults = searchResults.sales.filter(item =>
    parts.includes(item.sourcePartNumber) ||
    (item.PartNum && parts.includes(item.PartNum.trim()))
  ).slice(0, 5);
  // Sales uses UnitPrice (capital U) not unitPrice
  const prices = salesResults.map(item => Number.parseFloat(item.UnitPrice) || Number.parseFloat(item.unitPrice)).filter(p => !Number.isNaN(p) && p > 0);
  const lastPrice = prices.length > 0 ? `$${prices[0].toFixed(2)}` : '-';
  const avgPrice = prices.length > 0 ? `$${(prices.reduce((a,b) => a+b, 0) / prices.length).toFixed(2)}` : '-';
  // Sales uses CustomerName (capital C) not customerName
  const lastCustomer = salesResults.length > 0 ? (salesResults[0].CustomerName || salesResults[0].customerName || '-') : '-';
  return { lastPrice, avgPrice, lastCustomer };
}

function getPurchasesDataForParts(parts) {
  // Filter by sourcePartNumber OR PartNum
  const purchResults = searchResults.purchases.filter(item =>
    parts.includes(item.sourcePartNumber) ||
    (item.PartNum && parts.includes(item.PartNum.trim()))
  ).slice(0, 5);
  // Purchases uses VendorQty (capital V) not orderQty
  const sumQty = purchResults.reduce((sum, item) => sum + (Number.parseInt(item.VendorQty) || Number.parseInt(item.orderQty) || 0), 0);
  // Purchases uses VendorUnitCost not unitCost
  const prices = purchResults.map(item => Number.parseFloat(item.VendorUnitCost) || Number.parseFloat(item.unitCost)).filter(p => !Number.isNaN(p) && p > 0);
  const avgPrice = prices.length > 0 ? `$${(prices.reduce((a,b) => a+b, 0) / prices.length).toFixed(2)}` : '-';
  // Purchases uses VendorName not vendorId
  const lastSupplier = purchResults.length > 0 ? (purchResults[0].VendorName || purchResults[0].vendorId || '-') : '-';
  return { sumQty, avgPrice, lastSupplier };
}

/***************************************************
 * Export All Consolidated Table to Excel
 ***************************************************/
function exportAllToExcel() {
  // Check if there's data to export
  if (Object.keys(partAlternativesData).length === 0) {
    alert('No data available to export. Please perform a search first.');
    return;
  }

  // Prepare Excel data array
  const excelData = [];

  // Add header row
  excelData.push([
    'Part number searched',
    'Alternative part 1',
    'Alternative part 2',
    'Alternative part 3',
    'Description',
    'Category',
    'Ingram Quantity (total)',
    'Ingram Price',
    'TDSynnex Quantity (total)',
    'TDSynnex Price',
    'BrokerBin Avg Price ($ cheapest)',
    'BrokerBin Sum Qty ($ cheapest)',
    'eBay Avg Price ($ cheapest)',
    'eBay Sum Quantity ($ cheapest)',
    'MFP Stock Quantity (total)',
    'MFP Stock Price',
    'MFP Sales Price (last of last 5 sales)',
    'MFP Sales Price (avg of last 5 sales)',
    'MFP Customer (last)',
    'MFP Purchases Quantity (Sum of last 5 purchases)',
    'MFP Purchase Price (Avg last 5 purchases)',
    'MFP Supplier (last)',
    'Buy Price Recommendation',
    'Sell Price Recommendation'
  ]);

  // Process each main part number
  for (const [mainPart, partData] of Object.entries(partAlternativesData)) {
    const alternatives = partData.alternatives || [];
    const alt1 = alternatives[0] ? `${alternatives[0].type}: ${alternatives[0].value}` : '';
    const alt2 = alternatives[1] ? `${alternatives[1].type}: ${alternatives[1].value}` : '';
    const alt3 = alternatives[2] ? `${alternatives[2].type}: ${alternatives[2].value}` : '';

    // Get data ONLY from the main part number
    const ingramData = getIngramDataForParts([mainPart]);
    const tdsynnexData = getTDSynnexDataForParts([mainPart]);
    const brokerbinData = getBrokerBinDataForParts([mainPart]);
    const ebayData = getEbayDataForParts([mainPart]);
    const inventoryData = getInventoryDataForParts([mainPart]);
    const salesData = getSalesDataForParts([mainPart]);
    const purchasesData = getPurchasesDataForParts([mainPart]);

    // Get description and category
    let description = 'N/A';
    let category = 'N/A';
    if (ingramData.description) {
      description = ingramData.description;
      category = ingramData.category || 'N/A';
    } else if (brokerbinData.description) {
      description = brokerbinData.description;
    } else if (inventoryData.description) {
      description = inventoryData.description;
      category = inventoryData.category || 'N/A';
    }

    // Add row data
    excelData.push([
      mainPart,
      alt1,
      alt2,
      alt3,
      description,
      category,
      ingramData.totalQty,
      ingramData.price,
      tdsynnexData.totalQty,
      tdsynnexData.price,
      brokerbinData.avgPrice,
      brokerbinData.sumQty,
      ebayData.avgPrice,
      ebayData.sumQty,
      inventoryData.totalQty,
      inventoryData.price,
      salesData.lastPrice,
      salesData.avgPrice,
      salesData.lastCustomer,
      purchasesData.sumQty,
      purchasesData.avgPrice,
      purchasesData.lastSupplier,
      '-', // Buy Price Recommendation
      '-'  // Sell Price Recommendation
    ]);
  }

  // Create workbook and worksheet
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(excelData);

  // Apply styles to header row
  const headerStyle = {
    fill: { fgColor: { rgb: "2563EB" } },
    font: { bold: true, sz: 12, color: { rgb: "FFFFFF" } },
    alignment: { horizontal: "center", vertical: "center" }
  };

  // Apply header styles to each column (A-X for 24 columns)
  const columns = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X'];
  columns.forEach(col => {
    const cellRef = col + '1';
    if (!ws[cellRef]) ws[cellRef] = { t: 's', v: '' };
    ws[cellRef].s = headerStyle;
  });

  // Set column widths
  ws['!cols'] = [
    { wch: 20 }, // Part number searched
    { wch: 20 }, // Alternative part 1
    { wch: 20 }, // Alternative part 2
    { wch: 20 }, // Alternative part 3
    { wch: 40 }, // Description
    { wch: 20 }, // Category
    { wch: 18 }, // Ingram Quantity
    { wch: 15 }, // Ingram Price
    { wch: 18 }, // TDSynnex Quantity
    { wch: 15 }, // TDSynnex Price
    { wch: 20 }, // BrokerBin Avg Price
    { wch: 18 }, // BrokerBin Sum Qty
    { wch: 20 }, // eBay Avg Price
    { wch: 18 }, // eBay Sum Quantity
    { wch: 20 }, // MFP Stock Quantity
    { wch: 15 }, // MFP Stock Price
    { wch: 25 }, // MFP Sales Price (last)
    { wch: 25 }, // MFP Sales Price (avg)
    { wch: 25 }, // MFP Customer
    { wch: 28 }, // MFP Purchases Quantity
    { wch: 28 }, // MFP Purchase Price
    { wch: 20 }, // MFP Supplier
    { wch: 20 }, // Buy Price Recommendation
    { wch: 20 }  // Sell Price Recommendation
  ];

  // Set row height for header
  ws['!rows'] = [{ hpt: 25 }];

  // Add worksheet to workbook
  XLSX.utils.book_append_sheet(wb, ws, 'Consolidated Data');

  // Generate filename with timestamp
  const timestamp = new Date().toISOString().split('T')[0];
  const partNumbers = Object.keys(partAlternativesData).join('_');
  const filename = `${partNumbers.substring(0, 30)}_consolidated_${timestamp}.xlsx`;

  // Download the file
  XLSX.writeFile(wb, filename);
}

document.addEventListener('DOMContentLoaded', function() {
  // Always start with welcome screen on page load/refresh
  // Clear any previous workflow selection
  sessionStorage.removeItem('selectedWorkflow');

  // Ensure welcome screen is visible and main interface is hidden
  const welcomeScreen = document.getElementById('welcome-screen');
  const mainInterface = document.getElementById('main-interface');
  if (welcomeScreen) {
    welcomeScreen.style.display = 'flex';
  }
  if (mainInterface) {
    mainInterface.style.display = 'none';
  }

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

/***************************************************
 * Barcode Modal Functions
 ***************************************************/
function showBarcodeModal(mfgPartData) {
  const modal = document.getElementById('barcode-modal');
  const container = document.getElementById('barcode-container');
  const title = document.getElementById('barcode-title');

  // Clear previous content
  container.innerHTML = '';

  // Parse the mfgPartData if it's a JSON string
  let barcodeList = [];
  try {
    const parsedData = JSON.parse(decodeURIComponent(mfgPartData));

    // Use barCodes if available, otherwise use mfgParts, otherwise use mfgPart
    if (parsedData.barCodes && parsedData.barCodes.length > 0) {
      barcodeList = parsedData.barCodes;
    } else if (parsedData.mfgParts && parsedData.mfgParts.length > 0) {
      barcodeList = parsedData.mfgParts;
    } else if (parsedData.mfgPart) {
      barcodeList = [parsedData.mfgPart];
    }
  } catch (e) {
    // If it's not JSON, treat it as a simple string
    barcodeList = [mfgPartData];
  }

  // Remove duplicates
  barcodeList = [...new Set(barcodeList)];

  title.textContent = barcodeList.length > 1 ? `Barcodes (${barcodeList.length})` : 'Barcode';

  // Generate barcodes
  try {
    barcodeList.forEach((code, index) => {
      const barcodeDiv = document.createElement('div');
      barcodeDiv.className = 'barcode-item';

      const canvas = document.createElement('canvas');
      const label = document.createElement('div');
      label.className = 'barcode-label';

      // Format label similar to the reference image (e.g., SSD7B22262-01)
      const formattedLabel = barcodeList.length > 1
        ? `${code.split('-')[0]}-${String(index + 1).padStart(2, '0')}`
        : code;

      label.textContent = formattedLabel;

      // Add search button
      const searchButton = document.createElement('button');
      searchButton.className = 'barcode-search-btn';
      searchButton.textContent = 'Search this Part';
      searchButton.onclick = () => {
        closeBarcodeModal();
        searchPartNumber(code);
      };

      barcodeDiv.appendChild(canvas);
      barcodeDiv.appendChild(label);
      barcodeDiv.appendChild(searchButton);
      container.appendChild(barcodeDiv);

      // Generate barcode using JsBarcode
      JsBarcode(canvas, code, {
        format: "CODE128",
        width: 2,
        height: 80,
        displayValue: true,
        fontSize: 16,
        margin: 10
      });
    });

    // Show modal
    modal.classList.add('active');
  } catch (error) {
    console.error('Error generating barcode:', error);
    container.innerHTML = '<p style="color: red;">Error generating barcode</p>';
    modal.classList.add('active');
  }
}

/***************************************************
 * Search Part Number (switch to parts workflow)
 ***************************************************/
function searchPartNumber(partNumber) {
  console.log('searchPartNumber called with:', partNumber);
  console.log('Current workflow before switch:', currentWorkflow);

  // Save current workflow
  const previousWorkflow = currentWorkflow;

  // IMPORTANT: Add placeholder to partsWorkflowData BEFORE switching
  // so that updateWorkflowDropdown() will include it when restoring
  partsWorkflowData.partAlternativesData[partNumber] = {
    description: null,
    category: null,
    original: partNumber,
    alternatives: []
  };
  partsWorkflowData.selectedPartNumber = partNumber;

  // Switch to 'parts' workflow if not already there
  if (currentWorkflow !== 'parts') {
    selectWorkflow('parts');
  }

  console.log('Current workflow after switch:', currentWorkflow);

  // IMPORTANT: Now we're in 'parts' workflow, so manually trigger search
  // without using the input field to avoid the dropdown population issue

  // Create a Set with just this part number
  const partNumbers = new Set([partNumber]);

  // Call the search logic directly but ensure we're in parts context
  if (partNumbers.size === 0) {
    alert('Please enter at least one part number');
    return;
  }

  // Convertir el Set a un array
  const partNumbersArray = Array.from(partNumbers);

  // Update selected part number
  selectedPartNumber = partNumber;

  // Check if partsWorkflowData already has search data from previous searches
  const hasExistingData = Object.keys(partsWorkflowData.partAlternativesData).length > 1 ||
                          Object.keys(partsWorkflowData.searchResults).some(k =>
                            partsWorkflowData.searchResults[k] && partsWorkflowData.searchResults[k].length > 0
                          );

  // Only clear and reset if this is the first search from servers
  // If there's existing data, we're adding to previous searches
  if (previousWorkflow === 'servers' && !hasExistingData) {
    // Clear search results for fresh start
    Object.keys(searchResults).forEach(k => {
      if (partsWorkflowData.searchResults[k] !== undefined) {
        searchResults[k] = [];
      }
    });

    // Reset flags when starting fresh from servers
    activeRequestsCount = 0;
    expansionsInProgress = false;
    stopSearchRequested = false;
    analysisAlreadyCalled = false;
  }

  // Don't clear alternatives data - just add the new part entry
  // This preserves data from previous searches in parts workflow
  if (!partAlternativesData[partNumber]) {
    partAlternativesData[partNumber] = {
      description: null,
      category: null,
      original: partNumber,
      alternatives: []
    };
  }

  // Show spinner
  const spinner = document.getElementById('loading-spinner');
  const stopBtn = document.getElementById('stop-search-btn');
  if (spinner) spinner.style.display = 'inline-block';
  if (stopBtn) stopBtn.style.display = 'inline-block';

  // Start the actual search
  const globalAlreadySearched = new Set();

  mainSearchInProgress = true;

  // Execute search for this part number
  Promise.all(partNumbersArray.map(async (pn) => {
    if (stopSearchRequested) return;

    const finalAlternatives = [];

    // Get alternatives data
    const topData = await getAlternativePartNumbers(pn);
    const topOriginal = topData.original;

    // Store alternatives data
    partAlternativesData[pn] = {
      description: topData.description,
      category: topData.category,
      original: topOriginal,
      alternatives: finalAlternatives
    };

    // Update UI
    if (selectedPartNumber === pn) {
      updateAlternativesForSelectedPart();
    }

    // Callback for alternatives
    async function onNewAlts(newlyAdded) {
      if (stopSearchRequested) return;
      partAlternativesData[pn].alternatives = [...finalAlternatives];
      if (selectedPartNumber === pn) {
        updateAlternativesForSelectedPart();
      }
      const freshParts = [];
      for (const alt of newlyAdded) {
        const altUpper = alt.value.trim().toUpperCase();
        if (!globalAlreadySearched.has(altUpper)) {
          globalAlreadySearched.add(altUpper);
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

    globalAlreadySearched.add(topOriginal.trim().toUpperCase());
    await executeEndpointSearches([{ number: topOriginal, source: topOriginal }]);
  })).then(() => {
    mainSearchInProgress = false;

    // Save updated data to partsWorkflowData after search completes
    partsWorkflowData.searchResults = { ...searchResults };
    partsWorkflowData.partAlternativesData = { ...partAlternativesData };
    partsWorkflowData.selectedPartNumber = selectedPartNumber;

    checkIfAllDone();
  }).catch(err => {
    console.error('searchPartNumber search error:', err);
    mainSearchInProgress = false;
  });
}

function closeBarcodeModal() {
  const modal = document.getElementById('barcode-modal');
  modal.classList.remove('active');
}

// Close modal when clicking outside of it
document.addEventListener('click', function(event) {
  const modal = document.getElementById('barcode-modal');
  if (event.target === modal) {
    closeBarcodeModal();
  }
});