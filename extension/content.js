// ResiQ CRM Gmail Extension - Content Script
// Detects email context in Gmail and sends it to the sidebar panel

(function () {
  'use strict';

  let currentEmail = null;
  let currentSubject = null;
  let currentFrom = null;
  let observer = null;
  let urlCheckInterval = null;

  // ── Gmail SPA Navigation Detection ────────────────────────────────────────────

  function getGmailView() {
    const hash = window.location.hash;
    if (hash.includes('#inbox/') || hash.includes('#sent/') || hash.includes('#drafts/') || 
        hash.includes('#all/') || hash.includes('#starred/') || hash.includes('#snoozed/') ||
        hash.includes('#search/') || hash.includes('#label/')) {
      const segments = hash.split('/');
      // If there's a message ID in the URL, we're viewing an email
      if (segments.length >= 2 && segments[segments.length - 1].length > 10) {
        return 'email';
      }
    }
    if (hash === '#inbox' || hash === '#sent' || hash === '#drafts' || hash === '' || hash === '#') {
      return 'list';
    }
    return 'other';
  }

  // ── Extract Email Details from Gmail DOM ──────────────────────────────────────

  function extractEmailDetails() {
    // Gmail renders the sender email in several possible ways.
    // Strategy: look for the email header area and extract sender info.

    // Try finding the "from" sender section
    // Method 1: Look for spans with email attribute (Gmail uses [email] attr on sender spans)
    const emailSpans = document.querySelectorAll('span[email]');
    let senderEmail = null;
    let senderName = null;

    for (const span of emailSpans) {
      const email = span.getAttribute('email');
      if (email && email.includes('@')) {
        // The outer span usually has the name as text content
        senderEmail = email;
        senderName = span.textContent?.trim() || email;
        // The name often includes the email in some cases, clean it
        if (senderName === email || senderName.includes('<')) {
          senderName = email.split('@')[0];
        }
        break;
      }
    }

    // Method 2: Look for the email subject
    const subjectEl = document.querySelector('h2[data-thread-perm-id], h2.hP, h2[data-subject]');
    let subject = '';
    if (subjectEl) {
      subject = subjectEl.textContent?.trim() || '';
    } else {
      // Alternative: look in the thread subject area
      const threadSubject = document.querySelector('[data-thread-perm-id]');
      if (threadSubject) {
        subject = threadSubject.getAttribute('data-subject') || '';
      }
    }

    // If no subject found, try the subject input or other elements
    if (!subject) {
      const subjInput = document.querySelector('input[name="subject"]');
      if (subjInput) subject = subjInput.value || '';
    }

    if (!subject) {
      // Try aria-label approach
      const threadArea = document.querySelector('[role="main"] [role="region"]');
      if (threadArea) {
        const ariaLabel = threadArea.getAttribute('aria-label');
        if (ariaLabel) {
          // aria-label might contain the subject
          const match = ariaLabel.match(/"([^"]+)"/);
          if (match) subject = match[1];
        }
      }
    }

    // Method 3: Get sender name from the "from" header display
    if (!senderEmail) {
      const fromHeader = document.querySelector('.gD, [data-hovercard-id]');
      if (fromHeader) {
        senderEmail = fromHeader.getAttribute('email') || fromHeader.getAttribute('data-hovercard-id') || '';
        senderName = fromHeader.textContent?.trim() || senderEmail;
        // Sometimes the text is "Name <email>"
        const bracketMatch = senderName.match(/<([^>]+)>/);
        if (bracketMatch) {
          senderEmail = bracketMatch[1];
          senderName = senderName.replace(/<[^>]+>/, '').trim() || senderEmail.split('@')[0];
        }
      }
    }

    return {
      email: senderEmail || '',
      name: senderName || senderEmail || '',
      subject: subject || '(no subject)',
    };
  }

  // ── Send Context to Background Script ─────────────────────────────────────────

  function sendEmailContext() {
    if (getGmailView() !== 'email') {
      if (currentEmail) {
        currentEmail = null;
        currentSubject = null;
        currentFrom = null;
        chrome.runtime.sendMessage({ action: 'UPDATE_EMAIL_CONTEXT', email: '', subject: '', from: '' });
      }
      return;
    }

    const details = extractEmailDetails();
    
    // Only send if something changed
    if (details.email !== currentEmail || details.subject !== currentSubject) {
      currentEmail = details.email;
      currentSubject = details.subject;
      currentFrom = details.name;

      if (details.email) {
        chrome.runtime.sendMessage({
          action: 'UPDATE_EMAIL_CONTEXT',
          email: details.email,
          subject: details.subject,
          from: details.name,
        });
      }
    }
  }

  // ── Watch for DOM Changes (Gmail is a dynamic SPA) ────────────────────────────

  function startWatching() {
    // Check on URL hash changes (Gmail uses hash routing)
    let lastHash = window.location.hash;
    urlCheckInterval = setInterval(() => {
      const currentHash = window.location.hash;
      if (currentHash !== lastHash) {
        lastHash = currentHash;
        // Small delay to let Gmail render the new email
        setTimeout(sendEmailContext, 1500);
      }
    }, 1000);

    // Also watch for DOM changes in the main content area
    const targetNode = document.querySelector('div[role="main"]') || document.body;
    observer = new MutationObserver(() => {
      sendEmailContext();
    });
    observer.observe(targetNode, {
      childList: true,
      subtree: true,
      attributes: false,
    });

    // Initial check
    setTimeout(sendEmailContext, 2000);
  }

  // ── Initialize ────────────────────────────────────────────────────────────────

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startWatching);
  } else {
    startWatching();
  }

  // Expose for debugging
  window.__RESIQ_EXTENSION = { extractEmailDetails, getGmailView, sendEmailContext };

  console.log('ResiQ CRM: Content script loaded');
})();
