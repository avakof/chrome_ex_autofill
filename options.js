// options.js
function isLikelyUserForm(data) {
  const userFields = [
    'firstname', 'lastname', 'email', 'phone', 'all_type_multiple_checkboxes', 'all_current_academic_year',
    'all_current_formation', 'english_level', 'one_targetted_training', 'all_campus_location', 'declared_original_awareness'
  ];
  return Object.keys(data).some(key => userFields.includes(key));
}

function flattenData(data) {
  const flat = {};
  Object.entries(data).forEach(([k, v]) => {
    flat[k] = Array.isArray(v) && v.length === 1 ? v[0] : v;
  });
  return flat;
}

function renderData(data) {
  const dataList = document.getElementById('dataList');
  if (!data || Object.keys(data).length === 0) {
    dataList.textContent = 'No saved form data.';
    return;
  }
  dataList.innerHTML = '';
  Object.entries(data).forEach(([domain, forms]) => {
    forms.forEach((entry, idx) => {
      // For ajax_submission, only show if likely user form
      if (entry.formType === 'ajax_submission') {
        if (!isLikelyUserForm(entry.data)) return;
        const flatData = flattenData(entry.data);
        const div = document.createElement('div');
        div.className = 'form-entry';
        div.innerHTML = `<b>Domain:</b> ${domain}<br><b>Type:</b> ${entry.formType}<br><b>Date:</b> ${new Date(entry.timestamp).toLocaleString()}<br><pre>${JSON.stringify(flatData, null, 2)}</pre>`;
        const delBtn = document.createElement('button');
        delBtn.textContent = 'Delete';
        delBtn.onclick = () => deleteEntry(domain, idx);
        div.appendChild(delBtn);
        dataList.appendChild(div);
        return;
      }
      // For all other form types, show as before
      const div = document.createElement('div');
      div.className = 'form-entry';
      div.innerHTML = `<b>Domain:</b> ${domain}<br><b>Type:</b> ${entry.formType}<br><b>Date:</b> ${new Date(entry.timestamp).toLocaleString()}<br><pre>${JSON.stringify(entry.data, null, 2)}</pre>`;
      const delBtn = document.createElement('button');
      delBtn.textContent = 'Delete';
      delBtn.onclick = () => deleteEntry(domain, idx);
      div.appendChild(delBtn);
      dataList.appendChild(div);
    });
  });
}

function loadData() {
  chrome.storage.local.get(null, renderData);
}

function deleteEntry(domain, idx) {
  chrome.storage.local.get([domain], (result) => {
    const forms = result[domain] || [];
    forms.splice(idx, 1);
    if (forms.length === 0) {
      chrome.storage.local.remove([domain], loadData);
    } else {
      chrome.storage.local.set({ [domain]: forms }, loadData);
    }
  });
}

// API Key management
const apiKeyInput = document.getElementById('apiKey');
const saveKeyBtn = document.getElementById('saveKey');
const apiKeyStatus = document.getElementById('apiKeyStatus');

saveKeyBtn.onclick = () => {
  const key = apiKeyInput.value;
  chrome.storage.local.set({ openaiApiKey: key }, () => {
    apiKeyStatus.textContent = 'API Key saved securely!';
    setTimeout(() => { apiKeyStatus.textContent = ''; }, 2000);
  });
};

chrome.storage.local.get(['openaiApiKey'], res => {
  if(res.openaiApiKey) apiKeyInput.value = res.openaiApiKey;
});

document.addEventListener('DOMContentLoaded', loadData); 