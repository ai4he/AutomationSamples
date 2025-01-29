var serverDomain = "gpu.haielab.org";
// var serverDomain = "n8n.haielab.org";

// Utility functions
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

    // Extract all alternative part numbers
    const alternatives = [
      ...(data[0].FRU || []),
      ...(data[0].MFG || []),
      ...(data[0].OEM || []),
      ...(data[0].OPT || [])
    ];

    // Display alternative numbers in the UI
    const alternativeNumbersDiv = document.getElementById('alternative-numbers');
    if (alternatives.length > 0) {
      alternativeNumbersDiv.innerHTML = `
        <h4>Alternative Part Numbers Found:</h4>
        <ul class="alternative-numbers-list">
          ${alternatives.map(num => `
            <li class="alternative-number">
              <span>${num}</span>
            </li>
          `).join('')}
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
  document.querySelectorAll('.tab-content').forEach(tab => {
    tab.classList.remove('active');
  });
  document.querySelectorAll('.tab-button').forEach(button => {
    button.classList.remove('active');
  });
  document.getElementById(tabId).classList.add('active');
  document.querySelector(`button[onclick="switchTab('${tabId}')"]`).classList.add('active');
}

function parseXML(xmlString) {
  const parser = new DOMParser();
  return parser.parseFromString(xmlString, "text/xml");
}

// Data fetching functions
async function fetchAmazonData(partNumbers) {
  if (!document.getElementById('toggle-amazon').checked) {
    return;
  }

  const loading = document.querySelector('.amazon-results .loading');
  const resultsDiv = document.querySelector('.amazon-results .results-container');
  
  loading.style.display = 'block';
  resultsDiv.innerHTML = '';

  try {
    const allResults = [];
    for (const { number, source } of partNumbers) {
      try {
        const response = await fetch(`https://${serverDomain}/webhook/amazon-search?item=${encodeURIComponent(number)}`);
        if (!response.ok) {
          console.warn(`Warning: Failed to fetch Amazon data for part number ${number}`);
          continue;
        }
        const data = await response.json();
        const resultsWithSource = data.map(item => ({
          ...item,
          sourcePartNumber: source
        }));
        allResults.push(...resultsWithSource);
      } catch (error) {
        console.warn(`Error processing Amazon data for part number ${number}:`, error);
      }
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
        ${allResults.map(item => `
          <tr>
            <td class="source-part-number">${item.sourcePartNumber}</td>
            <td class="image-cell">
              <img src="${item.thumbnailImage || '-'}" alt="${item.title}" class="product-image">
            </td>
            <td>
              <a href="${item.url}" target="_blank">${item.title}</a>
            </td>
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
  } catch (error) {
    resultsDiv.innerHTML = `<div class="error">Error fetching Amazon data: ${error.message}</div>`;
  } finally {
    loading.style.display = 'none';
  }
}

async function fetchTDSynnexData(partNumbers) {
  if (!document.getElementById('toggle-tdsynnex').checked) {
    return;
  }

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
            <td class="source-part-number">${item.sourcePartNumber}</td>
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
  if (!document.getElementById('toggle-ingram').checked) {
    return;
  }

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
        const resultsWithSource = data.map(item => ({
          ...item,
          sourcePartNumber: source
        }));
        allResults.push(...resultsWithSource);
      } catch (error) {
        console.warn(`Error processing Ingram data for part number ${number}:`, error);
      }
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
        ${allResults.map(item => `
          <tr>
            <td class="source-part-number">${item.sourcePartNumber}</td>
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
  if (!document.getElementById('toggle-brokerbin').checked) {
    return;
  }

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
        const resultsWithSource = data.map(item => ({
          ...item,
          sourcePartNumber: source
        }));
        allResults.push(...resultsWithSource);
      } catch (error) {
        console.warn(`Error processing BrokerBin data for part number ${number}:`, error);
      }
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
        ${allResults.map(item => `
          <tr>
            <td class="source-part-number">${item.sourcePartNumber}</td>
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

async function fetchEbayData(partNumbers) {
  if (!document.getElementById('toggle-ebay').checked) {
    return;
  }

  const loading = document.querySelector('.ebay-results .loading');
  const resultsDiv = document.querySelector('.ebay-results .results-container');
  
  loading.style.display = 'block';
  resultsDiv.innerHTML = '';

  try {
    const allResults = [];
    for (const { number, source } of partNumbers) {
      try {
        const response = await fetch(`https://${serverDomain}/webhook/ebay-search?item=${encodeURIComponent(number)}`);
        if (!response.ok) {
          console.warn(`Warning: Failed to fetch eBay data for part number ${number}`);
          continue;
        }
        const data = await response.json();
        const resultsWithSource = data.map(item => ({
          ...item,
          sourcePartNumber: source
        }));
        allResults.push(...resultsWithSource);
      } catch (error) {
        console.warn(`Error processing eBay data for part number ${number}:`, error);
      }
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
        ${allResults.map(item => `
          <tr>
            <td class="source-part-number">${item.sourcePartNumber}</td>
            <td class="image-cell">
              ${item.images && item.images.length > 0 ? 
                `<img src="${item.images[0]}" alt="${item.title}" class="product-image">` : 
                '-'}
            </td>
            <td>
              <a href="${item.url}" target="_blank">${item.title}</a>
            </td>
            <td>${item.priceWithCurrency || '-'}</td>
            <td>${item.condition || '-'}</td>
            <td>
              <a href="${item.sellerUrl}" target="_blank">${item.sellerName}</a>
            </td>
            <td>${item.itemLocation || '-'}</td>
            <td>${item.shipping || '-'}</td>
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


async function fetchLenovoData(partNumbers) {
  if (!document.getElementById('toggle-lenovo').checked) {
    return;
  }

  const lenovoContentDiv = document.getElementById('lenovo-content');
  if (!lenovoContentDiv) {
    console.error('Lenovo content div not found');
    return;
  }

  // Create containers if they don't exist
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

  // Clear existing content
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

    // Clear loading message
    subtabs.innerHTML = '';
    subcontent.innerHTML = '';

    if (allResults.length > 0) {
      allResults.forEach((doc, index) => {
        // Create tab button
        const subtabButton = document.createElement('button');
        subtabButton.className = `subtab-button ${index === 0 ? 'active' : ''}`;
        
        // Safely handle the title
        const title = doc.title || 'Untitled Document';
        const cleanTitle = typeof title === 'string' 
          ? title
              .replace(/\n/g, ' ')
              .replace(/\s+/g, ' ')
              .trim()
          : 'Untitled Document';
        
        subtabButton.textContent = `${doc.sourcePartNumber} - ${cleanTitle}`;
        subtabButton.title = cleanTitle;
        subtabButton.onclick = () => switchLenovoSubtab(index);
        subtabs.appendChild(subtabButton);

        // Create content div
        const contentDiv = document.createElement('div');
        contentDiv.className = `subtab-content ${index === 0 ? 'active' : ''}`;
        contentDiv.setAttribute('data-subtab-index', index);

        // Process the content
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
  document.querySelectorAll('.subtab-button').forEach(button => {
    button.classList.remove('active');
  });
  document.querySelectorAll('.subtab-button')[index].classList.add('active');

  document.querySelectorAll('.subtab-content').forEach(content => {
    content.classList.remove('active');
  });
  document.querySelector(`.subtab-content[data-subtab-index="${index}"]`).classList.add('active');
}

// Data fetching functions
async function fetchInventoryData(partNumbers) {
  if (!document.getElementById('toggle-inventory').checked) {
    return;
  }

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
        const resultsWithSource = data.map(item => ({
          ...item,
          sourcePartNumber: source
        }));
        allResults.push(...resultsWithSource);
      } catch (error) {
        console.warn(`Error processing inventory data for part number ${number}:`, error);
      }
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
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        ${allResults.map(item => `
          <tr>
            <td class="source-part-number">${item.sourcePartNumber}</td>
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

// Gather table HTML for analyze-data
function gatherResultsForAnalysis() {
  const results = {};

  // Inventory (epicor-search)
  if (document.getElementById('toggle-inventory').checked) {
    const invElem = document.querySelector('#inventory-content .inventory-results');
    results['epicor-search'] = invElem ? invElem.innerHTML : "";
  }

  // BrokerBin (brokerbin-search)
  if (document.getElementById('toggle-brokerbin').checked) {
    const bbElem = document.querySelector('.brokerbin-results .results-container');
    results['brokerbin-search'] = bbElem ? bbElem.innerHTML : "";
  }

  // TDSynnex (tdsynnex-search)
  if (document.getElementById('toggle-tdsynnex').checked) {
    const tdElem = document.querySelector('.tdsynnex-results .results-container');
    results['tdsynnex-search'] = tdElem ? tdElem.innerHTML : "";
  }

  // Ingram (ingram-search)
  if (document.getElementById('toggle-ingram').checked) {
    const ingElem = document.querySelector('.ingram-results .results-container');
    results['ingram-search'] = ingElem ? ingElem.innerHTML : "";
  }

  // eBay (ebay-search)
  if (document.getElementById('toggle-ebay').checked) {
    const ebayElem = document.querySelector('.ebay-results .results-container');
    results['ebay-search'] = ebayElem ? ebayElem.innerHTML : "";
  }

  // Amazon (amazon-search)
  if (document.getElementById('toggle-amazon').checked) {
    const amzElem = document.querySelector('.amazon-results .results-container');
    results['amazon-search'] = amzElem ? amzElem.innerHTML : "";
  }

  return results;
}

async function handleSearch() {
  const partNumber = document.getElementById('part-numbers').value.trim();
  if (!partNumber) {
    alert('Please enter a part number');
    return;
  }

  // Get alternative part numbers
  const { original, alternatives } = await getAlternativePartNumbers(partNumber);
  
  // Create an array of all part numbers to search, including the original and alternatives
  const partNumbers = [
    { number: original, source: original },
    ...alternatives.map(alt => ({ number: alt, source: alt }))
  ];

  // Separate the Lenovo call from other calls
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

  if (document.getElementById('toggle-ebay').checked) {
    nonLenovoPromises.push(fetchEbayData(partNumbers));
  }

  if (document.getElementById('toggle-amazon').checked) {
    nonLenovoPromises.push(fetchAmazonData(partNumbers));
  }

  // Start Lenovo separately (if toggled), but don't wait for it before analyze-data
  let lenovoPromise = null;
  if (document.getElementById('toggle-lenovo').checked) {
    lenovoPromise = fetchLenovoData(partNumbers); 
    // (We do not await lenovo here — it's separate.)
  }

  // Wait for all non-Lenovo calls to finish
  try {
    await Promise.all(nonLenovoPromises);
  } catch (error) {
    console.error('Error during parallel execution for non-Lenovo endpoints:', error);
  }

  // Gather results from completed endpoints and send to "analyze-data"
  const analysisData = gatherResultsForAnalysis();
  try {
    const response = await fetch(`https://${serverDomain}/webhook/analyze-data`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(analysisData)
    });
    const analyzeResult = await response.json();
    console.log('Analyze data response:', analyzeResult);
  } catch (error) {
    console.error('Analyze data error:', error);
  }

  // Finally, we can await Lenovo if we want to ensure it completes for the UI
  // but analyzing data does NOT wait for it. You can choose to wait or not:
  if (lenovoPromise) {
    try {
      await lenovoPromise;
    } catch (err) {
      console.error('Error during Lenovo data fetch:', err);
    }
  }
}
