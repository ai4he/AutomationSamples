/*****************************************************
 * Configuration Variables
 *****************************************************/
var serverDomain = "gpu.haielab.org"; // or your actual domain

// Master toggles for alternative logic
let configUseAlternatives = true; // if false => skip alt logic entirely
let configNestedLevel = 1;        // 0, 1, 2... or -1 for unlimited

// Aggregator object for each endpoint's results
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
  purchases: []
};

// A global count of active fetch requests
let activeRequestsCount = 0;

// Whether alternative expansions (recursion) are still in progress
let expansionsInProgress = false;

// We'll store top-level info from the user’s original part
let topDescription = '';
let topCategory = '';

/*****************************************************
 * Helper: show/hide spinner AFTER everything is done
 * and call final LLM analysis once expansions + fetches are done
 *****************************************************/
function checkIfAllDone() {
  // If expansions are still ongoing or we have non-zero requests, we wait
  if (expansionsInProgress) return;
  if (activeRequestsCount > 0) return;

  // Otherwise, everything is done => hide spinner and run final analysis
  const spinner = document.getElementById('loading-spinner');
  if (spinner) spinner.style.display = 'none';

  performFinalAnalysis();
}

/*****************************************************
 * Final LLM Analysis once everything is done
 *****************************************************/
async function performFinalAnalysis() {
  const summaryDiv = document.getElementById('summary-content');
  // We can do a final summary update here, just to be safe:
  updateSummaryTab();

  try {
    const analysisData = gatherResultsForAnalysis();
    // (Optional) store original part number, or any alt array:
    // analysisData.originalPartNumber = ...
    // analysisData.alternativePartNumbers = ...

    const selectedModel = document.getElementById('llm-model').value;
    const promptText = document.getElementById('prompt').value;

    const analyzeUrl = `https://${serverDomain}/webhook/analyze-data?model=${selectedModel}&prompt=${encodeURIComponent(promptText)}`;
    const response = await fetch(analyzeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(analysisData)
    });
    const analyzeResult = await response.json();

    let text = '';
    if (Array.isArray(analyzeResult) && analyzeResult.length > 0 && analyzeResult[0].text) {
      text = analyzeResult[0].text;
    } else {
      text = JSON.stringify(analyzeResult);
    }
    text = text.replaceAll('```html', '').replaceAll('```', '');

    if (summaryDiv) {
      summaryDiv.innerHTML += `<h3>Analysis Summary</h3><div class="analyze-result-text">${text}</div>`;
    }
  } catch (err) {
    console.error('Analyze data error:', err);
  }
}

/*****************************************************
 * Helper to parse XML
 *****************************************************/
function parseXML(xmlString) {
  const parser = new DOMParser();
  return parser.parseFromString(xmlString, "text/xml");
}

/*****************************************************
 * Price parser (for eBay, Amazon, etc.)
 *****************************************************/
function parsePrice(str) {
  if (!str) return null;
  const numeric = parseFloat(str.replace(/[^\d.]/g, ''));
  return isNaN(numeric) ? null : numeric;
}

/*****************************************************
 * Table Sorting
 *****************************************************/
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

    const aNum = parseFloat(aText.replace(/[^0-9.-]/g, ""));
    const bNum = parseFloat(bText.replace(/[^0-9.-]/g, ""));
    if (!isNaN(aNum) && !isNaN(bNum)) {
      return asc ? aNum - bNum : bNum - aNum;
    }
    return asc ? aText.localeCompare(bText) : bText.localeCompare(aText);
  });
  rows.forEach(row => tbody.appendChild(row));
}

/*****************************************************
 * getAlternativePartNumbers - single-level fetch
 *****************************************************/
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

  } catch (error) {
    console.error('Error fetching alternative part numbers:', error);
    return { 
      original: partNumber,
      description: '',
      category: '',
      alternatives: []
    };
  }
}

/*****************************************************
 * Recursively gather alt part numbers up to configNestedLevel
 * onNewAlts(newlyAddedAlts) => partial expansions
 *****************************************************/
async function gatherCombinatoryAlternatives(baseNumber, currentLevel, visited, result, onNewAlts) {
  // If visited, skip
  const upper = baseNumber.trim().toUpperCase();
  if (visited.has(upper)) return;
  visited.add(upper);

  // fetch single-level
  const { alternatives } = await getAlternativePartNumbers(baseNumber);

  // add new results
  let newlyAdded = [];
  for (const alt of alternatives) {
    const altUpper = alt.value.trim().toUpperCase();
    if (!result.some(x => x.value.trim().toUpperCase() === altUpper)) {
      result.push(alt);
      newlyAdded.push(alt);
    }
  }

  if (newlyAdded.length > 0 && onNewAlts) {
    await onNewAlts(newlyAdded);
  }

  // decide if we go deeper
  let goDeeper = false;
  if (configNestedLevel === -1) {
    goDeeper = true;
  } else if (configNestedLevel > 0) {
    goDeeper = currentLevel < configNestedLevel;
  }

  if (goDeeper) {
    for (const alt of alternatives) {
      await gatherCombinatoryAlternatives(
        alt.value,
        currentLevel + 1,
        visited,
        result,
        onNewAlts
      );
    }
  }
}

/*****************************************************
 * The big handleSearch function
 *****************************************************/
async function handleSearch() {
  const partNumber = document.getElementById('part-numbers').value.trim();
  if (!partNumber) {
    alert('Please enter a part number');
    return;
  }

  // Clear out old summary, aggregator, counters
  const summaryDiv = document.getElementById('summary-content');
  if (summaryDiv) summaryDiv.innerHTML = '';

  topDescription = '';
  topCategory = '';

  // reset aggregator
  Object.keys(searchResults).forEach(k => {
    searchResults[k] = [];
  });

  activeRequestsCount = 0;
  expansionsInProgress = false;

  // Show spinner
  const spinner = document.getElementById('loading-spinner');
  if (spinner) spinner.style.display = 'inline-block';

  // This array will store the final alt objects {type, value}
  const finalAlternatives = [];

  // We'll store the top-level original from the user’s part
  let topOriginal = partNumber; // fallback if we can't fetch anything

  // A helper to re-render the alternative-numbers UI
  function updateAlternativeNumbersUI() {
    const altDiv = document.getElementById('alternative-numbers');
    if (!altDiv) return;

    let html = `
      <p><strong>Description:</strong> ${topDescription}</p>
      <p><strong>Category:</strong> ${topCategory}</p>
    `;
    if (finalAlternatives.length > 0) {
      html += `
        <h4>Alternative Part Numbers Found (up to level ${
          configNestedLevel === -1 ? '∞' : configNestedLevel
        }):</h4>
        <ul class="alternative-numbers-list">
          ${finalAlternatives.map(a => `
            <li class="alternative-number">
              <span>${a.type}: ${a.value}</span>
            </li>
          `).join('')}
        </ul>
      `;
    } else {
      html += `<p>No alternative part numbers found.</p>`;
    }
    altDiv.innerHTML = html;
    altDiv.classList.add('active');
  }

  // We also track which alt parts we have "sent" to the endpoint searches
  const alreadySearched = new Set();

  // This callback is used inside gatherCombinatoryAlternatives
  // to handle newly discovered alt parts
  async function onNewAlts(newlyAdded) {
    // 1) Update alt array UI
    updateAlternativeNumbersUI();

    // 2) Kick off searches for the newly added alts
    //    but only for those we haven't searched yet
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
    if (!configUseAlternatives) {
      // If alt logic is disabled, we only search for the original part
      const { original } = await getAlternativePartNumbers(partNumber);
      topOriginal = original;

      const altDiv = document.getElementById('alternative-numbers');
      if (altDiv) {
        altDiv.innerHTML = '<p>Alternative search is disabled.</p>';
      }

      // Now search for the user’s typed part
      alreadySearched.add(original.trim().toUpperCase());
      await executeEndpointSearches([{ number: original, source: original }]);
    } else {
      // If alt logic is enabled, fetch top-level for user’s input
      const topData = await getAlternativePartNumbers(partNumber);
      topOriginal = topData.original;
      topDescription = topData.description;
      topCategory = topData.category;

      // Start expansions
      expansionsInProgress = true;

      // We also want to search the user’s part right away
      alreadySearched.add(topOriginal.trim().toUpperCase());
      await executeEndpointSearches([{ number: topOriginal, source: topOriginal }]);

      // gather alt parts up to configNestedLevel
      const visited = new Set();
      await gatherCombinatoryAlternatives(
        topOriginal, 
        0, 
        visited, 
        finalAlternatives, 
        onNewAlts
      );

      // done expansions
      expansionsInProgress = false;
      // update UI one last time
      updateAlternativeNumbersUI();

      // we might do checkIfAllDone here in case expansions finished 
      // but no new requests are pending
      checkIfAllDone();
    }
  } catch (err) {
    console.error('handleSearch error:', err);
  }
}

/*****************************************************
 * The function that runs parallel searches for arrays 
 * of part numbers in each endpoint
 *****************************************************/
async function executeEndpointSearches(partNumbers) {
  if (!partNumbers || partNumbers.length === 0) return;
  
  // We'll run them in parallel
  const tasks = [];

  if (document.getElementById('toggle-inventory').checked) {
    tasks.push(fetchInventoryData(partNumbers));
  }
  if (document.getElementById('toggle-brokerbin').checked) {
    tasks.push(fetchBrokerBinData(partNumbers));
  }
  if (document.getElementById('toggle-tdsynnex').checked) {
    tasks.push(fetchTDSynnexData(partNumbers));
  }
  if (document.getElementById('toggle-ingram').checked) {
    tasks.push(fetchDistributorData(partNumbers));
  }
  if (document.getElementById('toggle-amazon-connector').checked) {
    tasks.push(fetchAmazonConnectorData(partNumbers));
  }
  if (document.getElementById('toggle-ebay-connector').checked) {
    tasks.push(fetchEbayConnectorData(partNumbers));
  }
  if (document.getElementById('toggle-amazon').checked) {
    tasks.push(fetchAmazonData(partNumbers));
  }
  if (document.getElementById('toggle-ebay').checked) {
    tasks.push(fetchEbayData(partNumbers));
  }
  // Sales, Purchases
  tasks.push(fetchSalesData(partNumbers));
  tasks.push(fetchPurchasesData(partNumbers));

  // We'll just await them all
  await Promise.all(tasks);

  // (Lenovo can be called separately, or you can do it here.)
  if (document.getElementById('toggle-lenovo').checked) {
    tasks.length = 0; // re-use array
    tasks.push(fetchLenovoData(partNumbers));
    await Promise.all(tasks);
  }
}

/*****************************************************
 * Each endpoint fetch function merges new data 
 * into searchResults[...] and rebuilds the entire table
 *****************************************************/

// 1) TDSynnex
async function fetchTDSynnexData(partNumbers) {
  if (!partNumbers || partNumbers.length === 0) return;
  activeRequestsCount++;

  const loading = document.querySelector('.tdsynnex-results .loading');
  if (loading) loading.style.display = 'block';

  try {
    const newItems = [];
    for (const { number, source } of partNumbers) {
      try {
        const response = await fetch(`https://${serverDomain}/webhook/tdsynnex-search?item=${encodeURIComponent(number)}`);
        if (!response.ok) continue;
        const xmlText = await response.text();
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
      } catch (e) {
        console.warn('TDSynnex error:', e);
      }
    }
    // Merge
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

  const items = searchResults.tdsynnex;
  if (items.length === 0) return;

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
      ${items.map(item => `
        <tr>
          <td>${item.sourcePartNumber}</td>
          <td>${item.synnexSKU}</td>
          <td>${item.mfgPN}</td>
          <td>${item.description}</td>
          <td>${item.status}</td>
          <td>${item.price}</td>
          <td>${item.totalQuantity}</td>
          <td>
            ${item.warehouses.map(w => `${w.city}: ${w.qty}`).join('<br>')}
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

// 2) Ingram
async function fetchDistributorData(partNumbers) {
  if (!partNumbers || partNumbers.length === 0) return;
  activeRequestsCount++;

  const loading = document.querySelector('#distributors-content .loading');
  const resultsDiv = document.querySelector('#distributors-content .ingram-results .results-container');
  if (loading) loading.style.display = 'block';

  try {
    const newItems = [];
    for (const { number, source } of partNumbers) {
      try {
        const response = await fetch(`https://${serverDomain}/webhook/ingram-search?item=${encodeURIComponent(number)}`);
        if (!response.ok) continue;
        const data = await response.json();
        const resultsWithSource = data.map(d => ({ ...d, sourcePartNumber: source }));
        newItems.push(...resultsWithSource);
      } catch (err) {
        console.warn('Ingram error:', err);
      }
    }
    searchResults.ingram.push(...newItems);
    buildIngramTable();
  } catch (error) {
    console.error('fetchDistributorData error:', error);
    if (resultsDiv) {
      resultsDiv.innerHTML = `<div class="error">Error: ${error.message}</div>`;
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
      ${items.map(item => `
        <tr>
          <td>${item.sourcePartNumber}</td>
          <td>${item.description || '-'}</td>
          <td>${item.category || '-'}</td>
          <td>${item.vendorName || '-'}</td>
          <td>${item.vendorPartNumber || '-'}</td>
          <td>${item.upcCode || '-'}</td>
          <td>${item.productType || '-'}</td>
          <td>
            ${item.discontinued === 'True' ? '<span class="text-error">Discontinued</span>' : ''}
            ${item.newProduct === 'True' ? '<span class="text-success">New</span>' : ''}
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
  if (!partNumbers || partNumbers.length === 0) return;
  activeRequestsCount++;

  const loading = document.querySelector('.brokerbin-results .loading');
  const resultsDiv = document.querySelector('.brokerbin-results .results-container');
  if (loading) loading.style.display = 'block';

  try {
    const newItems = [];
    for (const { number, source } of partNumbers) {
      try {
        const response = await fetch(`https://${serverDomain}/webhook/brokerbin-search?item=${encodeURIComponent(number)}`);
        if (!response.ok) continue;
        const data = await response.json();
        const resultsWithSource = data.map(d => ({ ...d, sourcePartNumber: source }));
        newItems.push(...resultsWithSource);
      } catch (err) {
        console.warn('BrokerBin error:', err);
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
      ${items.map(item => `
        <tr>
          <td>${item.sourcePartNumber}</td>
          <td>${item.company || '-'}</td>
          <td>${item.country || '-'}</td>
          <td>${item.part || '-'}</td>
          <td>${item.mfg || '-'}</td>
          <td>${item.cond || '-'}</td>
          <td>${item.description || '-'}</td>
          <td>${item.price ? '$' + parseFloat(item.price).toFixed(2) : '-'}</td>
          <td>${item.qty || '0'}</td>
          <td>${item.age_in_days || '-'}</td>
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

// 4) Inventory (Epicor)
async function fetchInventoryData(partNumbers) {
  if (!partNumbers || partNumbers.length === 0) return;
  activeRequestsCount++;

  const loading = document.querySelector('#inventory-content .loading');
  const resultsDiv = document.querySelector('#inventory-content .inventory-results');
  if (loading) loading.style.display = 'block';

  try {
    const newItems = [];
    for (const { number, source } of partNumbers) {
      try {
        const response = await fetch(`https://${serverDomain}/webhook/epicor-search?item=${encodeURIComponent(number)}`);
        if (!response.ok) continue;
        const data = await response.json();
        const resultsWithSource = data.map(d => ({ ...d, sourcePartNumber: source }));
        newItems.push(...resultsWithSource);
      } catch (err) {
        console.warn('Epicor inventory error:', err);
      }
    }
    searchResults.epicor.push(...newItems);
    buildEpicorInventoryTable();
  } catch (error) {
    console.error('fetchInventoryData error:', error);
    if (resultsDiv) {
      resultsDiv.innerHTML = `<div class="error">Error: ${error.message}</div>`;
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

  const items = searchResults.epicor;
  if (items.length === 0) return;

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
        <th>Status</th>
      </tr>
    </thead>
    <tbody>
      ${items.map(item => `
        <tr>
          <td>${item.sourcePartNumber}</td>
          <td>${item.Company || '-'}</td>
          <td>${item.PartNum?.trim() || '-'}</td>
          <td>${item.PartDescription || '-'}</td>
          <td>${item.ClassDescription || '-'}</td>
          <td>${item.ProdCodeDescription || '-'}</td>
          <td>${item.InActive ? '<span class="text-error">Inactive</span>' : '<span class="text-success">Active</span>'}</td>
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
  if (!partNumbers || partNumbers.length === 0) return;
  activeRequestsCount++;

  const loading = document.querySelector('#sales-content .loading');
  const resultsDiv = document.querySelector('#sales-content .sales-results');
  if (loading) loading.style.display = 'block';

  try {
    const newItems = [];
    for (const { number, source } of partNumbers) {
      try {
        const response = await fetch(`https://${serverDomain}/webhook/epicor-sales?item=${encodeURIComponent(number)}`);
        if (!response.ok) continue;
        const data = await response.json();
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
        console.warn('Sales error:', err);
      }
    }
    searchResults.sales.push(...newItems);
    buildSalesTable();
  } catch (error) {
    console.error('fetchSalesData error:', error);
    if (resultsDiv) {
      resultsDiv.innerHTML = `<div class="error">Error: ${error.message}</div>`;
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
      ${items.map(item => `
        <tr>
          <td>${item.sourcePartNumber}</td>
          <td>${item.PartNum || '-'}</td>
          <td>${item.LineDesc || '-'}</td>
          <td>${item.OrderNum || '-'}</td>
          <td>${item.OrderLine || '-'}</td>
          <td>${item.CustomerID || '-'}</td>
          <td>${item.CustomerName || '-'}</td>
          <td>${item.OrderDate ? new Date(item.OrderDate).toLocaleDateString() : '-'}</td>
          <td>${item.OrderQty || '-'}</td>
          <td>${item.UnitPrice || '-'}</td>
          <td>${item.RequestDate ? new Date(item.RequestDate).toLocaleDateString() : '-'}</td>
          <td>${item.NeedByDate ? new Date(item.NeedByDate).toLocaleDateString() : '-'}</td>
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
  if (!partNumbers || partNumbers.length === 0) return;
  activeRequestsCount++;

  const loading = document.querySelector('#purchases-content .loading');
  const resultsDiv = document.querySelector('#purchases-content .purchases-results');
  if (loading) loading.style.display = 'block';

  try {
    const newItems = [];
    for (const { number, source } of partNumbers) {
      try {
        const response = await fetch(`https://${serverDomain}/webhook/epicor-purchases?item=${encodeURIComponent(number)}`);
        if (!response.ok) continue;
        const data = await response.json();
        data.forEach(entry => {
          const purchasedItems = entry?.returnObj?.PAPurchasedBefore || [];
          purchasedItems.forEach(line => {
            newItems.push({
              sourcePartNumber: source,
              PartNum: line.PartNum,
              VendorName: line.VendorName,
              VendorQty: line.VendorQty,
              VendorUnitCost: line.VendorUnitCost,
              ReceiptDate: line.ReceiptDate,
              OrderDate: line.OrderDate,
              DueDate: line.DueDate,
              PONum: line.PONum
            });
          });
        });
      } catch (err) {
        console.warn('Purchases error:', err);
      }
    }
    searchResults.purchases.push(...newItems);
    buildPurchasesTable();
  } catch (error) {
    console.error('fetchPurchasesData error:', error);
    if (resultsDiv) {
      resultsDiv.innerHTML = `<div class="error">Error: ${error.message}</div>`;
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

  const items = searchResults.purchases;
  if (items.length === 0) return;

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
      </tr>
    </thead>
    <tbody>
      ${items.map(item => `
        <tr>
          <td>${item.sourcePartNumber}</td>
          <td>${item.PartNum || '-'}</td>
          <td>${item.VendorName || '-'}</td>
          <td>${item.VendorQty || '-'}</td>
          <td>${item.VendorUnitCost != null ? item.VendorUnitCost : '-'}</td>
          <td>${item.PONum || '-'}</td>
          <td>${item.ReceiptDate ? new Date(item.ReceiptDate).toLocaleDateString() : '-'}</td>
          <td>${item.OrderDate ? new Date(item.OrderDate).toLocaleDateString() : '-'}</td>
          <td>${item.DueDate ? new Date(item.DueDate).toLocaleDateString() : '-'}</td>
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
  if (!document.getElementById('toggle-amazon-connector').checked) return;
  if (!partNumbers || partNumbers.length === 0) return;
  activeRequestsCount++;

  const loading = document.querySelector('.amazon-connector-results .loading');
  const resultsDiv = document.querySelector('.amazon-connector-results .results-container');
  if (loading) loading.style.display = 'block';

  try {
    const newItems = [];
    for (const { number, source } of partNumbers) {
      try {
        const response = await fetch(`https://${serverDomain}/webhook/amazon-search?item=${encodeURIComponent(number)}`);
        if (!response.ok) continue;
        const data = await response.json();
        data.forEach(item => {
          newItems.push({ ...item, sourcePartNumber: source });
        });
      } catch (err) {
        console.warn('AmazonConnector error:', err);
      }
    }
    searchResults.amazonConnector.push(...newItems);
    buildAmazonConnectorTable();
  } catch (error) {
    console.error('fetchAmazonConnectorData error:', error);
    if (resultsDiv) {
      resultsDiv.innerHTML = `<div class="error">Error: ${error.message}</div>`;
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
            <img src="${it.thumbnailImage || '-'}" alt="${it.title}" class="product-image">
          </td>
          <td>
            <a href="${it.url}" target="_blank">${it.title || '-'}</a>
          </td>
          <td>${it.price ? (it.price.currency + it.price.value) : '-'}</td>
          <td>${it.listPrice ? (it.listPrice.currency + it.listPrice.value) : '-'}</td>
          <td>${it.stars ? `${it.stars}/5` : '-'}</td>
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
  if (!document.getElementById('toggle-ebay-connector').checked) return;
  if (!partNumbers || partNumbers.length === 0) return;
  activeRequestsCount++;

  const loading = document.querySelector('.ebay-connector-results .loading');
  const resultsDiv = document.querySelector('.ebay-connector-results .results-container');
  if (loading) loading.style.display = 'block';

  try {
    const newItems = [];
    for (const { number, source } of partNumbers) {
      try {
        const response = await fetch(`https://${serverDomain}/webhook/ebay-search?item=${encodeURIComponent(number)}`);
        if (!response.ok) continue;
        const data = await response.json();
        data.forEach(item => {
          newItems.push({ ...item, sourcePartNumber: source });
        });
      } catch (err) {
        console.warn('eBayConnector error:', err);
      }
    }
    searchResults.ebayConnector.push(...newItems);
    buildEbayConnectorTable();
  } catch (error) {
    console.error('fetchEbayConnectorData error:', error);
    if (resultsDiv) {
      resultsDiv.innerHTML = `<div class="error">Error: ${error.message}</div>`;
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
          <td>
            <a href="${it.url}" target="_blank">${it.title}</a>
          </td>
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
  if (!document.getElementById('toggle-amazon').checked) return;
  if (!partNumbers || partNumbers.length === 0) return;
  activeRequestsCount++;

  const loading = document.querySelector('.amazon-results .loading');
  const resultsDiv = document.querySelector('.amazon-results .results-container');
  if (loading) loading.style.display = 'block';

  try {
    const newItems = [];
    for (const { number, source } of partNumbers) {
      try {
        const response = await fetch(`https://${serverDomain}/webhook/amazon-scraper?item=${encodeURIComponent(number)}`);
        if (!response.ok) continue;
        const data = await response.json();
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
        console.warn('AmazonScraper error:', err);
      }
    }
    searchResults.amazon.push(...newItems);
    buildAmazonScraperTable();
  } catch (error) {
    console.error('fetchAmazonData error:', error);
    if (resultsDiv) {
      resultsDiv.innerHTML = `<div class="error">Error: ${error.message}</div>`;
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
  if (!document.getElementById('toggle-ebay').checked) return;
  if (!partNumbers || partNumbers.length === 0) return;
  activeRequestsCount++;

  const loading = document.querySelector('.ebay-results .loading');
  const resultsDiv = document.querySelector('.ebay-results .results-container');
  if (loading) loading.style.display = 'block';

  try {
    const newItems = [];
    for (const { number, source } of partNumbers) {
      try {
        const response = await fetch(`https://${serverDomain}/webhook/ebay-scraper?item=${encodeURIComponent(number)}`);
        if (!response.ok) continue;
        const data = await response.json();
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
        console.warn('EbayScraper error:', err);
      }
    }
    searchResults.ebay.push(...newItems);
    buildEbayScraperTable();
  } catch (error) {
    console.error('fetchEbayData error:', error);
    if (resultsDiv) {
      resultsDiv.innerHTML = `<div class="error">Error: ${error.message}</div>`;
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

/*****************************************************
 * Lenovo (if toggled) 
 *****************************************************/
async function fetchLenovoData(partNumbers) {
  if (!document.getElementById('toggle-lenovo').checked) return;
  if (!partNumbers || partNumbers.length === 0) return;
  // We do not necessarily increment activeRequestsCount if Lenovo is separate
  activeRequestsCount++;

  const lenovoContentDiv = document.getElementById('lenovo-content');
  if (!lenovoContentDiv) {
    console.error('Lenovo content div not found');
    return;
  }

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

  subtabs.innerHTML = '<div class="loading">Loading Lenovo data...</div>';
  subcontent.innerHTML = '';

  try {
    const allResults = [];
    for (const { number, source } of partNumbers) {
      try {
        const response = await fetch(`https://${serverDomain}/webhook/lenovo-scraper?item=${encodeURIComponent(number)}`);
        if (!response.ok) continue;
        const data = await response.json();
        if (data?.[0]?.data?.length > 0) {
          // Filter out empty docs
          const docs = data[0].data
            .filter(doc => doc && doc.content && doc.content.trim() !== '')
            .map(doc => ({ ...doc, sourcePartNumber: source }));
          if (docs.length > 0) {
            allResults.push(...docs);
          }
        }
      } catch (error) {
        console.warn('Lenovo error for', number, error);
      }
    }

    subtabs.innerHTML = '';
    subcontent.innerHTML = '';

    if (allResults.length > 0) {
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
    } else {
      subtabs.innerHTML = '<div class="error">No Lenovo data found</div>';
    }

  } catch (err) {
    console.error('Lenovo data fetch error:', err);
    subtabs.innerHTML = `<div class="error">Error fetching Lenovo data: ${err.message}</div>`;
  } finally {
    activeRequestsCount--;
    checkIfAllDone();
  }
}

function switchLenovoSubtab(index) {
  document.querySelectorAll('.subtab-button').forEach(button => button.classList.remove('active'));
  document.querySelectorAll('.subtab-content').forEach(content => content.classList.remove('active'));
  const btns = document.querySelectorAll('.subtab-button');
  if (btns[index]) btns[index].classList.add('active');
  const contentDiv = document.querySelector(`.subtab-content[data-subtab-index="${index}"]`);
  if (contentDiv) contentDiv.classList.add('active');
}

function decodeUnicodeEscapes(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/\\u[\dA-F]{4}/gi, match => 
    String.fromCharCode(parseInt(match.replace(/\\u/g, ''), 16))
  );
}

/*****************************************************
 * Summary Tab
 *****************************************************/
function updateSummaryTab() {
  const summaryDiv = document.getElementById('summary-content');
  if (!summaryDiv) return;

  // preserve any existing top text with .analyze-result-text, if needed
  const existingAnalyzeMessage = summaryDiv.querySelector('.analyze-result-text');
  let topMessageHTML = '';
  if (existingAnalyzeMessage) {
    topMessageHTML = existingAnalyzeMessage.outerHTML;
  }
  summaryDiv.innerHTML = topMessageHTML; 

  // If no toggles are on, just show "No search results yet."
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
    summaryDiv.innerHTML += 'No search results yet.';
    return;
  }

  // Helper to create summary blocks
  function createSummaryTable(key, label) {
    const dataArray = searchResults[key] || [];
    if (!dataArray.length) return '';

    // Group by sourcePartNumber
    const grouped = {};
    dataArray.forEach(item => {
      const pnum = item.sourcePartNumber || 'Unknown';
      if (!grouped[pnum]) grouped[pnum] = [];
      grouped[pnum].push(item);
    });

    // find best price
    function findBestPrice(itemList) {
      let minPrice = null;
      itemList.forEach(it => {
        let priceVal = null;
        switch (key) {
          case 'amazonConnector':
            if (it.price && it.price.value) {
              priceVal = parseFloat(it.price.value);
            }
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

  if (!summaryHTML.trim()) {
    summaryDiv.innerHTML += 'No search results yet.';
  } else {
    summaryDiv.innerHTML += summaryHTML;
  }
}

/*****************************************************
 * gatherResultsForAnalysis
 * Gathers the final HTML from each container for LLM analysis
 *****************************************************/
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
    const amzElem = document.querySelector('.amazon-results .results-container');
    results['amazon-scraper'] = amzElem ? amzElem.innerHTML : "";
  }
  if (document.getElementById('toggle-ebay').checked) {
    const eScrElem = document.querySelector('.ebay-results .results-container');
    results['ebay-scraper'] = eScrElem ? eScrElem.innerHTML : "";
  }

  return results;
}

/*****************************************************
 * Google/MS sign-in from your existing code
 *****************************************************/
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
