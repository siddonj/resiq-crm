// ResiQ CRM Gmail Extension - Background Service Worker
// Handles auth, API calls, and communication between content script and sidebar

const STORAGE_KEYS = {
  TOKEN: 'resiq_token',
  USER: 'resiq_user',
  API_URL: 'resiq_api_url',
};

const DEFAULT_API_URL = 'https://crm.resiq.co';

// ── Auth Management ───────────────────────────────────────────────────────────

async function getToken() {
  const result = await chrome.storage.local.get([STORAGE_KEYS.TOKEN]);
  return result[STORAGE_KEYS.TOKEN] || null;
}

async function getUser() {
  const result = await chrome.storage.local.get([STORAGE_KEYS.USER]);
  return result[STORAGE_KEYS.USER] || null;
}

async function getApiUrl() {
  const result = await chrome.storage.local.get([STORAGE_KEYS.API_URL]);
  return result[STORAGE_KEYS.API_URL] || DEFAULT_API_URL;
}

async function setAuth(token, user) {
  await chrome.storage.local.set({
    [STORAGE_KEYS.TOKEN]: token,
    [STORAGE_KEYS.USER]: user,
  });
}

async function clearAuth() {
  await chrome.storage.local.remove([STORAGE_KEYS.TOKEN, STORAGE_KEYS.USER]);
}

// ── API Client ─────────────────────────────────────────────────────────────────

async function apiRequest(path, options = {}) {
  const apiUrl = await getApiUrl();
  const token = await getToken();
  const url = `${apiUrl}/api/extension${path}`;

  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (response.status === 401) {
    // Token expired or invalid
    await clearAuth();
    throw new Error('AUTH_EXPIRED');
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
}

// ── Login ──────────────────────────────────────────────────────────────────────

async function login(apiUrl, email, password) {
  const response = await fetch(`${apiUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Login failed' }));
    throw new Error(error.error || 'Login failed');
  }

  const data = await response.json();
  const user = { id: data.user?.id, name: data.user?.name, email: data.user?.email, role: data.user?.role };

  await chrome.storage.local.set({ [STORAGE_KEYS.API_URL]: apiUrl });
  await setAuth(data.token, user);

  return { token: data.token, user };
}

// ── Lookup Contact by Email ────────────────────────────────────────────────────

async function lookupContact(email) {
  return apiRequest(`/lookup?email=${encodeURIComponent(email)}`);
}

// ── Create Contact ─────────────────────────────────────────────────────────────

async function createContact(data) {
  return apiRequest('/contacts', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// ── Log Email ──────────────────────────────────────────────────────────────────

async function logEmail(data) {
  return apiRequest('/emails/log', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// ── Get Current User ───────────────────────────────────────────────────────────

async function getMe() {
  const user = await getUser();
  return user;
}

// ── Side Panel Management ──────────────────────────────────────────────────────

// Open the side panel when user clicks the extension icon
chrome.action.onClicked.addListener(async (tab) => {
  if (tab.url?.includes('mail.google.com')) {
    await chrome.sidePanel.open({ windowId: tab.windowId });
  } else {
    // Not on Gmail - open popup
    await chrome.action.openPopup();
  }
});

// ── Message Handling ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handler = {
    'LOGIN': async () => {
      try {
        const result = await login(message.apiUrl, message.email, message.password);
        return { success: true, ...result };
      } catch (err) {
        return { success: false, error: err.message };
      }
    },
    'LOGOUT': async () => {
      await clearAuth();
      return { success: true };
    },
    'CHECK_AUTH': async () => {
      const token = await getToken();
      const user = await getUser();
      return { authenticated: !!token, user };
    },
    'LOOKUP': async () => {
      try {
        const result = await lookupContact(message.email);
        return { success: true, ...result };
      } catch (err) {
        return { success: false, error: err.message };
      }
    },
    'CREATE_CONTACT': async () => {
      try {
        const result = await createContact(message.data);
        return { success: true, ...result };
      } catch (err) {
        return { success: false, error: err.message };
      }
    },
    'LOG_EMAIL': async () => {
      try {
        const result = await logEmail(message.data);
        return { success: true, ...result };
      } catch (err) {
        return { success: false, error: err.message };
      }
    },
    'UPDATE_EMAIL_CONTEXT': async () => {
      // Content script sent email context - broadcast to all sidebar panels
      const views = chrome.extension.getViews({ type: 'panel' });
      views.forEach(view => {
        view.postMessage({ type: 'EMAIL_CONTEXT', email: message.email, subject: message.subject, from: message.from }, '*');
      });
      return { success: true };
    },
  };

  const action = handler[message.action];
  if (action) {
    action().then(sendResponse);
    return true; // Keep channel open for async response
  }
});

// Listen for connections from sidebar panel
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'sidebar') {
    port.onMessage.addListener((msg) => {
      if (msg.action === 'getEmailContext') {
        port.postMessage({ type: 'emailContext', ...msg });
      }
    });
  }
});

console.log('ResiQ CRM Extension: Background service worker loaded');
