var serverDomain = "gpu.haielab.org";
// var serverDomain = "n8n.haielab.org";

// Master object storing each endpoint’s results
let searchResults = {
  // The old Amazon code => amazonConnector
  amazonConnector: [],
  // The old eBay code => ebayConnector
  ebayConnector: [],

  // The "new" Amazon (was AmazonScraper)
  amazon: [],
  // The "new" eBay (was eBayScraper)
  ebay: [],

  ingram: [],
  tdsynnex: [],
  brokerbin: [],
  epicor: []
};

// ============= New: helper to check all visible checkboxes ============
function selectAllVisible() {
  // Find all labels that are NOT hidden, then check the associated checkbox
  const visibleLabels = document.querySelectorAll('.checkbox-group label:not([style*="display: none"]) input[type="checkbox"]');
  visibleLabels.forEach(chk => {
    chk.checked = true;
  });
}

// ====================== Utility functions ======================

async function getAlternativePartNumbers(partNumber) {
  try {
    const response = await fetch(`https://${serverDomain}/webhook/get-parts?item=${encodeURIComponent(partNumber)}`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    if (!data || !data[0]) {
      return { original: partNumber, alternatives: [] };
    }

    const alternatives = [
      ...(data[0].FRU || []),
      ...(data[0].MFG || []),
      ...(data[0].OEM || []),
      ...(data[0].OPT || [])
    ];

    const alternativeNumbersDiv = document.getElementById('alternative-numbers');
    if (alternatives.length > 0) {
      alternativeNumbersDiv.innerHTML = `
        <h4>Alternative Part Numbers Found:</h4>
        <ul class="alternative-numbers-list">
          ${alternatives.map(num => `<li class="alternative-number"><span>${num}</span></li>`).join('')}
        </ul>
      `;
      alternativeNumbersDiv.classList.add('active');
    } else {
      alternativeNumbersDiv.innerHTML = '<p>No alternative part numbers found.</p>';
    }

    return {
      original: data[0].ORD,
      alternatives
    };
  } catch (error) {
    console.error('Error fetching alternative part numbers:', error);
    return { original: partNumber, alternatives: [] };
  }
}

function switchTab(tabId) {
  document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
  document.querySelectorAll('.tab-button').forEach(button => button.classList.remove('active'));
  document.getElementById(tabId).classList.add('active');
  document.querySelector(`button[onclick="switchTab('${tabId}')"]`).classList.add('active');
}

function parseXML(xmlString) {
  const parser = new DOMParser();
  return parser.parseFromString(xmlString, "text/xml");
}

// Helper parse function for e.g. "$123.45"
function parsePrice(str) {
  if (!str) return null;
  const numeric = parseFloat(str.replace(/[^\d.]/g, ''));
  return isNaN(numeric) ? null : numeric;
}

// ====================== Old Amazon => AmazonConnector ======================
async function fetchAmazonConnectorData(partNumbers) {
  if (!document.getElementById('toggle-amazon-connector').checked) {
    return;
  }
  searchResults.amazonConnector = [];

  const loading = document.querySelector('.amazon-connector-results .loading');
  const resultsDiv = document.querySelector('.amazon-connector-results .results-container');
  if (loading) loading.style.display = 'block';
  if (resultsDiv) resultsDiv.innerHTML = '';

  try {
    const allResults = [];
    for (const { number, source } of partNumbers) {
      try {
        // The old endpoint: /webhook/amazon-search
        const response = await fetch(`https://${serverDomain}/webhook/amazon-search?item=${encodeURIComponent(number)}`);
        if (!response.ok) {
          console.warn(`Warning: Failed to fetch AmazonConnector data for part number ${number}`);
          continue;
        }
        const data = await response.json();
        const resultsWithSource = data.map(item => ({ ...item, sourcePartNumber: source }));
        allResults.push(...resultsWithSource);
      } catch (error) {
        console.warn(`Error in AmazonConnector for part number ${number}:`, error);
      }
    }

    searchResults.amazonConnector = allResults;

    // Build table (even if hidden)
    if (resultsDiv) {
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
          ${allResults.map(item => `
            <tr>
              <td>${item.sourcePartNumber}</td>
              <td class="image-cell">
                <img src="${item.thumbnailImage || '-'}" alt="${item.title}" class="product-image">
              </td>
              <td><a href="${item.url}" target="_blank">${item.title}</a></td>
              <td>${item.price ? `${item.price.currency}${item.price.value}` : '-'}</td>
              <td>${item.listPrice ? `${item.listPrice.currency}${item.listPrice.value}` : '-'}</td>
              <td>${item.stars ? `${item.stars}/5` : '-'}</td>
              <td>${item.reviewsCount || '0'}</td>
              <td>${item.inStockText || '-'}</td>
              <td>${item.seller?.name || '-'}</td>
            </tr>
          `).join('')}
        </tbody>
      `;
      resultsDiv.appendChild(table);
    }

  } catch (error) {
    if (resultsDiv) {
      resultsDiv.innerHTML = `<div class="error">Error fetching AmazonConnector data: ${error.message}</div>`;
    }
  } finally {
    if (loading) loading.style.display = 'none';
  }
}

// ====================== Old eBay => eBayConnector ======================
async function fetchEbayConnectorData(partNumbers) {
  if (!document.getElementById('toggle-ebay-connector').checked) {
    return;
  }
  searchResults.ebayConnector = [];

  const loading = document.querySelector('.ebay-connector-results .loading');
  const resultsDiv = document.querySelector('.ebay-connector-results .results-container');
  if (loading) loading.style.display = 'block';
  if (resultsDiv) resultsDiv.innerHTML = '';

  try {
    const allResults = [];
    for (const { number, source } of partNumbers) {
      try {
        // The old endpoint: /webhook/ebay-search
        const response = await fetch(`https://${serverDomain}/webhook/ebay-search?item=${encodeURIComponent(number)}`);
        if (!response.ok) {
          console.warn(`Warning: Failed to fetch eBayConnector data for part number ${number}`);
          continue;
        }
        const data = await response.json();
        const resultsWithSource = data.map(item => ({ ...item, sourcePartNumber: source }));
        allResults.push(...resultsWithSource);
      } catch (error) {
        console.warn(`Error in eBayConnector for part number ${number}:`, error);
      }
    }

    searchResults.ebayConnector = allResults;

    // Build table (even if hidden)
    if (resultsDiv) {
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
          ${allResults.map(item => `
            <tr>
              <td>${item.sourcePartNumber}</td>
              <td class="image-cell">
                ${item.images && item.images.length > 0 
                  ? `<img src="${item.images[0]}" alt="${item.title}" class="product-image">`
                  : '-'}
              </td>
              <td><a href="${item.url}" target="_blank">${item.title}</a></td>
              <td>${item.priceWithCurrency || '-'}</td>
              <td>${item.condition || '-'}</td>
              <td><a href="${item.sellerUrl}" target="_blank">${item.sellerName}</a></td>
              <td>${item.itemLocation || '-'}</td>
              <td>${item.shipping || '-'}</td>
            </tr>
          `).join('')}
        </tbody>
      `;
      resultsDiv.appendChild(table);
    }

  } catch (error) {
    if (resultsDiv) {
      resultsDiv.innerHTML = `<div class="error">Error fetching eBayConnector data: ${error.message}</div>`;
    }
  } finally {
    if (loading) loading.style.display = 'none';
  }
}

// ====================== New Amazon (was AmazonScraper) ======================
async function fetchAmazonData(partNumbers) {
  if (!document.getElementById('toggle-amazon').checked) return;
  searchResults.amazon = [];

  const loading = document.querySelector('.amazon-results .loading');
  const resultsDiv = document.querySelector('.amazon-results .results-container');
  loading.style.display = 'block';
  resultsDiv.innerHTML = '';

  try {
    const allResults = [];
    for (const { number, source } of partNumbers) {
      try {
        const response = await fetch(`https://${serverDomain}/webhook/amazon-scraper?item=${encodeURIComponent(number)}`);
        if (!response.ok) {
          console.warn(`Warning: Failed to fetch Amazon (Scraper) data for part number ${number}`);
          continue;
        }
        const data = await response.json();
        // We expect data like: [ { title: [...], price: [...] } ]
        if (Array.isArray(data) && data.length > 0 && data[0].title && data[0].price) {
          const titleArr = data[0].title;
          const priceArr = data[0].price;
          for (let i = 0; i < titleArr.length; i++) {
            allResults.push({
              sourcePartNumber: source,
              title: titleArr[i] || '-',
              rawPrice: priceArr[i] || '-'
            });
          }
        }
      } catch (error) {
        console.warn(`Error in Amazon (Scraper) for part number ${number}:`, error);
      }
    }

    searchResults.amazon = allResults;

    // Build table
    const table = document.createElement('table');
    table.innerHTML = `
      <thead>
        <tr>
          <th>Source Part</th>
          <th>Title</th>
          <th>Price</th>
        </tr>
      </thead>
      <tbody>
        ${allResults.map(item => `
          <tr>
            <td>${item.sourcePartNumber}</td>
            <td>${item.title}</td>
            <td>${item.rawPrice}</td>
          </tr>
        `).join('')}
      </tbody>
    `;
    resultsDiv.appendChild(table);

  } catch (error) {
    resultsDiv.innerHTML = `<div class="error">Error fetching Amazon data: ${error.message}</div>`;
  } finally {
    loading.style.display = 'none';
  }
}

// ====================== New eBay (was eBayScraper) ======================
async function fetchEbayData(partNumbers) {
  if (!document.getElementById('toggle-ebay').checked) return;
  searchResults.ebay = [];

  const loading = document.querySelector('.ebay-results .loading');
  const resultsDiv = document.querySelector('.ebay-results .results-container');
  loading.style.display = 'block';
  resultsDiv.innerHTML = '';

  try {
    const allResults = [];
    for (const { number, source } of partNumbers) {
      try {
        const response = await fetch(`https://${serverDomain}/webhook/ebay-scraper?item=${encodeURIComponent(number)}`);
        if (!response.ok) {
          console.warn(`Warning: Failed to fetch eBay (Scraper) data for part number ${number}`);
          continue;
        }
        const data = await response.json();
        if (Array.isArray(data) && data.length > 0 && data[0].title && data[0].price) {
          const titles = data[0].title;
          const prices = data[0].price;
          for (let i = 0; i < titles.length; i++) {
            allResults.push({
              sourcePartNumber: source,
              title: titles[i] || '-',
              rawPrice: prices[i] || '-'
            });
          }
        }
      } catch (error) {
        console.warn(`Error in eBay (Scraper) for part number ${number}:`, error);
      }
    }

    searchResults.ebay = allResults;

    const table = document.createElement('table');
    table.innerHTML = `
      <thead>
        <tr>
          <th>Source Part</th>
          <th>Title</th>
          <th>Price</th>
        </tr>
      </thead>
      <tbody>
        ${allResults.map(item => `
          <tr>
            <td>${item.sourcePartNumber}</td>
            <td>${item.title}</td>
            <td>${item.rawPrice}</td>
          </tr>
        `).join('')}
      </tbody>
    `;
    resultsDiv.appendChild(table);

  } catch (error) {
    resultsDiv.innerHTML = `<div class="error">Error fetching eBay data: ${error.message}</div>`;
  } finally {
    loading.style.display = 'none';
  }
}

// ====================== Distributors & Inventory (unchanged) ======================
async function fetchTDSynnexData(partNumbers) {
  if (!document.getElementById('toggle-tdsynnex').checked) return;
  searchResults.tdsynnex = [];

  const loading = document.querySelector('.tdsynnex-results .loading');
  const resultsDiv = document.querySelector('.tdsynnex-results .results-container');
  loading.style.display = 'block';
  resultsDiv.innerHTML = '';

  try {
    const allResults = [];
    for (const { number, source } of partNumbers) {
      try {
        const response = await fetch(`https://${serverDomain}/webhook/tdsynnex-search?item=${encodeURIComponent(number)}`);
        if (!response.ok) {
          console.warn(`Warning: Failed to fetch TDSynnex data for part number ${number}`);
          continue;
        }
        const xmlText = await response.text();
        const xmlDoc = parseXML(xmlText);

        const priceList = xmlDoc.getElementsByTagName('PriceAvailabilityList')[0];
        if (!priceList) {
          console.warn(`Warning: No price availability data found for part number ${number}`);
          continue;
        }

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
        allResults.push(result);
      } catch (error) {
        console.warn(`Error processing TDSynnex data for part number ${number}:`, error);
      }
    }

    searchResults.tdsynnex = allResults;

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
        ${allResults.map(item => `
          <tr>
            <td>${item.sourcePartNumber}</td>
            <td>${item.synnexSKU}</td>
            <td>${item.mfgPN}</td>
            <td>${item.description}</td>
            <td>${item.status}</td>
            <td>${item.price}</td>
            <td>${item.totalQuantity}</td>
            <td>
              ${item.warehouses.map(wh => `${wh.city}: ${wh.qty} units`).join('<br>')}
            </td>
          </tr>
        `).join('')}
      </tbody>
    `;
    resultsDiv.appendChild(table);

  } catch (error) {
    resultsDiv.innerHTML = `<div class="error">Error fetching TDSynnex data: ${error.message}</div>`;
  } finally {
    loading.style.display = 'none';
  }
}

async function fetchDistributorData(partNumbers) {
  if (!document.getElementById('toggle-ingram').checked) return;
  searchResults.ingram = [];

  const loading = document.querySelector('#distributors-content .loading');
  const resultsDiv = document.querySelector('#distributors-content .ingram-results .results-container');
  loading.style.display = 'block';
  resultsDiv.innerHTML = '';

  try {
    const allResults = [];
    for (const { number, source } of partNumbers) {
      try {
        const response = await fetch(`https://${serverDomain}/webhook/ingram-search?item=${encodeURIComponent(number)}`);
        if (!response.ok) {
          console.warn(`Warning: Failed to fetch Ingram data for part number ${number}`);
          continue;
        }
        const data = await response.json();
        const resultsWithSource = data.map(item => ({ ...item, sourcePartNumber: source }));
        allResults.push(...resultsWithSource);
      } catch (error) {
        console.warn(`Error processing Ingram data for part number ${number}:`, error);
      }
    }

    searchResults.ingram = allResults;

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
        ${allResults.map(item => `
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
    resultsDiv.appendChild(table);

  } catch (error) {
    resultsDiv.innerHTML = `<div class="error">Error fetching distributor data: ${error.message}</div>`;
  } finally {
    loading.style.display = 'none';
  }
}

async function fetchBrokerBinData(partNumbers) {
  if (!document.getElementById('toggle-brokerbin').checked) return;
  searchResults.brokerbin = [];

  const loading = document.querySelector('.brokerbin-results .loading');
  const resultsDiv = document.querySelector('.brokerbin-results .results-container');
  loading.style.display = 'block';
  resultsDiv.innerHTML = '';

  try {
    const allResults = [];
    for (const { number, source } of partNumbers) {
      try {
        const response = await fetch(`https://${serverDomain}/webhook/brokerbin-search?item=${encodeURIComponent(number)}`);
        if (!response.ok) {
          console.warn(`Warning: Failed to fetch BrokerBin data for part number ${number}`);
          continue;
        }
        const data = await response.json();
        const resultsWithSource = data.map(item => ({ ...item, sourcePartNumber: source }));
        allResults.push(...resultsWithSource);
      } catch (error) {
        console.warn(`Error processing BrokerBin data for part number ${number}:`, error);
      }
    }

    searchResults.brokerbin = allResults;

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
        ${allResults.map(item => `
          <tr>
            <td>${item.sourcePartNumber}</td>
            <td>${item.company || '-'}</td>
            <td>${item.country || '-'}</td>
            <td>${item.part || '-'}</td>
            <td>${item.mfg || '-'}</td>
            <td>${item.cond || '-'}</td>
            <td>${item.description || '-'}</td>
            <td>${item.price ? '$' + item.price.toFixed(2) : '-'}</td>
            <td>${item.qty || '0'}</td>
            <td>${item.age_in_days}</td>
          </tr>
        `).join('')}
      </tbody>
    `;
    resultsDiv.appendChild(table);

  } catch (error) {
    resultsDiv.innerHTML = `<div class="error">Error fetching BrokerBin data: ${error.message}</div>`;
  } finally {
    loading.style.display = 'none';
  }
}

// ====================== Lenovo (unchanged) ======================
async function fetchLenovoData(partNumbers) {
  if (!document.getElementById('toggle-lenovo').checked) return;

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
        if (!response.ok) {
          console.warn(`Warning: Failed to fetch Lenovo data for part number ${number}`);
          continue;
        }
        const data = await response.json();
        if (data?.[0]?.data?.length > 0) {
          const docs = data[0].data.filter(doc => doc).map(doc => ({
            ...doc,
            sourcePartNumber: source
          }));
          allResults.push(...docs);
        }
      } catch (error) {
        console.warn(`Error processing Lenovo data for part number ${number}:`, error);
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

        let processedContent = doc.content
          ? decodeUnicodeEscapes(doc.content)
          : '<div class="error">No content available</div>';

        if (doc.content && !processedContent.trim().toLowerCase().startsWith('<table')) {
          processedContent = `<table class="lenovo-data-table">${processedContent}</table>`;
        }
        contentDiv.innerHTML = processedContent;
        subcontent.appendChild(contentDiv);
      });
    } else {
      subtabs.innerHTML = '<div class="error">No Lenovo data found</div>';
    }
  } catch (error) {
    console.error('Lenovo data fetch error:', error);
    subtabs.innerHTML = `<div class="error">Error fetching Lenovo data: ${error.message}</div>`;
  }
}

function decodeUnicodeEscapes(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/\\u[\dA-F]{4}/gi, match => 
    String.fromCharCode(parseInt(match.replace(/\\u/g, ''), 16))
  );
}

function switchLenovoSubtab(index) {
  document.querySelectorAll('.subtab-button').forEach(button => button.classList.remove('active'));
  document.querySelectorAll('.subtab-content').forEach(content => content.classList.remove('active'));
  document.querySelectorAll('.subtab-button')[index].classList.add('active');
  document.querySelector(`.subtab-content[data-subtab-index="${index}"]`).classList.add('active');
}

// ====================== Inventory (Epicor) ======================
async function fetchInventoryData(partNumbers) {
  if (!document.getElementById('toggle-inventory').checked) return;
  searchResults.epicor = [];

  const loading = document.querySelector('#inventory-content .loading');
  const resultsDiv = document.querySelector('#inventory-content .inventory-results');
  loading.style.display = 'block';
  resultsDiv.innerHTML = '';

  try {
    const allResults = [];
    for (const { number, source } of partNumbers) {
      try {
        const response = await fetch(`https://${serverDomain}/webhook/epicor-search?item=${encodeURIComponent(number)}`);
        if (!response.ok) {
          console.warn(`Warning: Failed to fetch inventory data for part number ${number}`);
          continue;
        }
        const data = await response.json();
        const resultsWithSource = data.map(item => ({ ...item, sourcePartNumber: source }));
        allResults.push(...resultsWithSource);
      } catch (error) {
        console.warn(`Error processing inventory data for part number ${number}:`, error);
      }
    }

    searchResults.epicor = allResults;

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
        ${allResults.map(item => `
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
    resultsDiv.appendChild(table);
  } catch (error) {
    resultsDiv.innerHTML = `<div class="error">Error fetching inventory data: ${error.message}</div>`;
  } finally {
    loading.style.display = 'none';
  }
}

// ====================== Summary Tab ======================
function updateSummaryTab() {
  const summaryDiv = document.getElementById('summary-content');
  if (!summaryDiv) return;

  // We preserve any existing text at the top (for the "analyze-data" message), 
  // but we'll re-generate the summary tables below that.
  // So let's keep the summaryDiv.innerHTML, but strip out the old tables portion 
  // so we can rebuild. A simple approach is to store any existing text from
  // `.analyze-result-text` and then re-append it.
  const existingAnalyzeMessage = summaryDiv.querySelector('.analyze-result-text');
  let topMessageHTML = '';
  if (existingAnalyzeMessage) {
    topMessageHTML = existingAnalyzeMessage.outerHTML; // preserve it
  }

  // We'll rebuild everything after removing existing summary tables:
  summaryDiv.innerHTML = topMessageHTML; // start fresh with the message on top

  // Check which toggles are on
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

  // Helper to create table
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

    let rows = '';
    for (const part in grouped) {
      const items = grouped[part];
      const bestPrice = findBestPrice(key, items);
      rows += `
        <tr>
          <td>${part}</td>
          <td>${items.length}</td>
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

  function findBestPrice(key, items) {
    let minPrice = null;
    for (const it of items) {
      let priceVal = null;

      switch (key) {
        case 'amazonConnector':
          // old Amazon
          if (it.price && it.price.value) {
            priceVal = parseFloat(it.price.value);
          }
          break;
        case 'ebayConnector':
          // old eBay
          priceVal = parsePrice(it.priceWithCurrency);
          break;
        case 'amazon':
          // new Amazon (Scraper) => rawPrice
          priceVal = parsePrice(it.rawPrice);
          break;
        case 'ebay':
          // new eBay (Scraper) => rawPrice
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
        // ingram => no price
        // epicor => no price
        default:
          priceVal = null;
      }

      if (priceVal != null && !isNaN(priceVal)) {
        if (minPrice == null || priceVal < minPrice) {
          minPrice = priceVal;
        }
      }
    }
    return minPrice;
  }

  // Build up HTML for all toggles
  let summaryHTML = '';

  // Inventory
  if (document.getElementById('toggle-inventory').checked) {
    summaryHTML += createSummaryTable('epicor', 'Epicor (Inventory)');
  }
  // BrokerBin
  if (document.getElementById('toggle-brokerbin').checked) {
    summaryHTML += createSummaryTable('brokerbin', 'BrokerBin');
  }
  // TDSynnex
  if (document.getElementById('toggle-tdsynnex').checked) {
    summaryHTML += createSummaryTable('tdsynnex', 'TDSynnex');
  }
  // Ingram
  if (document.getElementById('toggle-ingram').checked) {
    summaryHTML += createSummaryTable('ingram', 'Ingram');
  }
  // old Amazon => AmazonConnector
  if (document.getElementById('toggle-amazon-connector').checked) {
    summaryHTML += createSummaryTable('amazonConnector', 'AmazonConnector');
  }
  // old eBay => eBayConnector
  if (document.getElementById('toggle-ebay-connector').checked) {
    summaryHTML += createSummaryTable('ebayConnector', 'eBayConnector');
  }
  // new Amazon
  if (document.getElementById('toggle-amazon').checked) {
    summaryHTML += createSummaryTable('amazon', 'Amazon');
  }
  // new eBay
  if (document.getElementById('toggle-ebay').checked) {
    summaryHTML += createSummaryTable('ebay', 'eBay');
  }

  if (!summaryHTML.trim()) {
    summaryDiv.innerHTML += 'No search results yet.';
  } else {
    summaryDiv.innerHTML += summaryHTML;
  }
}

// ====================== Analyze Data Gathering ======================
function gatherResultsForAnalysis() {
  const results = {};

  // Inventory
  if (document.getElementById('toggle-inventory').checked) {
    const invElem = document.querySelector('#inventory-content .inventory-results');
    results['epicor-search'] = invElem ? invElem.innerHTML : "";
  }
  // BrokerBin
  if (document.getElementById('toggle-brokerbin').checked) {
    const bbElem = document.querySelector('.brokerbin-results .results-container');
    results['brokerbin-search'] = bbElem ? bbElem.innerHTML : "";
  }
  // TDSynnex
  if (document.getElementById('toggle-tdsynnex').checked) {
    const tdElem = document.querySelector('.tdsynnex-results .results-container');
    results['tdsynnex-search'] = tdElem ? tdElem.innerHTML : "";
  }
  // Ingram
  if (document.getElementById('toggle-ingram').checked) {
    const ingElem = document.querySelector('.ingram-results .results-container');
    results['ingram-search'] = ingElem ? ingElem.innerHTML : "";
  }
  // old Amazon => AmazonConnector
  if (document.getElementById('toggle-amazon-connector').checked) {
    const acElem = document.querySelector('.amazon-connector-results .results-container');
    results['amazon-connector'] = acElem ? acElem.innerHTML : "";
  }
  // old eBay => eBayConnector
  if (document.getElementById('toggle-ebay-connector').checked) {
    const ecElem = document.querySelector('.ebay-connector-results .results-container');
    results['ebay-connector'] = ecElem ? ecElem.innerHTML : "";
  }
  // new Amazon
  if (document.getElementById('toggle-amazon').checked) {
    const amzScrElem = document.querySelector('.amazon-results .results-container');
    results['amazon-scraper'] = amzScrElem ? amzScrElem.innerHTML : "";
  }
  // new eBay
  if (document.getElementById('toggle-ebay').checked) {
    const eScrElem = document.querySelector('.ebay-results .results-container');
    results['ebay-scraper'] = eScrElem ? eScrElem.innerHTML : "";
  }

  return results;
}

// ====================== Main Handle Search ======================
async function handleSearch() {
  const partNumber = document.getElementById('part-numbers').value.trim();
  if (!partNumber) {
    alert('Please enter a part number');
    return;
  }

  // 1) get alternative part numbers
  const { original, alternatives } = await getAlternativePartNumbers(partNumber);
  const partNumbers = [
    { number: original, source: original },
    ...alternatives.map(alt => ({ number: alt, source: alt }))
  ];

  // 2) separate Lenovo from other calls
  const nonLenovoPromises = [];

  if (document.getElementById('toggle-inventory').checked) {
    nonLenovoPromises.push(fetchInventoryData(partNumbers));
  }
  if (document.getElementById('toggle-brokerbin').checked) {
    nonLenovoPromises.push(fetchBrokerBinData(partNumbers));
  }
  if (document.getElementById('toggle-tdsynnex').checked) {
    nonLenovoPromises.push(fetchTDSynnexData(partNumbers));
  }
  if (document.getElementById('toggle-ingram').checked) {
    nonLenovoPromises.push(fetchDistributorData(partNumbers));
  }

  // old amazon => AmazonConnector
  if (document.getElementById('toggle-amazon-connector').checked) {
    nonLenovoPromises.push(fetchAmazonConnectorData(partNumbers));
  }
  // old eBay => eBayConnector
  if (document.getElementById('toggle-ebay-connector').checked) {
    nonLenovoPromises.push(fetchEbayConnectorData(partNumbers));
  }
  // new Amazon
  if (document.getElementById('toggle-amazon').checked) {
    nonLenovoPromises.push(fetchAmazonData(partNumbers));
  }
  // new eBay
  if (document.getElementById('toggle-ebay').checked) {
    nonLenovoPromises.push(fetchEbayData(partNumbers));
  }

  // Lenovo fetch if toggled
  let lenovoPromise = null;
  if (document.getElementById('toggle-lenovo').checked) {
    lenovoPromise = fetchLenovoData(partNumbers);
  }

  // 3) Wait for non-Lenovo calls
  try {
    await Promise.all(nonLenovoPromises);
  } catch (err) {
    console.error('Error in parallel execution for non-Lenovo endpoints:', err);
  }

  // 4) Update summary
  updateSummaryTab();

  // 5) Gather results & POST to "analyze-data"
  const analysisData = gatherResultsForAnalysis();

  // Add your two new keys:
  // "originalPartNumber" => the string with the searched item (user input),
  // "alternativePartNumbers" => array with the alternative part numbers found.
  analysisData.originalPartNumber = partNumber;
  analysisData.alternativePartNumbers = alternatives;

  try {
    const response = await fetch(`https://${serverDomain}/webhook/analyze-data?model=gemini`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(analysisData)
    });

    // 1) Parse as JSON instead of text
    const analyzeResult = await response.json();
    console.log('Analyze data response:', analyzeResult);
    
    // 2) In your example, analyzeResult might look like:
    //    [ { "text": "I'm sorry, there is no information..." } ]
    
    // Let's pick the text from the first element (if it exists)
    let analyzeResultText = '';
    if (Array.isArray(analyzeResult) && analyzeResult.length > 0 && analyzeResult[0].text) {
      analyzeResultText = analyzeResult[0].text;
    } else {
      // Fallback: just stringify it
      analyzeResultText = JSON.stringify(analyzeResult);
    }
    
    // 3) Display it in the Summary section
    const summaryDiv = document.getElementById('summary-content');
    if (summaryDiv) {
      const existingContent = summaryDiv.innerHTML;
      summaryDiv.innerHTML = `<div class="analyze-result-text">${analyzeResultText}</div>` + existingContent;
    }
  } catch (error) {
    console.error('Analyze data error:', error);
  }

  // 6) Optionally await Lenovo
  if (lenovoPromise) {
    try {
      await lenovoPromise;
    } catch (err) {
      console.error('Error during Lenovo data fetch:', err);
    }
  }
}
