async function getAlternativePartNumbers(partNumber) {
  try {
    const response = await fetch(`https://n8n.haielab.org/webhook/d1154c47-005e-447a-a6b2-f70ad1c3944c?item=${encodeURIComponent(partNumber)}`);
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

async function fetchAmazonData(partNumbers) {
  if (!document.getElementById('toggle-amazon').checked) {
