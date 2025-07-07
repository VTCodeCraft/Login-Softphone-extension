

class SoftphoneManager {
  constructor() {
    this.isEnabled = true;
    this.callHistory = [];
    this.phoneRegex = /\+?\d{1,4}[\s\-\.]?\(?\d{1,4}\)?[\s\-\.]?\d{1,4}[\s\-\.]?\d{1,9}/g;
    this.widget = null;
    this.settings = {
      autoDetect: true,
      showFloatingButton: true,
      highlightNumbers: true
    };

    this.init();
  }

  async init() {
    try {
      // Load settings from storage
      await this.loadSettings();

      // Initialize if extension is enabled
      if (this.isEnabled) {
        this.createFloatingButton();
        this.setupEventListeners();
        this.highlightPhoneNumbers();
      }
    } catch (error) {
      console.error('SoftphoneManager initialization error:', error);
    }
  }

  async loadSettings() {
    try {
      const result = await chrome.storage.sync.get(['softphoneSettings']);
      if (result.softphoneSettings) {
        this.settings = { ...this.settings, ...result.softphoneSettings };
      }
    } catch (error) {
      console.error('Error loading settings:', error);
    }
  }

  async saveSettings() {
    try {
      await chrome.storage.sync.set({ softphoneSettings: this.settings });
    } catch (error) {
      console.error('Error saving settings:', error);
    }
  }

  createFloatingButton() {
    if (!this.settings.showFloatingButton || document.getElementById('softphone-floating-btn')) {
      return;
    }

    const button = document.createElement('button');
    button.id = 'softphone-floating-btn';
    button.className = 'softphone-floating-button';
    button.innerHTML = `
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56-.35-.12-.74-.03-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z"/>
    </svg>
  `;
    button.title = 'Toggle Softphone';

    button.addEventListener('click', () => {
      if (this.isWidgetOpen()) {
        this.closeWidget();
      } else {
        this.openWidget();
      }
    });

    document.body.appendChild(button);
    this.makeButtonDraggable(button);
  }

  isWidgetOpen() {
    return document.getElementById('softphone-widget-container') !== null;
  }

  setupEventListeners() {
    document.addEventListener('click', this.handleClick.bind(this));
    document.addEventListener('keydown', this.handleKeyboard.bind(this));

    // Intercept all tel: links on page load
    this.interceptAllTelLinks();

    // Optional: Handle dynamically added links
    const observer = new MutationObserver(() => this.interceptAllTelLinks());
    observer.observe(document.body, { childList: true, subtree: true });
  }

  interceptAllTelLinks() {
    const telLinks = document.querySelectorAll('a[href^="tel:"]');

    telLinks.forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const phoneNumber = link.getAttribute('href').replace(/^tel:/i, '').trim();
        if (this.isValidPhoneNumber(phoneNumber)) {
          this.initiateCall(phoneNumber);
        } else {
          this.showNotification('Invalid phone number', 'error');
        }
      });
    });
  }

  handleClick(e) {
    const target = e.target;

    // Intercept tel: links globally
    if (target.tagName === 'A' && target.href.startsWith('tel:')) {
      e.preventDefault();
      const phoneNumber = target.getAttribute('href').replace(/^tel:/i, '').trim();
      if (this.isValidPhoneNumber(phoneNumber)) {
        this.initiateCall(phoneNumber);
      }
      return;
    }

    // Handle spans or text-based numbers (if highlighted)
    if (target.classList.contains('softphone-highlighted-number')) {
      e.preventDefault();
      const phoneNumber = target.textContent.trim();
      if (this.isValidPhoneNumber(phoneNumber)) {
        this.initiateCall(phoneNumber);
      }
      return;
    }

    // Fallback: Auto-detect visible phone number
    if (this.settings.autoDetect && target.textContent) {
      const text = target.textContent.trim();
      const matches = text.match(this.phoneRegex);
      if (matches && matches.length === 1 && this.isValidPhoneNumber(matches[0])) {
        e.preventDefault();
        this.initiateCall(matches[0]);
      }
    }
  }


  handleKeyboard(e) {
    // Ctrl+Shift+P to open softphone
    if (e.ctrlKey && e.shiftKey && e.key === 'P') {
      e.preventDefault();
      this.openWidget();
    }

    // Escape to close widget
    if (e.key === 'Escape' && this.widget) {
      this.closeWidget();
    }
  }

  handleMessage(request, sender, sendResponse) {
    switch (request.action) {
      case 'toggleExtension':
        this.toggleExtension();
        sendResponse({ success: true });
        break;
      case 'openWidget':
        this.openWidget(request.number);
        sendResponse({ success: true });
        break;
      case 'getCallHistory':
        sendResponse({ callHistory: this.callHistory });
        break;
      case 'clearCallHistory':
        this.clearCallHistory();
        sendResponse({ success: true });
        break;
      case 'updateSettings':
        this.updateSettings(request.settings);
        sendResponse({ success: true });
        break;
      default:
        sendResponse({ error: 'Unknown action' });
    }
  }

  highlightPhoneNumbers() {
    if (!this.settings.highlightNumbers) return;

    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          // Skip script and style elements
          const parent = node.parentElement;
          if (parent && ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(parent.tagName)) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    const textNodes = [];
    let node;
    while (node = walker.nextNode()) {
      textNodes.push(node);
    }

    textNodes.forEach(textNode => {
      const text = textNode.textContent;
      const matches = [...text.matchAll(this.phoneRegex)];

      if (matches.length > 0) {
        const parent = textNode.parentElement;
        let newHTML = text;

        // Replace matches with highlighted spans (in reverse order)
        matches.reverse().forEach(match => {
          const phoneNumber = match[0];
          const highlightedSpan = `<span class="softphone-highlighted-number" title="Click to call ${phoneNumber}">${phoneNumber}</span>`;
          newHTML = newHTML.substring(0, match.index) + highlightedSpan + newHTML.substring(match.index + phoneNumber.length);
        });

        if (newHTML !== text) {
          parent.innerHTML = parent.innerHTML.replace(text, newHTML);
        }
      }
    });
  }

  initiateCall(phoneNumber) {
    if (!phoneNumber) return;

    const cleanNumber = this.cleanPhoneNumber(phoneNumber);
    if (!this.isValidPhoneNumber(cleanNumber)) {
      this.showNotification('Invalid phone number format', 'error');
      return;
    }

    this.addToCallHistory(cleanNumber);
    this.openWidget(cleanNumber);
  }
  
 closeWidget() {
  if (this.widget) {
    this.widget.remove();
    this.widget = null;
  }
}

 openWidget(phoneNumber = '') {
  // If widget is already open, close it (toggle behavior)
  if (this.widget) {
    this.closeWidget();
    return;
  }

  try {
    // Create widget container
    const widgetContainer = document.createElement('div');
    widgetContainer.id = 'softphone-widget-container';
    widgetContainer.className = 'softphone-widget-container';

    // Create iframe
    const iframe = document.createElement('iframe');
    iframe.id = 'softphone-widget';
    iframe.className = 'softphone-frame';
    iframe.src = `https://login-softphone.vercel.app/?number=${encodeURIComponent(phoneNumber)}`;
    iframe.allow = 'microphone';
    iframe.title = 'Softphone Widget';

    // Create header (without controls)
    const header = document.createElement('div');

    // Make widget draggable
    this.makeDraggable(widgetContainer, header);

    // Assemble widget
    widgetContainer.appendChild(header);
    widgetContainer.appendChild(iframe);

    // Add to page
    document.body.appendChild(widgetContainer);
    this.widget = widgetContainer; // ✅ assign AFTER it's created

    // Optional: show a toast
    if (phoneNumber) {
      this.showNotification(`Calling ${phoneNumber}...`, 'success');
    }

  } catch (error) {
    console.error('Error opening softphone widget:', error);
    this.showNotification('Failed to open softphone', 'error');
  }
}

  makeDraggable(element, handle) {
    let isDragging = false;
    let currentX, currentY, initialX, initialY;

    handle.addEventListener('mousedown', (e) => {
      isDragging = true;
      initialX = e.clientX - element.offsetLeft;
      initialY = e.clientY - element.offsetTop;
      element.style.cursor = 'grabbing';
    });

    document.addEventListener('mousemove', (e) => {
      if (isDragging) {
        e.preventDefault();
        currentX = e.clientX - initialX;
        currentY = e.clientY - initialY;

        element.style.left = currentX + 'px';
        element.style.top = currentY + 'px';
      }
    });

    document.addEventListener('mouseup', () => {
      isDragging = false;
      element.style.cursor = 'default';
    });
  }

  makeButtonDraggable(button) {
    let isDragging = false;
    let offsetX = 0;
    let offsetY = 0;

    button.addEventListener('mousedown', (e) => {
      isDragging = true;
      offsetX = e.clientX - button.getBoundingClientRect().left;
      offsetY = e.clientY - button.getBoundingClientRect().top;
      button.style.transition = 'none';
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;

      const x = e.clientX - offsetX;
      const y = e.clientY - offsetY;

      button.style.left = `${x}px`;
      button.style.top = `${y}px`;
    });

    document.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        button.style.transition = 'left 0.2s ease, top 0.2s ease';
      }
    });
  }

  cleanPhoneNumber(phoneNumber) {
    return phoneNumber.replace(/[^\d+]/g, '');
  }

  isValidPhoneNumber(phoneNumber) {
    const cleaned = phoneNumber.replace(/[^\d+]/g, '');
    return /^[+]?[\d\s\-().]{7,15}$/.test(cleaned) && cleaned.length >= 7 && cleaned.length <= 15;
  }

  addToCallHistory(phoneNumber) {
    const timestamp = new Date().toISOString();
    const call = {
      number: phoneNumber,
      timestamp: timestamp,
      direction: 'outbound'
    };

    this.callHistory.unshift(call);

    // Keep only last 50 calls
    if (this.callHistory.length > 50) {
      this.callHistory = this.callHistory.slice(0, 50);
    }

    // Save to storage
    chrome.storage.local.set({ callHistory: this.callHistory });
  }

  clearCallHistory() {
    this.callHistory = [];
    chrome.storage.local.set({ callHistory: [] });
  }

  showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `softphone-notification ${type}`;
    notification.textContent = message;

    document.body.appendChild(notification);

    // Auto-remove after 3 seconds
    setTimeout(() => {
      notification.remove();
    }, 3000);
  }

  toggleExtension() {
    this.isEnabled = !this.isEnabled;

    if (this.isEnabled) {
      this.createFloatingButton();
      this.highlightPhoneNumbers();
    } else {
      const floatingBtn = document.getElementById('softphone-floating-btn');
      if (floatingBtn) floatingBtn.remove();
      this.closeWidget();
      this.removeHighlights();
    }
  }

  removeHighlights() {
    const highlights = document.querySelectorAll('.softphone-highlighted-number');
    highlights.forEach(highlight => {
      highlight.replaceWith(highlight.textContent);
    });
  }

  updateSettings(newSettings) {
    this.settings = { ...this.settings, ...newSettings };
    this.saveSettings();

    // Apply settings immediately
    if (newSettings.showFloatingButton !== undefined) {
      const floatingBtn = document.getElementById('softphone-floating-btn');
      if (newSettings.showFloatingButton && !floatingBtn) {
        this.createFloatingButton();
      } else if (!newSettings.showFloatingButton && floatingBtn) {
        floatingBtn.remove();
      }
    }

    if (newSettings.highlightNumbers !== undefined) {
      if (newSettings.highlightNumbers) {
        this.highlightPhoneNumbers();
      } else {
        this.removeHighlights();
      }
    }
  }
}

// Initialize the softphone manager when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    new SoftphoneManager();
  });
} else {
  new SoftphoneManager();
}