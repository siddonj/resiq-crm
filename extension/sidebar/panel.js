// ResiQ CRM Gmail Extension - Sidebar Panel
(function () {
  'use strict';

  // ── DOM References ────────────────────────────────────────────────────────────

  const $ = (id) => document.getElementById(id);
  const views = {
    auth: $('auth-view'),
    loading: $('loading-view'),
    contact: $('contact-view'),
    notfound: $('notfound-view'),
    error: $('error-view'),
  };

  const els = {
    authError: $('auth-error'),
    loginForm: $('login-form'),
    loginBtn: $('login-btn'),
    apiUrl: $('api-url'),
    email: $('email'),
    password: $('password'),
    logoutBtn: $('logout-btn'),
    contactName: $('contact-name'),
    contactEmail: $('contact-email'),
    contactAvatar: $('contact-avatar'),
    contactSource: $('contact-source'),
    contactMeta: $('contact-meta'),
    contactTags: $('contact-tags'),
    actionLogEmail: $('action-log-email'),
    actionViewCrm: $('action-view-crm'),
    unknownEmail: $('unknown-email'),
    addContactBtn: $('add-contact-btn'),
    addForm: $('add-form'),
    addName: $('add-name'),
    addCompany: $('add-company'),
    addSource: $('add-source'),
    saveContactBtn: $('save-contact-btn'),
    errorMessage: $('error-message'),
    retryBtn: $('retry-btn'),
    dealsEmpty: $('deals-empty'),
    dealsList: $('deals-list'),
    emailsEmpty: $('emails-empty'),
    emailsList: $('emails-list'),
    activityEmpty: $('activity-empty'),
    activityList: $('activity-list'),
  };

  let currentContext = { email: '', subject: '', from: '' };
  let currentContact = null;
  let isAuthenticated = false;

  // ── View Management ───────────────────────────────────────────────────────────

  function showView(name) {
    Object.keys(views).forEach(key => views[key].classList.add('hidden'));
    views[name].classList.remove('hidden');
  }

  function showError(msg) {
    $('error-message').textContent = msg;
    showView('error');
  }

  // ── Auth ──────────────────────────────────────────────────────────────────────

  async function checkAuth() {
    try {
      const result = await chrome.runtime.sendMessage({ action: 'CHECK_AUTH' });
      isAuthenticated = result.authenticated;
      if (isAuthenticated) {
        await checkEmailContext();
      } else {
        showView('auth');
      }
    } catch (err) {
      showView('auth');
    }
  }

  els.loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    els.authError.classList.add('hidden');
    els.loginBtn.disabled = true;
    els.loginBtn.textContent = 'Signing in...';

    try {
      const result = await chrome.runtime.sendMessage({
        action: 'LOGIN',
        apiUrl: els.apiUrl.value.trim(),
        email: els.email.value.trim(),
        password: els.password.value,
      });

      if (result.success) {
        isAuthenticated = true;
        await checkEmailContext();
      } else {
        els.authError.textContent = result.error || 'Login failed';
        els.authError.classList.remove('hidden');
      }
    } catch (err) {
      els.authError.textContent = 'Connection failed';
      els.authError.classList.remove('hidden');
    } finally {
      els.loginBtn.disabled = false;
      els.loginBtn.textContent = 'Sign In';
    }
  });

  els.logoutBtn.addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ action: 'LOGOUT' });
    isAuthenticated = false;
    currentContact = null;
    currentContext = { email: '', subject: '', from: '' };
    showView('auth');
  });

  // ── Email Context ─────────────────────────────────────────────────────────────

  async function checkEmailContext() {
    // Listen for context updates from background via messages
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === 'EMAIL_CONTEXT') {
        currentContext = { email: msg.email, subject: msg.subject, from: msg.from };
        if (msg.email) {
          performLookup(msg.email);
        } else {
          showView('loading');
        }
      }
    });

    // If we already have a context from a prior update, use it
    showView('loading');
    // Give the content script time to detect the current email
    setTimeout(() => {
      // If no context detected yet, show a message
      if (!currentContext.email) {
        document.querySelector('.loading-container p').textContent = 'Open an email in Gmail to see CRM data';
      }
    }, 3000);
  }

  // ── API Calls via Background ──────────────────────────────────────────────────

  async function performLookup(email) {
    showView('loading');
    document.querySelector('.loading-container p').textContent = 'Looking up contact...';

    try {
      const result = await chrome.runtime.sendMessage({ action: 'LOOKUP', email });

      if (!result.success) {
        if (result.error === 'AUTH_EXPIRED') {
          isAuthenticated = false;
          showView('auth');
          return;
        }
        showError(result.error || 'Lookup failed');
        return;
      }

      if (result.found) {
        currentContact = result.contact;
        showContact(result);
      } else {
        currentContact = null;
        showNotFound(email);
      }
    } catch (err) {
      showError('Failed to look up contact');
    }
  }

  // ── Contact Found View ────────────────────────────────────────────────────────

  function showContact(data) {
    const contact = data.contact;
    currentContact = contact;

    els.contactName.textContent = contact.name || contact.email;
    els.contactEmail.textContent = contact.email;
    els.contactAvatar.textContent = (contact.name || contact.email)[0].toUpperCase();
    els.contactSource.textContent = contact.source || 'contact';
    els.contactSource.className = 'badge ' + (contact.type === 'lead' ? 'badge-lead' : '');

    // Meta info
    let metaHtml = '';
    if (contact.company) metaHtml += `<span>🏢 ${contact.company}</span>`;
    if (contact.phone) metaHtml += `<span>📞 ${contact.phone}</span>`;
    if (contact.type) metaHtml += `<span>📋 ${contact.type}</span>`;
    els.contactMeta.innerHTML = metaHtml;

    // Tags
    if (contact.tags && contact.tags.length > 0) {
      els.contactTags.innerHTML = contact.tags.map(t => `<span class="tag">${t}</span>`).join('');
      els.contactTags.classList.remove('hidden');
    } else {
      els.contactTags.classList.add('hidden');
    }

    // Deals
    if (data.deals && data.deals.length > 0) {
      els.dealsEmpty.classList.add('hidden');
      els.dealsList.innerHTML = data.deals.map(deal => `
        <div class="list-item">
          <div class="list-item-title">${deal.name || 'Deal'}</div>
          <div class="list-item-sub">${deal.stage || 'Unknown stage'} · $${deal.value || 0}</div>
        </div>
      `).join('');
    } else {
      els.dealsEmpty.classList.remove('hidden');
      els.dealsList.innerHTML = '';
    }

    // Recent Emails
    if (data.recentEmails && data.recentEmails.length > 0) {
      els.emailsEmpty.classList.add('hidden');
      els.emailsList.innerHTML = data.recentEmails.map(email => `
        <div class="list-item">
          <div class="list-item-title">${email.subject || '(no subject)'}</div>
          <div class="list-item-sub">${email.direction === 'outbound' ? '→ Sent' : '← Received'}</div>
          <div class="list-item-meta">${new Date(email.date).toLocaleDateString()}</div>
        </div>
      `).join('');
    } else {
      els.emailsEmpty.classList.remove('hidden');
      els.emailsList.innerHTML = '';
    }

    // Activities
    if (data.recentActivities && data.recentActivities.length > 0) {
      els.activityEmpty.classList.add('hidden');
      els.activityList.innerHTML = data.recentActivities.map(act => `
        <div class="list-item">
          <div class="list-item-title">${act.type}</div>
          <div class="list-item-sub">${act.description || ''}</div>
          <div class="list-item-meta">${new Date(act.created_at).toLocaleDateString()}</div>
        </div>
      `).join('');
    } else {
      els.activityEmpty.classList.remove('hidden');
      els.activityList.innerHTML = '';
    }

    // Log email button state
    els.actionLogEmail.disabled = false;
    els.actionLogEmail.textContent = currentContext.subject 
      ? '✓ Log This Email' 
      : '✓ Log Email';

    showView('contact');
  }

  // ── Contact Not Found ─────────────────────────────────────────────────────────

  function showNotFound(email) {
    els.unknownEmail.textContent = email;
    els.addName.value = currentContext.from || email.split('@')[0] || '';
    els.addCompany.value = '';
    els.addForm.classList.add('hidden');
    showView('notfound');
  }

  els.addContactBtn.addEventListener('click', () => {
    els.addForm.classList.remove('hidden');
    els.addContactBtn.classList.add('hidden');
  });

  els.saveContactBtn.addEventListener('click', async () => {
    const email = els.unknownEmail.textContent;
    const name = els.addName.value.trim();
    if (!name) {
      els.addName.style.borderColor = 'var(--red)';
      return;
    }

    els.saveContactBtn.disabled = true;
    els.saveContactBtn.textContent = 'Saving...';

    try {
      const result = await chrome.runtime.sendMessage({
        action: 'CREATE_CONTACT',
        data: {
          email,
          name,
          company: els.addCompany.value.trim() || null,
          source: els.addSource.value,
        },
      });

      if (result.success && result.created) {
        // Re-lookup to show the contact view
        await performLookup(email);
      } else if (result.success && !result.created) {
        // Already existed, just re-lookup
        await performLookup(email);
      } else {
        showError('Failed to create contact');
      }
    } catch (err) {
      showError('Failed to create contact');
    } finally {
      els.saveContactBtn.disabled = false;
      els.saveContactBtn.textContent = 'Save Contact';
    }
  });

  // ── Actions ───────────────────────────────────────────────────────────────────

  els.actionLogEmail.addEventListener('click', async () => {
    if (!currentContact || !currentContext.email) return;

    els.actionLogEmail.disabled = true;
    els.actionLogEmail.textContent = 'Logging...';

    try {
      const result = await chrome.runtime.sendMessage({
        action: 'LOG_EMAIL',
        data: {
          contactId: currentContact.id,
          subject: currentContext.subject || '(no subject)',
          body: '',
          from: currentContext.from || '',
          to: currentContext.email,
          date: new Date().toISOString(),
          direction: 'inbound',
        },
      });

      if (result.success) {
        els.actionLogEmail.textContent = '✓ Logged!';
        setTimeout(() => {
          els.actionLogEmail.textContent = '✓ Log Email';
          els.actionLogEmail.disabled = false;
        }, 2000);
        // Refresh contact data to show the newly logged email
        await performLookup(currentContext.email);
      }
    } catch (err) {
      els.actionLogEmail.disabled = false;
      els.actionLogEmail.textContent = '✓ Log Email';
    }
  });

  els.actionViewCrm.addEventListener('click', () => {
    if (currentContact) {
      window.open(`https://crm.resiq.co/contacts/${currentContact.id}`, '_blank');
    }
  });

  els.retryBtn.addEventListener('click', async () => {
    if (currentContext.email) {
      await performLookup(currentContext.email);
    } else {
      await checkAuth();
    }
  });

  // ── Tab Switching ─────────────────────────────────────────────────────────────

  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
      tab.classList.add('active');
      $(`${tab.dataset.tab}-view`).classList.add('active');
    });
  });

  // ── Init ──────────────────────────────────────────────────────────────────────

  document.addEventListener('DOMContentLoaded', checkAuth);
})();
