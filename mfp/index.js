var serverDomain = "gpu.haielab.org";
// var serverDomain = "n8n.haielab.org";
var llmModel = "gemini";
// var llmModel = "ollama";

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

    // Extract Description and Category from the response.
    const description = data[0].Description || '';
    const category = data[0].Category || '';

    // Gather all alternative part numbers.
    const alternatives = [
      ...(data[0].FRU || []),
      ...(data[0].MFG || []),
      ...(data[0].OEM || []),
      ...(data[0].OPT || [])
    ];

    const alternativeNumbersDiv = document.getElementById('alternative-numbers');

    // Build the HTML content: first show the description and category.
    let htmlContent = `
      <p><strong>Description:</strong> ${description}</p>
      <p><strong>Category:</strong> ${category}</p>
    `;

    // Then display the alternative part numbers if any.
    if (alternatives.length > 0) {
      htmlContent += `
        <h4>Alternative Part Numbers Found:</h4>
        <ul class="alternative-numbers-list">
          ${alternatives.map(num => `<li class="alternative-number"><span>${num}</span></li>`).join('')}
        </ul>
      `;
    } else {
      htmlContent += `<p>No alternative part numbers found.</p>`;
    }

    alternativeNumbersDiv.innerHTML = htmlContent;
    alternativeNumbersDiv.classList.add('active');

    // Use the returned original part number if provided; otherwise, fall back to the entered part number.
    const originalPart = data[0].ORD && data[0].ORD.trim() ? data[0].ORD : partNumber;
    return {
      original: originalPart,
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
      
      // Wrap the table in a scrollable container.
      const container = document.createElement('div');
      container.className = 'table-container';
      container.appendChild(table);
      resultsDiv.appendChild(container);
      
      // Enable sorting on this table.
      makeTableSortable(table);
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
      // Wrap the table in a scrollable container.
      const container = document.createElement('div');
      container.className = 'table-container';
      container.appendChild(table);
      resultsDiv.appendChild(container);
      
      // Enable sorting on this table.
      makeTableSortable(table);
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
        
        // We expect data like: [ { title: [...], price: [...], image: [...], link: [...] } ]
        if (Array.isArray(data) && data.length > 0) {
          const { title = [], price = [], image = [], link = [] } = data[0];
          
          for (let i = 0; i < title.length; i++) {
            allResults.push({
              sourcePartNumber: source,
              title: title[i] || '-',
              rawPrice: price[i] || '-',
              image: image[i] || null,
              link: link[i] || '#'
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
          <th>Image</th>
          <th>Description</th>
          <th>Price</th>
        </tr>
      </thead>
      <tbody>
        ${allResults.map(item => `
          <tr>
            <td>${item.sourcePartNumber}</td>
            <td class="image-cell">
              ${
                item.image
                  ? `<img src="${item.image}" alt="Product image" class="product-image">`
                  : '-'
              }
            </td>
            <td>
              ${
                item.link && item.link !== '#'
                  ? `<a href="${item.link}" target="_blank">${item.title}</a>`
                  : item.title
              }
            </td>
            <td>${item.rawPrice}</td>
          </tr>
        `).join('')}
      </tbody>
    `;
    // Wrap the table in a scrollable container.
    const container = document.createElement('div');
    container.className = 'table-container';
    container.appendChild(table);
    resultsDiv.appendChild(container);
    
    // Enable sorting on this table.
    makeTableSortable(table);

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
        
        // We expect data like: [ { title: [...], price: [...], image: [...], link: [...] } ]
        if (Array.isArray(data) && data.length > 0) {
          const { title = [], price = [], image = [], link = [] } = data[0];

          for (let i = 0; i < title.length; i++) {
            allResults.push({
              sourcePartNumber: source,
              title: title[i] || '-',
              rawPrice: price[i] || '-',
              image: image[i] || null,
              link: link[i] || '#'
            });
          }
        }
      } catch (error) {
        console.warn(`Error in eBay (Scraper) for part number ${number}:`, error);
      }
    }

    searchResults.ebay = allResults;

    // Build table
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
        ${allResults.map(item => `
          <tr>
            <td>${item.sourcePartNumber}</td>
            <td class="image-cell">
              ${
                item.image
                  ? `<img src="${item.image}" alt="Product image" class="product-image">`
                  : '-'
              }
            </td>
            <td>
              ${
                item.link && item.link !== '#'
                  ? `<a href="${item.link}" target="_blank">${item.title}</a>`
                  : item.title
              }
            </td>
            <td>${item.rawPrice}</td>
          </tr>
        `).join('')}
      </tbody>
    `;
    // Wrap the table in a scrollable container.
    const container = document.createElement('div');
    container.className = 'table-container';
    container.appendChild(table);
    resultsDiv.appendChild(container);
    
    // Enable sorting on this table.
    makeTableSortable(table);

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
    // Wrap the table in a scrollable container.
    const container = document.createElement('div');
    container.className = 'table-container';
    container.appendChild(table);
    resultsDiv.appendChild(container);
    
    // Enable sorting on this table.
    makeTableSortable(table);

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
    // Wrap the table in a scrollable container.
    const container = document.createElement('div');
    container.className = 'table-container';
    container.appendChild(table);
    resultsDiv.appendChild(container);
    
    // Enable sorting on this table.
    makeTableSortable(table);

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
    // Wrap the table in a scrollable container.
    const container = document.createElement('div');
    container.className = 'table-container';
    container.appendChild(table);
    resultsDiv.appendChild(container);
    
    // Enable sorting on this table.
    makeTableSortable(table);

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
    // Wrap the table in a scrollable container.
    const container = document.createElement('div');
    container.className = 'table-container';
    container.appendChild(table);
    resultsDiv.appendChild(container);
    
    // Enable sorting on this table.
    makeTableSortable(table);
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
          // old Amazon: use the value if available
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
        // ingram and epicor do not provide price values
        default:
          priceVal = null;
      }
  
      // Only consider price values that are non-null, numeric, and greater than 0
      if (priceVal != null && !isNaN(priceVal) && priceVal > 0) {
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
  // Get the user's part-number input
  const partNumber = document.getElementById('part-numbers').value.trim();
  if (!partNumber) {
    alert('Please enter a part number');
    return;
  }

  // Clear the previous summary content to start fresh
  const summaryDiv = document.getElementById('summary-content');
  if (summaryDiv) {
    summaryDiv.innerHTML = '';
  }

  // Show the loader/spinner
  const spinner = document.getElementById('loading-spinner');
  if (spinner) {
    spinner.style.display = 'inline-block';
  }

  try {
    // 1) Fetch alternative part numbers
    const { original, alternatives } = await getAlternativePartNumbers(partNumber);
    const partNumbers = [
      { number: original, source: original },
      ...alternatives.map(alt => ({ number: alt, source: alt }))
    ];

    // 2) Prepare array for all the “non-Lenovo” async calls
    const nonLenovoPromises = [];

    // Epicor (Inventory)
    if (document.getElementById('toggle-inventory').checked) {
      nonLenovoPromises.push(fetchInventoryData(partNumbers));
    }
    // BrokerBin
    if (document.getElementById('toggle-brokerbin').checked) {
      nonLenovoPromises.push(fetchBrokerBinData(partNumbers));
    }
    // TDSynnex
    if (document.getElementById('toggle-tdsynnex').checked) {
      nonLenovoPromises.push(fetchTDSynnexData(partNumbers));
    }
    // Ingram
    if (document.getElementById('toggle-ingram').checked) {
      nonLenovoPromises.push(fetchDistributorData(partNumbers));
    }
    // Old Amazon => AmazonConnector
    if (document.getElementById('toggle-amazon-connector').checked) {
      nonLenovoPromises.push(fetchAmazonConnectorData(partNumbers));
    }
    // Old eBay => eBayConnector
    if (document.getElementById('toggle-ebay-connector').checked) {
      nonLenovoPromises.push(fetchEbayConnectorData(partNumbers));
    }
    // New Amazon
    if (document.getElementById('toggle-amazon').checked) {
      nonLenovoPromises.push(fetchAmazonData(partNumbers));
    }
    // New eBay
    if (document.getElementById('toggle-ebay').checked) {
      nonLenovoPromises.push(fetchEbayData(partNumbers));
    }

    // 3) Fetch Lenovo data separately, if toggled
    let lenovoPromise = null;
    if (document.getElementById('toggle-lenovo').checked) {
      lenovoPromise = fetchLenovoData(partNumbers);
    }

    // 4) Wait for all non-Lenovo calls in parallel
    try {
      await Promise.all(nonLenovoPromises);
    } catch (err) {
      console.error('Error in parallel execution for non-Lenovo endpoints:', err);
    }

    // 5) Update the summary tab with any partial results
    updateSummaryTab();

    // 6) Gather results to POST for analysis
    const analysisData = gatherResultsForAnalysis();
    // Also store the original part + alternatives in the payload
    analysisData.originalPartNumber = partNumber;
    analysisData.alternativePartNumbers = alternatives;

    // 7) POST to the "analyze-data" endpoint
    let analyzeResultText = '';
    try {
      // Get the model choice from the dropdown
      const selectedModel = document.getElementById('llm-model').value;
      // Get the prompt text from the textarea
      const promptText = document.getElementById('prompt').value;
      
      // Build the URL with both model and prompt parameters (make sure to URL-encode the prompt)
      const analyzeUrl = `https://${serverDomain}/webhook/analyze-data?model=${selectedModel}&prompt=${encodeURIComponent(promptText)}`;
      
      const response = await fetch(analyzeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(analysisData)
      });
      const analyzeResult = await response.json();
    
      if (Array.isArray(analyzeResult) && analyzeResult.length > 0 && analyzeResult[0].text) {
        analyzeResultText = analyzeResult[0].text;
      } else {
        analyzeResultText = JSON.stringify(analyzeResult);
      }
    
      // Remove any markdown code block symbols if present.
      // This removes a starting "```html" (plus any trailing whitespace) and an ending "```" (plus any leading whitespace)
      analyzeResultText = analyzeResultText.replaceAll("```html", '').replaceAll("```", '');
    
      // Append the analysis title and text at the end of the Summary section.
      const summaryDiv = document.getElementById('summary-content');
      if (summaryDiv) {
        summaryDiv.innerHTML += `<h3>Analysis Summary</h3><div class="analyze-result-text">${analyzeResultText}</div>`;
      }
    } catch (err) {
      console.error('Analyze data error:', err);
    }

    // 8) Optionally wait for Lenovo data
    if (lenovoPromise) {
      try {
        await lenovoPromise;
      } catch (err) {
        console.error('Error during Lenovo data fetch:', err);
      }
    }

  } finally {
    // Hide the loader/spinner once everything is complete
    if (spinner) {
      spinner.style.display = 'none';
    }
  }
}


/**
 * Makes the given table sortable by clicking on its header cells.
 * Each header click toggles the sort order (ascending/descending).
 */
function makeTableSortable(table) {
  const headers = table.querySelectorAll("th");
  headers.forEach((header, index) => {
    header.style.cursor = "pointer";
    header.addEventListener("click", () => {
      // Determine current sort order; default is ascending.
      const currentOrder = header.getAttribute("data-sort-order") || "asc";
      const asc = currentOrder === "asc";
      sortTableByColumn(table, index, asc);
      // Toggle the sort order for the next click.
      header.setAttribute("data-sort-order", asc ? "desc" : "asc");
    });
  });
}

/**
 * Sorts the table rows based on the content of the specified column.
 * Attempts a numeric sort; if that fails, falls back to a string comparison.
 */
function sortTableByColumn(table, columnIndex, asc = true) {
  const tbody = table.tBodies[0];
  const rows = Array.from(tbody.querySelectorAll("tr"));
  
  rows.sort((a, b) => {
    const aText = a.children[columnIndex].textContent.trim();
    const bText = b.children[columnIndex].textContent.trim();

    // Try numeric comparison (ignoring non-numeric characters).
    const aNum = parseFloat(aText.replace(/[^0-9.-]/g, ""));
    const bNum = parseFloat(bText.replace(/[^0-9.-]/g, ""));
    if (!isNaN(aNum) && !isNaN(bNum)) {
      return asc ? aNum - bNum : bNum - aNum;
    }
    // Fall back to string comparison.
    return asc ? aText.localeCompare(bText) : bText.localeCompare(aText);
  });

  // Append the sorted rows back to the tbody.
  rows.forEach(row => tbody.appendChild(row));
}
