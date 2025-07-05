// background.js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Background received message:', message);
  if (message.type === 'saveFormData') {
    const { data, url, formType } = message;
    chrome.storage.local.get([url], (result) => {
      const forms = result[url] || [];
      forms.push({ data, formType, timestamp: Date.now() });
      chrome.storage.local.set({ [url]: forms });
    });
    sendResponse({ status: 'saved' });
    return true;
  }
  if (message.type === 'getRelevantFormData') {
    const { url, formType } = message;
    chrome.storage.local.get([url], (result) => {
      const forms = result[url] || [];
      // Simple filter by formType, can be improved with semantic similarity
      const relevant = forms.filter(f => f.formType === formType);
      sendResponse({ data: relevant });
    });
    return true;
  }
  if (message.type === 'callLLM') {
    const { prompt } = message;
    const profile = prompt.profile || 'Default';
    // Load the correct profile's data from storage
    chrome.storage.local.get(['profiles'], (result) => {
      const profiles = result.profiles || {};
      const pdata = profiles[profile] || { forms: [], userMappings: {} };
      const pastData = pdata.forms || [];
      console.log('Background using profile for LLM:', profile, pastData);
      // Multi-agent LLM: Agent 1 proposes, Agent 2 verifies
      function buildAgent1Prompt(pastData, fieldContext) {
        // Flatten all previous data into a single key-value list
        const valueMap = {};
        pastData.forEach(entry => {
          Object.entries(flattenData(entry.data)).forEach(([k, v]) => {
            valueMap[k] = v;
          });
        });
        let promptStr = `You are Agent 1, assisting in autofill using user's previous form data.\n\nPrevious user data available:\n`;
        Object.entries(valueMap).forEach(([k, v]) => {
          promptStr += `${k}: ${v}\n`;
        });
        promptStr += `\nNew form fields:\n`;
        fieldContext.forEach(f => {
          promptStr += `- Label: ${f.label}, Name: ${f.name}, Type: ${f.type}, Placeholder: ${f.placeholder}\n`;
        });
        promptStr += `\nUsing semantic meaning, labels, synonyms, and context, propose relevant autofill values strictly from previous data. If no relevant data, leave empty. Provide JSON mapping without extra text.`;
        return promptStr;
      }

      function buildAgent2Prompt(pastData, agent1Suggestions, fieldContext) {
        // Flatten all previous data into a single key-value list
        const valueMap = {};
        pastData.forEach(entry => {
          Object.entries(flattenData(entry.data)).forEach(([k, v]) => {
            valueMap[k] = v;
          });
        });
        let promptStr = `You are Agent 2, verifying Agent 1's autofill values.\n\nPrevious user data:\n`;
        Object.entries(valueMap).forEach(([k, v]) => {
          promptStr += `${k}: ${v}\n`;
        });
        promptStr += `\nAgent 1 suggestions:\n` + JSON.stringify(agent1Suggestions, null, 2) + '\n';
        promptStr += `\nReview each suggestion semantically. If the suggestion is semantically accurate and matches previous data, confirm it. If not, correct it or set as empty. Respond strictly with JSON.`;
        return promptStr;
      }

      const agent1Prompt = buildAgent1Prompt(pastData, prompt.fieldContext);
      console.log('Agent 1 LLM prompt:', agent1Prompt);

      // Helper to fetch with API key from storage
      function fetchWithApiKey(url, body, callback) {
        chrome.storage.local.get(['openaiApiKey'], async (res) => {
          const apiKey = res.openaiApiKey;
          if (!apiKey) {
            console.error('OpenAI API Key missing');
            callback({ error: 'API Key missing' });
            return;
          }
          try {
            const response = await fetch(url, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
              },
              body: JSON.stringify(body)
            });
            const data = await response.json();
            callback(data);
          } catch (err) {
            console.error('OpenAI API fetch error:', err);
            callback({ error: err.toString() });
          }
        });
      }

      // Agent 1 LLM call
      fetchWithApiKey('https://api.openai.com/v1/chat/completions', {
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'system', content: 'You are a helpful assistant that autofills web forms for users based on their previous form data.' },
          { role: 'user', content: agent1Prompt }
        ],
        max_tokens: 300
      }, (agent1Data) => {
        let agent1Suggestions = {};
        try {
          let text = agent1Data.choices[0].message.content;
          console.log('Agent 1 LLM raw response:', text);
          const match = text.match(/{[\s\S]*}/);
          if (match) text = match[0];
          text = text.replace(/'/g, '"');
          text = text.replace(/,(\s*[}\]])/g, '$1');
          agent1Suggestions = JSON.parse(text);
        } catch (e) {
          agent1Suggestions = {};
          console.error('Failed to parse Agent 1 LLM response:', e, agent1Data);
        }
        const agent2Prompt = buildAgent2Prompt(pastData, agent1Suggestions, prompt.fieldContext);
        console.log('Agent 2 LLM prompt:', agent2Prompt);
        fetchWithApiKey('https://api.openai.com/v1/chat/completions', {
          model: 'gpt-3.5-turbo',
          messages: [
            { role: 'system', content: 'You are a helpful assistant that autofills web forms for users based on their previous form data.' },
            { role: 'user', content: agent2Prompt }
          ],
          max_tokens: 300
        }, (agent2Data) => {
          let agent2Suggestions = {};
          try {
            let text2 = agent2Data.choices[0].message.content;
            console.log('Agent 2 LLM raw response:', text2);
            const match2 = text2.match(/{[\s\S]*}/);
            if (match2) text2 = match2[0];
            text2 = text2.replace(/'/g, '"');
            text2 = text2.replace(/,(\s*[}\]])/g, '$1');
            agent2Suggestions = JSON.parse(text2);
          } catch (e) {
            agent2Suggestions = {};
            console.error('Failed to parse Agent 2 LLM response:', e, agent2Data);
          }
          console.log('Sending response to content script:', { suggestions: agent2Suggestions, debug: { agent1: agent1Suggestions, agent2: agent2Suggestions } });
          sendResponse({ suggestions: agent2Suggestions, debug: { agent1: agent1Suggestions, agent2: agent2Suggestions } });
        });
      });
    });
    return true; // Keep the message channel open for async response
  }
  if (message.type === 'getEmbedding') {
    const text = message.text;
    chrome.storage.local.get(['openaiApiKey'], async (res) => {
      const apiKey = res.openaiApiKey;
      if (!apiKey) {
        console.error('OpenAI API Key missing for embedding');
        sendResponse({ error: 'API Key missing' });
        return;
      }
      try {
        const response = await fetch('https://api.openai.com/v1/embeddings', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            input: text,
            model: 'text-embedding-3-small'
          })
        });
        const data = await response.json();
        if (data && data.data && data.data[0] && data.data[0].embedding) {
          console.log('Embedding for', text, ':', data.data[0].embedding);
          sendResponse({ embedding: data.data[0].embedding });
        } else {
          console.error('Embedding API error:', data);
          sendResponse({ error: 'Embedding API error' });
        }
      } catch (err) {
        console.error('OpenAI Embedding fetch error:', err);
        sendResponse({ error: err.toString() });
      }
    });
    return true;
  }
  if (message.type === 'unmatchedFields') {
    // Relay to all popup views
    chrome.runtime.sendMessage({
      type: 'popupUnmatchedFields',
      unmatchedFields: message.unmatchedFields,
      previousValues: message.previousValues
    });
    return;
  }
  if (message.type === 'getFieldRecommendations') {
    const { field, prevFields } = message;
    const prompt = `Given user's previous form data:\n${JSON.stringify(prevFields, null, 2)}\n\nProvide a ranked JSON array of the most semantically relevant values for the new field:\n- Name: ${field.name}\n- Label: ${field.label}\n- Type: ${field.type}\n- Placeholder: ${field.placeholder}\n\nRank by semantic similarity and relevancy. For each value, include a confidence score from 0 to 1. Provide only plausible, existing values. Respond with a JSON array of objects: [ {\"value\": ..., \"confidence\": ...}, ... ]`;
    fetchWithApiKey('https://api.openai.com/v1/chat/completions', {
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: 'You are a helpful assistant that recommends previous user values for form fields.' },
        { role: 'user', content: prompt }
      ],
      max_tokens: 200
    }, (llmData) => {
      let recommendations = [];
      try {
        let text = llmData.choices[0].message.content;
        const match = text.match(/\[[^\]]*\]/s);
        if (match) text = match[0];
        recommendations = JSON.parse(text);
      } catch (e) {
        recommendations = [];
        console.error('Failed to parse LLM recommendations:', e, llmData);
      }
      sendResponse({ recommendations });
    });
    return true;
  }
  if (message.type === 'classifyFormType') {
    classifyFormType(message.htmlSnippet).then(formType => {
      sendResponse({ formType });
    });
    return true;
  }
  if (message.type === 'reviewAutofilledData') {
    reviewAutofilledData(message.filledData).then(issues => {
      sendResponse({ issues });
    });
    return true;
  }
});

// --- AJAX/SPA Form Submission Capture ---
// This listener intercepts all POST requests (AJAX/fetch/XHR) and stores form-like data in the active profile.
// Data is stored securely in local Chrome storage and never sent externally (except to OpenAI for autofill if user opts in).
chrome.webRequest.onBeforeRequest.addListener(
  function(details) {
    // Blocklist: don't capture extension's own API calls
    const blocklist = [
      "api.openai.com"
      // add more if needed
    ];
    if (blocklist.some(domain => details.url.includes(domain))) {
      return;
    }

    // Only intercept POST requests with a body
    if(details.method === 'POST' && details.requestBody) {
      console.log('AJAX/SPA SUBMISSION CAPTURED:', details);
      let requestData = {};

      // Handle formData (typical form submissions)
      if(details.requestBody.formData) {
        requestData = details.requestBody.formData;
      }
      // Handle raw data (JSON submissions common in SPAs)
      else if(details.requestBody.raw && details.requestBody.raw[0].bytes) {
        const decoder = new TextDecoder("utf-8");
        const jsonString = decoder.decode(details.requestBody.raw[0].bytes);
        // Heuristic: Only try to parse if it looks like JSON
        const trimmed = jsonString.trim();
        if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
          try {
            requestData = JSON.parse(jsonString);
          } catch(e) {
            console.error('JSON parse failed:', e, 'Raw string:', jsonString.slice(0, 100));
            return;
          }
        } else {
          // Not JSON, likely binary or form-encoded, skip
          console.warn('Raw POST body is not JSON, skipping. First 100 chars:', jsonString.slice(0, 100));
          return;
        }
      }

      // --- General Heuristic Filtering ---
      // Ignore if requestData is empty
      const keys = Object.keys(requestData);
      if (keys.length === 0) {
        console.log('AJAX/SPA SUBMISSION: requestData is empty, skipping.');
        return;
      }
      // Ignore if all keys are typical analytics/tracking/event keys
      const ignoredKeys = [
        'event', 'event_id', 'signalType', 'pageview', 'message_id', 'timestamp',
        'context', 'properties', 'misc', '_inspection', 'is_onsite', 'domain', 'url',
        'pageTitle', 'websiteSignalRequestId', 'scriptVersion', 'time', 'liFatId', 'liGiant',
        'isLinkedInApp', 'isTranslated', 'hem', 'model', 'pids', 'auto_collected_properties',
        'signal_diagnostic_labels', 'elementCrumbsTree', 'innerElements', 'isFilteredByClient', 'input', 'action'
      ];
      const hasNonIgnoredKey = keys.some(k => !ignoredKeys.includes(k));
      if (!hasNonIgnoredKey) {
        // All keys are ignored/likely analytics, skip saving
        console.log('AJAX/SPA SUBMISSION: all keys ignored, skipping.', requestData);
        return;
      }
      // --- End Heuristic Filtering ---

      // LLM-based AJAX payload classification
      (async () => {
        let isUserForm = await classifyAjaxPayload(requestData);
        if (isUserForm === null) {
          // Fallback to heuristic: save if hasNonIgnoredKey
          isUserForm = hasNonIgnoredKey;
        }
        if (!isUserForm) {
          console.log('AJAX payload rejected by LLM classifier:', requestData);
          return;
        }
        // Get the active profile and store the captured data
        chrome.storage.local.get('activeProfile', ({activeProfile}) => {
          const profile = activeProfile || 'Default';
          chrome.storage.local.get(['profiles'], ({profiles}) => {
            profiles = profiles || {};
            profiles[profile] = profiles[profile] || { forms: [], userMappings: {} };

            profiles[profile].forms.push({
              data: requestData,
              formType: 'ajax_submission',
              url: details.url,
              timestamp: Date.now()
            });

            chrome.storage.local.set({profiles}, () => {
              console.log('AJAX submission saved:', requestData);
            });
          });
        });
      })();
    }
  },
  { urls: ["<all_urls>"] },
  ["requestBody"]
);

// Utility to flatten single-element arrays to strings
function flattenData(data) {
  const flat = {};
  Object.entries(data).forEach(([k, v]) => {
    flat[k] = Array.isArray(v) && v.length === 1 ? v[0] : v;
  });
  return flat;
}

// --- LLM Utility Functions ---
async function fetchWithApiKeyLLM(url, body) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(['openaiApiKey'], (res) => {
      const apiKey = res.openaiApiKey;
      if (!apiKey) return reject('Missing OpenAI API Key');
      fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(body)
      })
        .then(r => r.json())
        .then(resolve)
        .catch(reject);
    });
  });
}

async function classifyAjaxPayload(payload) {
  const prompt = `You are an expert at identifying user-submitted form data from AJAX payloads.\nGiven this JSON payload:\n${JSON.stringify(payload)}\nClassify if this data is relevant user form submission (YES or NO), based on fields like 'email', 'address', 'name', 'phone', etc. Respond only with YES or NO.`;
  try {
    const data = await fetchWithApiKeyLLM('https://api.openai.com/v1/chat/completions', {
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: 'You are an expert at identifying user-submitted form data from AJAX payloads.' },
        { role: 'user', content: prompt }
      ],
      max_tokens: 10
    });
    const text = data.choices?.[0]?.message?.content?.trim().toUpperCase();
    return text === 'YES';
  } catch (e) {
    console.warn('LLM AJAX classifier failed, falling back to heuristic.', e);
    return null; // fallback to heuristic
  }
}

async function reviewAutofilledData(filledData) {
  const prompt = `Review this autofilled form data for logical consistency and correctness:\n${JSON.stringify(filledData)}\nHighlight any field with data that might seem incorrect, illogical, or inconsistent based on typical user profile data. Respond in JSON: {\"fieldName\": \"Issue description\", ...}`;
  try {
    const data = await fetchWithApiKeyLLM('https://api.openai.com/v1/chat/completions', {
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: 'You are an expert at reviewing autofilled form data for logical consistency.' },
        { role: 'user', content: prompt }
      ],
      max_tokens: 200
    });
    const text = data.choices?.[0]?.message?.content;
    return JSON.parse(text.match(/{[\s\S]*}/)?.[0] || '{}');
  } catch (e) {
    console.warn('Agent 3 review failed:', e);
    return {};
  }
}

async function classifyFormType(formHtmlSnippet) {
  const prompt = `Classify this form HTML snippet into one of these types: [registration, billing, job application, survey, feedback, login, generic].\n\nForm HTML:\n${formHtmlSnippet}\nRespond only with the form type.`;
  try {
    const data = await fetchWithApiKeyLLM('https://api.openai.com/v1/chat/completions', {
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: 'You are an expert at classifying web forms.' },
        { role: 'user', content: prompt }
      ],
      max_tokens: 10
    });
    return data.choices?.[0]?.message?.content?.trim().toLowerCase() || 'generic';
  } catch (e) {
    console.warn('Form type classification failed:', e);
    return 'generic';
  }
} 