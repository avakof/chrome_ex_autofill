// Deep debug: global click, direct form submit, log all forms
console.log('Content script loaded (STEP 5: AUTOFILL, LLM, AGENTIC RESTORED)');

// Log all forms on the page
console.log('All forms on page:', document.forms, document.querySelectorAll('form'));

// Global click listener
window.addEventListener('click', function(e) {
  console.log('Global click detected:', e.target);
});

// Direct form submit handler
const form = document.getElementById('signupForm');
if (form) {
  form.addEventListener('submit', function(event) {
    event.preventDefault();
    console.log('DIRECT FORM SUBMIT HANDLER FIRED!', event.target);
  });
}

// Helper: get active profile
function getActiveProfile(cb) {
  if (!chrome.storage || !chrome.storage.local) {
    console.error('chrome.storage.local is not available! Are you running on a file:// URL without file access permission?');
    cb('Default');
    return;
  }
  chrome.storage.local.get(['activeProfile'], (result) => {
    cb(result.activeProfile || 'Default');
  });
}

// Helper: get profile data
function getProfileData(profile, cb) {
  if (!chrome.storage || !chrome.storage.local) {
    console.error('chrome.storage.local is not available! Are you running on a file:// URL without file access permission?');
    cb({ forms: [], userMappings: {} });
    return;
  }
  chrome.storage.local.get(['profiles'], (result) => {
    const profiles = result.profiles || {};
    cb(profiles[profile] || { forms: [], userMappings: {} });
  });
}

// Helper: save profile data
function saveProfileData(profile, data, cb) {
  if (!chrome.storage || !chrome.storage.local) {
    console.error('chrome.storage.local is not available! Are you running on a file:// URL without file access permission?');
    if (cb) cb();
    return;
  }
  chrome.storage.local.get(['profiles'], (result) => {
    const profiles = result.profiles || {};
    profiles[profile] = data;
    chrome.storage.local.set({ profiles }, cb);
  });
}

// Field context extraction
function extractFieldContext(form) {
  const fields = [];
  Array.from(form.elements).forEach(el => {
    if (!el.name) return;
    // Find associated label
    let label = '';
    if (el.id) {
      const labelEl = form.querySelector(`label[for='${el.id}']`);
      if (labelEl) label = labelEl.innerText.trim();
    }
    if (!label && el.closest('label')) {
      label = el.closest('label').innerText.trim();
    }
    fields.push({
      name: el.name,
      type: el.type,
      placeholder: el.placeholder || '',
      label
    });
  });
  return fields;
}

// Simple form type detection
function detectFormType(form) {
  const html = form.outerHTML.toLowerCase();
  if (html.includes('register') || html.includes('signup')) return 'registration';
  if (html.includes('billing') || html.includes('payment')) return 'billing';
  if (html.includes('job')) return 'job_application';
  return 'generic';
}

// Helper: get embedding for a field (calls background script)
function getFieldEmbedding(text, cb) {
  chrome.runtime.sendMessage({ type: 'getEmbedding', text }, (response) => {
    if (response && response.embedding) {
      cb(response.embedding);
    } else {
      cb(null);
    }
  });
}

// Autofill logic
function autofillForm(form, suggestions, localMatches = {}, unmatchedFields = [], userMatches = {}) {
  // Fill fields using suggestions, localMatches, userMatches
  const filledData = {};
  Array.from(form.elements).forEach(el => {
    if (!el.name) return;
    let value = null;
    if (userMatches[el.name]) value = userMatches[el.name];
    else if (suggestions && suggestions[el.name]) value = suggestions[el.name];
    else if (localMatches[el.name]) value = localMatches[el.name];
    if (value) {
      el.value = value;
      filledData[el.name] = value;
      el.style.backgroundColor = '#e0f7fa';
    }
  });
  // Optionally, run Agent 3 (reviewer)
  chrome.runtime.sendMessage({ type: 'reviewAutofilledData', filledData }, (response) => {
    if (response && response.issues && Object.keys(response.issues).length > 0) {
      showAgent3ReviewUI(response.issues);
    }
  });
}

// Show Agent 3 review UI
function showAgent3ReviewUI(issues) {
  if (!issues || Object.keys(issues).length === 0) return;
  const div = document.createElement('div');
  div.style.cssText = 'background:#ffe0e0;border:1px solid #c00;padding:10px;position:fixed;bottom:60px;right:10px;z-index:9999;max-width:350px;font-size:13px;border-radius:6px;box-shadow:0 2px 8px #ccc;';
  div.innerHTML = `<b>Review Autofilled Data (AI Quality Check)</b><br>` +
    Object.entries(issues).map(([field, desc]) => `<b>${field}:</b> ${desc}`).join('<br>') +
    '<br><button id="close-agent3-review" style="margin-top:8px;float:right;">Close</button>';
  document.body.appendChild(div);
  document.getElementById('close-agent3-review').onclick = () => div.remove();
}

// User mapping UI (unchanged)
function showUserMappingUI(form, unmatchedFields, previousData) {
  let old = document.getElementById('user-mapping-ui');
  if (old) old.remove();
  if (!unmatchedFields.length) return;
  const div = document.createElement('div');
  div.id = 'user-mapping-ui';
  div.style.cssText = 'background:#fffbe0;border:1px solid #ccc;padding:10px;position:fixed;bottom:10px;right:10px;z-index:9999;max-width:350px;font-size:13px;border-radius:6px;';
  div.innerHTML = '<b>Map fields to your previous data:</b><br>';
  unmatchedFields.forEach(field => {
    const label = form.querySelector(`input[name='${field}'],textarea[name='${field}'],select[name='${field}']`);
    const fieldLabel = label && label.closest('label') ? label.closest('label').innerText : field;
    const select = document.createElement('select');
    select.style.margin = '4px 0 8px 0';
    select.innerHTML = `<option value="">(leave blank)</option>`;
    for (const key in previousData) {
      select.innerHTML += `<option value="${previousData[key]}">${key}: ${previousData[key]}</option>`;
    }
    select.onchange = () => {
      if (select.value) {
        form.elements.namedItem(field).value = select.value;
        form.elements.namedItem(field).style.backgroundColor = '#e0ffe0';
      }
    };
    div.innerHTML += `<b>${fieldLabel || field}:</b> `;
    div.appendChild(select);
    div.innerHTML += '<br>';
  });
  div.innerHTML += '<button id="close-user-mapping-ui" style="margin-top:8px;float:right;">Close</button>';
  document.body.appendChild(div);
  document.getElementById('close-user-mapping-ui').onclick = () => div.remove();
}

// Semantic match helper
function flattenData(data) {
  const flat = {};
  Object.entries(data).forEach(([k, v]) => {
    flat[k] = Array.isArray(v) && v.length === 1 ? v[0] : v;
  });
  return flat;
}

function localMatch(fieldName, allPreviousData) {
  // Try to find a value for fieldName in allPreviousData
  for (const prev of allPreviousData) {
    for (const [k, v] of Object.entries(flattenData(prev.data))) {
      if (k.toLowerCase() === fieldName.toLowerCase()) {
        return v;
      }
    }
  }
  return null;
}

// Main autofill request function
function requestAutofill() {
  const form = document.querySelector('form');
  if (!form) {
    console.warn('No form found for autofill');
    return;
  }
  const fieldContext = extractFieldContext(form);
  const formType = detectFormType(form);
  getActiveProfile(profile => {
    getProfileData(profile, pdata => {
      const pastData = pdata.forms || [];
      console.log('Using profile for autofill:', profile, pastData);
      if (!pastData.length) {
        const msg = document.createElement('div');
        msg.textContent = 'No previous form data found for this profile. Please fill and submit a form first.';
        msg.style.cssText = 'background:#c00;color:#fff;padding:6px 12px;position:fixed;top:10px;right:10px;z-index:9999;border-radius:4px;';
        document.body.appendChild(msg);
        setTimeout(() => msg.remove(), 3000);
        return;
      }
      // Semantic similarity matching
      const userMatches = {};
      const localMatches = {};
      const llmFields = [];
      let pending = fieldContext.length;
      const unmatchedFields = [];
      fieldContext.forEach(f => {
        // User mapping (not implemented in this minimal version, but placeholder)
        // getUserMapping(f.name, userMapped => {
        //   if (userMapped) {
        //     userMatches[f.name] = userMapped;
        //   } else {
        //     ...
        //   }
        // });
        // For now, just do local match and LLM
        const match = localMatch(f.name, pastData);
        if (match) {
          localMatches[f.name] = match;
        } else {
          llmFields.push(f);
          unmatchedFields.push(f.name);
        }
        pending--;
        if (pending === 0) {
          if (llmFields.length === 0) {
            autofillForm(form, {}, localMatches, unmatchedFields, userMatches);
            return;
          }
          const prompt = {
            pastData,
            fieldContext: llmFields,
            profile, // pass the active profile name
            formType // pass the detected form type
          };
          console.log('Sending LLM prompt for profile:', profile, prompt);
          chrome.runtime.sendMessage({ type: 'callLLM', prompt }, (llmResponse) => {
            if (llmResponse && llmResponse.suggestions && Object.keys(llmResponse.suggestions).length > 0) {
              autofillForm(form, llmResponse.suggestions, localMatches, unmatchedFields, userMatches);
            } else {
              autofillForm(form, {}, localMatches, unmatchedFields, userMatches);
              const msg = document.createElement('div');
              msg.textContent = 'No autofill suggestions available.';
              msg.style.cssText = 'background:#c00;color:#fff;padding:6px 12px;position:fixed;top:10px;right:10px;z-index:9999;border-radius:4px;';
              document.body.appendChild(msg);
              setTimeout(() => msg.remove(), 2000);
            }
          });
        }
      });
    });
  });
}

// Expose requestAutofill globally for popup
window.requestAutofill = requestAutofill; 