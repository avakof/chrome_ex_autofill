// popup.js
function renderProfiles() {
  chrome.storage.local.get(['profiles', 'activeProfile'], (result) => {
    const profiles = result.profiles || { Default: { forms: [], userMappings: {} } };
    const active = result.activeProfile || 'Default';
    const listDiv = document.getElementById('profiles-list');
    listDiv.innerHTML = '';
    Object.keys(profiles).forEach(profile => {
      const div = document.createElement('div');
      div.className = 'profile-item' + (profile === active ? ' selected' : '');
      const span = document.createElement('span');
      span.textContent = profile;
      span.onclick = () => {
        chrome.storage.local.set({ activeProfile: profile }, () => {
          console.log('Active profile set to:', profile);
          renderProfiles();
          // Force reload of the current tab to sync content script
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]) chrome.tabs.reload(tabs[0].id);
          });
        });
      };
      div.appendChild(span);
      if (profile !== 'Default') {
        const delBtn = document.createElement('button');
        delBtn.textContent = '🗑️';
        delBtn.title = 'Delete profile';
        delBtn.onclick = (e) => {
          e.stopPropagation();
          chrome.storage.local.get(['profiles', 'activeProfile'], (res) => {
            const ps = res.profiles || {};
            delete ps[profile];
            let newActive = res.activeProfile;
            if (newActive === profile) newActive = 'Default';
            chrome.storage.local.set({ profiles: ps, activeProfile: newActive }, renderProfiles);
          });
        };
        div.appendChild(delBtn);
      }
      listDiv.appendChild(div);
    });
  });
}

document.getElementById('add-profile').onclick = () => {
  const input = document.getElementById('new-profile');
  const name = input.value.trim();
  if (!name) return;
  chrome.storage.local.get(['profiles'], (result) => {
    const profiles = result.profiles || {};
    if (profiles[name]) {
      alert('Profile already exists!');
      return;
    }
    profiles[name] = { forms: [], userMappings: {} };
    chrome.storage.local.set({ profiles, activeProfile: name }, () => {
      input.value = '';
      renderProfiles();
    });
  });
};

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

function renderProfileForms() {
  chrome.storage.local.get(['profiles', 'activeProfile'], (result) => {
    const profiles = result.profiles || { Default: { forms: [], userMappings: {} } };
    const active = result.activeProfile || 'Default';
    const forms = (profiles[active] && profiles[active].forms) || [];
    const formsDiv = document.getElementById('profile-forms');
    if (!formsDiv) return;
    formsDiv.innerHTML = '';
    forms.forEach((entry, idx) => {
      // For ajax_submission, only show if likely user form
      if (entry.formType === 'ajax_submission') {
        if (!isLikelyUserForm(entry.data)) return;
        const flatData = flattenData(entry.data);
        const div = document.createElement('div');
        div.className = 'form-entry';
        div.style.margin = '8px 0';
        div.style.padding = '6px';
        div.style.border = '1px solid #eee';
        div.style.borderRadius = '4px';
        div.innerHTML = `<b>Type:</b> ${entry.formType}<br><b>Date:</b> ${new Date(entry.timestamp).toLocaleString()}<br><pre>${JSON.stringify(flatData, null, 2)}</pre>`;
        formsDiv.appendChild(div);
        return;
      }
      // For all other form types, show as before
      const div = document.createElement('div');
      div.className = 'form-entry';
      div.style.margin = '8px 0';
      div.style.padding = '6px';
      div.style.border = '1px solid #eee';
      div.style.borderRadius = '4px';
      div.innerHTML = `<b>Type:</b> ${entry.formType}<br><b>Date:</b> ${new Date(entry.timestamp).toLocaleString()}<br><pre>${JSON.stringify(entry.data, null, 2)}</pre>`;
      formsDiv.appendChild(div);
    });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  renderProfiles();
  renderProfileForms();
  // Existing autofill button logic
  document.getElementById('autofillBtn').addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        func: () => { if (window.requestAutofill) window.requestAutofill(); }
      });
    });
  });
});

// --- User Mapping UI for Unmatched Fields ---
function renderUnmatchedFields(unmatchedFields, recommendations) {
  const container = document.getElementById('unmatched-fields');
  container.innerHTML = '';
  if (!unmatchedFields || unmatchedFields.length === 0) return;
  const title = document.createElement('div');
  title.innerHTML = '<b>Map Unmatched Fields:</b>';
  container.appendChild(title);
  unmatchedFields.forEach(field => {
    const fieldDiv = document.createElement('div');
    fieldDiv.style.margin = '8px 0';
    fieldDiv.style.padding = '6px';
    fieldDiv.style.border = '1px solid #eee';
    fieldDiv.style.borderRadius = '4px';
    // Field label
    const label = document.createElement('div');
    label.innerHTML = `<b>${field.label || field.name}</b> <span style="color:#888;">(${field.name})</span>`;
    fieldDiv.appendChild(label);
    // Dropdown of recommended values with confidence
    const select = document.createElement('select');
    select.style.marginRight = '6px';
    const emptyOpt = document.createElement('option');
    emptyOpt.value = '';
    emptyOpt.textContent = '-- Select from recommendations --';
    select.appendChild(emptyOpt);
    (recommendations[field.name] || []).forEach(obj => {
      const opt = document.createElement('option');
      opt.value = obj.value;
      const pct = obj.confidence !== undefined ? ` (${Math.round(obj.confidence * 100)}%)` : '';
      opt.textContent = obj.value + pct;
      if (obj.confidence >= 0.9) opt.style.color = '#007700';
      else if (obj.confidence >= 0.75) opt.style.color = '#0055cc';
      else opt.style.color = '#888';
      select.appendChild(opt);
    });
    fieldDiv.appendChild(select);
    // Custom input
    const customInput = document.createElement('input');
    customInput.type = 'text';
    customInput.placeholder = 'Or enter custom value';
    customInput.style.marginLeft = '6px';
    fieldDiv.appendChild(customInput);
    // Save button
    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'Save Mapping';
    saveBtn.style.marginLeft = '8px';
    saveBtn.onclick = () => {
      const value = customInput.value.trim() || select.value;
      if (!value) {
        alert('Please select or enter a value.');
        return;
      }
      // Save mapping to chrome.storage.local under userMappings for active profile
      chrome.storage.local.get(['profiles', 'activeProfile'], res => {
        const profiles = res.profiles || {};
        const active = res.activeProfile || 'Default';
        if (!profiles[active]) profiles[active] = { forms: [], userMappings: {} };
        if (!profiles[active].userMappings) profiles[active].userMappings = {};
        profiles[active].userMappings[field.name] = value;
        chrome.storage.local.set({ profiles }, () => {
          saveBtn.textContent = 'Saved!';
          saveBtn.disabled = true;
          setTimeout(() => { saveBtn.textContent = 'Save Mapping'; saveBtn.disabled = false; }, 1200);
        });
      });
    };
    fieldDiv.appendChild(saveBtn);
    container.appendChild(fieldDiv);
  });
}
// Example usage (to be replaced with real data after autofill):
// renderUnmatchedFields([
//   { name: 'address', label: 'Address' },
//   { name: 'dob', label: 'Date of Birth' }
// ], ['eajkrha', 'UK', 'ali', 'jksghjkdgs']); 

// Listen for unmatched fields from background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'popupUnmatchedFields') {
    // For each unmatched field, request LLM recommendations
    const { unmatchedFields, previousValues } = message;
    if (!unmatchedFields || unmatchedFields.length === 0) return;
    // Gather all previous field data (names, labels, values) for LLM
    chrome.storage.local.get(['profiles', 'activeProfile'], res => {
      const profiles = res.profiles || {};
      const active = res.activeProfile || 'Default';
      const pdata = profiles[active] || { forms: [], userMappings: {} };
      // Build a flat list of previous fields: {name, label, value}
      const prevFields = [];
      (pdata.forms || []).forEach(entry => {
        (entry.fieldContext || []).forEach(f => {
          if (entry.data && entry.data[f.name]) {
            prevFields.push({ name: f.name, label: f.label, value: entry.data[f.name] });
          }
        });
      });
      // For each unmatched field, request LLM recommendations
      let pending = unmatchedFields.length;
      const recommendations = {};
      unmatchedFields.forEach(field => {
        chrome.runtime.sendMessage({
          type: 'getFieldRecommendations',
          field,
          prevFields
        }, (response) => {
          recommendations[field.name] = response && response.recommendations ? response.recommendations : [];
          pending--;
          if (pending === 0) {
            // All recommendations ready, render UI
            renderUnmatchedFields(
              unmatchedFields,
              recommendations
            );
          }
        });
      });
    });
  }
}); 