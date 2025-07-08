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

    // Optimization: Cache DOM elements and use throttling
    this.domCache = new Map();
    this.processedElements = new WeakSet();
    this.throttledHighlight = this.throttle(this.highlightPhoneNumbers.bind(this), 100);
    this.debouncedIntercept = this.debounce(this.interceptNewTelLinks.bind(this), 50);

    // Optimization: Use event delegation instead of individual listeners
    this.boundHandleClick = this.handleClick.bind(this);
    this.boundHandleKeyboard = this.handleKeyboard.bind(this);

    this.init();
  }

  // Optimization: Add throttle utility
  throttle(func, delay) {
    let timeoutId;
    let lastExecTime = 0;
    return function (...args) {
      const currentTime = Date.now();

      if (currentTime - lastExecTime > delay) {
        func.apply(this, args);
        lastExecTime = currentTime;
      } else {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
          func.apply(this, args);
          lastExecTime = Date.now();
        }, delay - (currentTime - lastExecTime));
      }
    };
  }

  // Optimization: Add debounce utility
  debounce(func, delay) {
    let timeoutId;
    return function (...args) {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => func.apply(this, args), delay);
    };
  }

  async init() {
    try {
      await this.loadSettings();

      if (this.isEnabled) {
        this.createFloatingButton();
        this.setupEventListeners();
        // Optimization: Use requestIdleCallback for non-critical tasks
        this.scheduleHighlighting();
      }
    } catch (error) {
      console.error('SoftphoneManager initialization error:', error);
    }
  }

  // Optimization: Schedule highlighting during idle time
  scheduleHighlighting() {
    if (window.requestIdleCallback) {
      window.requestIdleCallback(() => {
        this.highlightPhoneNumbers();
      });
    } else {
      setTimeout(() => this.highlightPhoneNumbers(), 0);
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
    if (!this.settings.showFloatingButton || this.domCache.get('floatingButton')) {
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
    this.domCache.set('floatingButton', button);
    this.makeButtonDraggable(button);
  }

  isWidgetOpen() {
    return this.domCache.has('widget') && this.domCache.get('widget').parentNode;
  }

  setupEventListeners() {
    // Optimization: Use event delegation for better performance
    document.addEventListener('click', this.boundHandleClick, true);
    document.addEventListener('keydown', this.boundHandleKeyboard);

    // Optimization: Intercept existing tel links immediately
    this.interceptAllTelLinks();

    // Optimization: Use more efficient mutation observer
    this.setupMutationObserver();
  }

  // Optimization: More efficient mutation observer
  setupMutationObserver() {
    const observer = new MutationObserver((mutations) => {
      let hasNewNodes = false;

      for (const mutation of mutations) {
        if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              hasNewNodes = true;
              break;
            }
          }
        }
        if (hasNewNodes) break;
      }

      if (hasNewNodes) {
        this.debouncedIntercept();
        this.throttledHighlight();
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      // Optimization: Only observe what we need
      attributes: false,
      characterData: false
    });

    this.mutationObserver = observer;
  }

  // Optimization: More efficient tel link interception
  interceptAllTelLinks() {
    const telLinks = document.querySelectorAll('a[href^="tel:"]:not([data-softphone-processed])');

    telLinks.forEach(link => {
      if (this.processedElements.has(link)) return;

      link.setAttribute('data-softphone-processed', 'true');
      this.processedElements.add(link);

      // Optimization: Use passive event listener
      link.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const phoneNumber = link.getAttribute('href').replace(/^tel:/i, '').trim();
        if (this.isValidPhoneNumber(phoneNumber)) {
          this.initiateCall(phoneNumber);
        } else {
          this.showNotification('Invalid phone number', 'error');
        }
      }, { passive: false });
    });
  }

  // Optimization: Process only new tel links
  interceptNewTelLinks() {
    this.interceptAllTelLinks();
  }

  // Optimization: Improved click handler with early returns
  handleClick(e) {
    const target = e.target;

    // Optimization: Early return for non-relevant clicks
    if (!target || target.closest('.softphone-widget-container')) {
      return;
    }

    // Handle tel links (fallback for dynamically added links)
    if (target.tagName === 'A' && target.href && target.href.startsWith('tel:')) {
      e.preventDefault();
      e.stopPropagation();
      const phoneNumber = target.getAttribute('href').replace(/^tel:/i, '').trim();
      if (this.isValidPhoneNumber(phoneNumber)) {
        this.initiateCall(phoneNumber);
      }
      return;
    }

    // Handle highlighted numbers
    if (target.classList && target.classList.contains('softphone-highlighted-number')) {
      e.preventDefault();
      e.stopPropagation();
      const phoneNumber = target.textContent.trim();
      if (this.isValidPhoneNumber(phoneNumber)) {
        this.initiateCall(phoneNumber);
      }
      return;
    }

    // Optimization: Skip auto-detect if not enabled or no text content
    if (!this.settings.autoDetect || !target.textContent) {
      return;
    }

    // Auto-detect phone numbers (more restrictive)
    const text = target.textContent.trim();
    if (text.length > 50) return; // Skip very long text for performance

    const matches = text.match(this.phoneRegex);
    if (matches && matches.length === 1 && this.isValidPhoneNumber(matches[0])) {
      e.preventDefault();
      e.stopPropagation();
      this.initiateCall(matches[0]);
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

  // Optimization: Much more efficient phone number highlighting
  highlightPhoneNumbers() {
    if (!this.settings.highlightNumbers) return;

    // Use document fragment for better performance
    const fragment = document.createDocumentFragment();

    // Optimization: Process only new text nodes
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          const parent = node.parentElement;

          // Skip if already processed
          if (this.processedElements.has(parent)) {
            return NodeFilter.FILTER_REJECT;
          }

          // Skip script, style, and other non-content elements
          if (parent && ['SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'OBJECT'].includes(parent.tagName)) {
            return NodeFilter.FILTER_REJECT;
          }

          // Skip if parent has softphone classes
          if (parent && parent.classList &&
            (parent.classList.contains('softphone-highlighted-number') ||
              parent.classList.contains('softphone-widget-container'))) {
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

    // Optimization: Use requestAnimationFrame for non-blocking processing
    const processChunk = (startIndex) => {
      const endIndex = Math.min(startIndex + 10, textNodes.length);

      for (let i = startIndex; i < endIndex; i++) {
        const textNode = textNodes[i];
        const text = textNode.textContent;

        // Skip very long text for performance
        if (text.length > 200) continue;

        const matches = [...text.matchAll(this.phoneRegex)];

        if (matches.length > 0) {
          const parent = textNode.parentElement;
          if (!parent) continue;

          let newHTML = text;

          // Replace matches with highlighted spans (in reverse order)
          matches.reverse().forEach(match => {
            const phoneNumber = match[0];
            const highlightedSpan = `<span class="softphone-highlighted-number" title="Click to call ${phoneNumber}">${phoneNumber}</span>`;
            newHTML = newHTML.substring(0, match.index) + highlightedSpan + newHTML.substring(match.index + phoneNumber.length);
          });

          if (newHTML !== text) {
            parent.innerHTML = parent.innerHTML.replace(text, newHTML);
            this.processedElements.add(parent);
          }
        }
      }

      // Process next chunk
      if (endIndex < textNodes.length) {
        if (window.requestAnimationFrame) {
          requestAnimationFrame(() => processChunk(endIndex));
        } else {
          setTimeout(() => processChunk(endIndex), 0);
        }
      }
    };

    if (textNodes.length > 0) {
      processChunk(0);
    }
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
      this.domCache.delete('widget');
    }
  }

  // Optimization: Cache position calculations
  calculateWidgetPosition() {
    const button = this.domCache.get('floatingButton');

    const widgetWidth = 380;
    const widgetHeight = 580;
    const spacing = 10;
    const margin = 20;

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    const availableWidth = viewportWidth - (2 * margin);
    const availableHeight = viewportHeight - (2 * margin);

    const actualWidgetWidth = Math.min(widgetWidth, availableWidth);
    const actualWidgetHeight = Math.min(widgetHeight, availableHeight);

    let position = {};

    if (!button) {
      position.left = `${Math.max(margin, (viewportWidth - actualWidgetWidth) / 2)}px`;
      position.top = `${Math.max(margin, (viewportHeight - actualWidgetHeight) / 2)}px`;
      return position;
    }

    const buttonRect = button.getBoundingClientRect();

    // Calculate horizontal position
    let leftPos;
    if (buttonRect.left - actualWidgetWidth - spacing >= margin) {
      leftPos = buttonRect.left - actualWidgetWidth - spacing;
    } else if (buttonRect.right + spacing + actualWidgetWidth <= viewportWidth - margin) {
      leftPos = buttonRect.right + spacing;
    } else {
      leftPos = Math.max(margin, (viewportWidth - actualWidgetWidth) / 2);
    }

    leftPos = Math.max(margin, Math.min(leftPos, viewportWidth - actualWidgetWidth - margin));

    // Calculate vertical position
    let topPos;
    if (buttonRect.top - actualWidgetHeight - spacing >= margin) {
      topPos = buttonRect.top - actualWidgetHeight - spacing;
    } else if (buttonRect.bottom + spacing + actualWidgetHeight <= viewportHeight - margin) {
      topPos = buttonRect.bottom + spacing;
    } else {
      topPos = Math.max(margin, (viewportHeight - actualWidgetHeight) / 2);
    }

    topPos = Math.max(margin, Math.min(topPos, viewportHeight - actualWidgetHeight - margin));

    position.left = `${leftPos}px`;
    position.top = `${topPos}px`;

    if (actualWidgetWidth !== widgetWidth) {
      position.width = `${actualWidgetWidth}px`;
    }
    if (actualWidgetHeight !== widgetHeight) {
      position.height = `${actualWidgetHeight}px`;
    }

    return position;
  }

  openWidget(phoneNumber = '') {
    if (this.widget) {
      this.closeWidget();
      return;
    }

    try {
      const widgetContainer = document.createElement('div');
      widgetContainer.id = 'softphone-widget-container';
      widgetContainer.className = 'softphone-widget-container';

      const position = this.calculateWidgetPosition();

      Object.keys(position).forEach(key => {
        widgetContainer.style[key] = position[key];
      });

      const iframe = document.createElement('iframe');
      iframe.id = 'softphone-widget';
      iframe.className = 'softphone-frame';
      iframe.src = 'https://login-softphone.vercel.app/';

      iframe.onload = () => {
        if (phoneNumber) {
          iframe.contentWindow.postMessage(
            { type: 'SOFTPHONE_CALL', number: phoneNumber },
            'https://login-softphone.vercel.app'
          );
        }
      };
      iframe.allow = 'microphone';
      iframe.title = 'Softphone Widget';

      const header = document.createElement('div');
      this.makeDraggable(widgetContainer, header);

      widgetContainer.appendChild(header);
      widgetContainer.appendChild(iframe);

      document.body.appendChild(widgetContainer);
      this.widget = widgetContainer;
      this.domCache.set('widget', widgetContainer);

      if (phoneNumber) {
        this.showNotification(`Calling ${phoneNumber}...`, 'success');
      }

    } catch (error) {
      console.error('Error opening softphone widget:', error);
      this.showNotification('Failed to open softphone', 'error');
    }
  }

  // Optimization: Improved dragging with RAF
  makeDraggable(element, handle) {
    let isDragging = false;
    let currentX, currentY, initialX, initialY;
    let rafId;

    const updatePosition = () => {
      if (!isDragging) return;

      const margin = 10;
      const elementRect = element.getBoundingClientRect();

      const minX = margin;
      const maxX = window.innerWidth - elementRect.width - margin;
      const minY = margin;
      const maxY = window.innerHeight - elementRect.height - margin;

      currentX = Math.max(minX, Math.min(currentX, maxX));
      currentY = Math.max(minY, Math.min(currentY, maxY));

      element.style.left = currentX + 'px';
      element.style.top = currentY + 'px';
    };

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

        if (rafId) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(updatePosition);
      }
    });

    document.addEventListener('mouseup', () => {
      isDragging = false;
      element.style.cursor = 'default';
      if (rafId) cancelAnimationFrame(rafId);
    });
  }

  // Optimization: Improved button dragging
  makeButtonDraggable(button) {
    let isDragging = false;
    let offsetX = 0;
    let offsetY = 0;
    let rafId;

    const updateButtonPosition = () => {
      if (!isDragging) return;

      const margin = 10;
      const buttonWidth = button.offsetWidth;
      const buttonHeight = button.offsetHeight;

      const minX = margin;
      const maxX = window.innerWidth - buttonWidth - margin;
      const minY = margin;
      const maxY = window.innerHeight - buttonHeight - margin;

      const x = Math.max(minX, Math.min(button._targetX, maxX));
      const y = Math.max(minY, Math.min(button._targetY, maxY));

      button.style.left = `${x}px`;
      button.style.top = `${y}px`;
    };

    button.addEventListener('mousedown', (e) => {
      isDragging = true;
      offsetX = e.clientX - button.getBoundingClientRect().left;
      offsetY = e.clientY - button.getBoundingClientRect().top;
      button.style.transition = 'none';
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;

      button._targetX = e.clientX - offsetX;
      button._targetY = e.clientY - offsetY;

      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(updateButtonPosition);
    });

    document.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        button.style.transition = 'left 0.2s ease, top 0.2s ease';
        if (rafId) cancelAnimationFrame(rafId);
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

    if (this.callHistory.length > 50) {
      this.callHistory = this.callHistory.slice(0, 50);
    }

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

    setTimeout(() => {
      notification.remove();
    }, 3000);
  }

  toggleExtension() {
    this.isEnabled = !this.isEnabled;

    if (this.isEnabled) {
      this.createFloatingButton();
      this.scheduleHighlighting();
    } else {
      const floatingBtn = this.domCache.get('floatingButton');
      if (floatingBtn) {
        floatingBtn.remove();
        this.domCache.delete('floatingButton');
      }
      this.closeWidget();
      this.removeHighlights();
    }
  }

  removeHighlights() {
    const highlights = document.querySelectorAll('.softphone-highlighted-number');
    highlights.forEach(highlight => {
      highlight.replaceWith(highlight.textContent);
    });
    this.processedElements = new WeakSet();
  }

  updateSettings(newSettings) {
    this.settings = { ...this.settings, ...newSettings };
    this.saveSettings();

    if (newSettings.showFloatingButton !== undefined) {
      const floatingBtn = this.domCache.get('floatingButton');
      if (newSettings.showFloatingButton && !floatingBtn) {
        this.createFloatingButton();
      } else if (!newSettings.showFloatingButton && floatingBtn) {
        floatingBtn.remove();
        this.domCache.delete('floatingButton');
      }
    }

    if (newSettings.highlightNumbers !== undefined) {
      if (newSettings.highlightNumbers) {
        this.scheduleHighlighting();
      } else {
        this.removeHighlights();
      }
    }
  }

  // Optimization: Cleanup method
  destroy() {
    if (this.mutationObserver) {
      this.mutationObserver.disconnect();
    }

    document.removeEventListener('click', this.boundHandleClick, true);
    document.removeEventListener('keydown', this.boundHandleKeyboard);

    this.closeWidget();
    this.removeHighlights();

    const floatingBtn = this.domCache.get('floatingButton');
    if (floatingBtn) {
      floatingBtn.remove();
    }

    this.domCache.clear();
    this.processedElements = new WeakSet();
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