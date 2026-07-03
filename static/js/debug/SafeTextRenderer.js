/**
 * SafeTextRenderer
 * Renders player names, model labels, errors, and debug text without XSS risk.
 * All debug labs must use this for user-provided or model-provided strings.
 */

/**
 * Render text safely to a DOM element.
 * @param {HTMLElement} element - Target element
 * @param {string} text - Text to render (plain text, not HTML)
 * @returns {HTMLElement} - The updated element
 */
export function renderSafeText(element, text) {
  element.textContent = text || '';
  return element;
}

/**
 * Render text safely to a canvas 2D context.
 * @param {CanvasRenderingContext2D} ctx - Canvas 2D context
 * @param {string} text - Text to render
 * @param {number} x - X position
 * @param {number} y - Y position
 * @param {object} options - {font, fillStyle, textAlign, textBaseline, ...}
 */
export function renderSafeCanvasText(ctx, text, x, y, options = {}) {
  const {
    font = '16px sans-serif',
    fillStyle = '#ffffff',
    textAlign = 'left',
    textBaseline = 'top',
    maxWidth = undefined,
  } = options;

  ctx.font = font;
  ctx.fillStyle = fillStyle;
  ctx.textAlign = textAlign;
  ctx.textBaseline = textBaseline;

  // Canvas.fillText is inherently safe (no HTML parsing)
  if (maxWidth !== undefined) {
    ctx.fillText(text, x, y, maxWidth);
  } else {
    ctx.fillText(text, x, y);
  }
}

/**
 * Sanitize a string for safe display.
 * Trims whitespace, normalizes unicode, rejects control characters and bidirectional marks.
 * @param {string} input - Raw string
 * @param {object} options - {maxLength, allowedCharClasses}
 * @returns {string} - Sanitized string
 */
export function sanitizeDisplayString(input, options = {}) {
  const {
    maxLength = 256,
    allowedCharClasses = ['letter', 'number', 'space', 'punctuation'],
  } = options;

  if (typeof input !== 'string') {
    return '';
  }

  // Normalize unicode (NFKC removes most control chars and weird layouts)
  let sanitized = input.normalize('NFKC');

  // Remove leading/trailing whitespace
  sanitized = sanitized.trim();

  // Cap length
  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength);
  }

  // Reject control characters, bidirectional marks, etc.
  // Keep only printable ASCII and common unicode letters/numbers/punctuation
  const filtered = Array.from(sanitized)
    .filter((char) => {
      const code = char.charCodeAt(0);
      // Allow printable ASCII (32-126) and common unicode letters/numbers
      if ((code >= 32 && code <= 126) || /\p{L}|\p{N}|\p{P}/u.test(char)) {
        return !isControlCharacter(char);
      }
      return false;
    })
    .join('');

  return filtered || '';
}

/**
 * Check if a character is a control character (bidi override, zero-width, etc).
 * @param {string} char - Single character
 * @returns {boolean}
 */
function isControlCharacter(char) {
  const code = char.charCodeAt(0);
  // Control chars, null, delete
  if (code < 32 || code === 127) {
    return true;
  }
  // Bidirectional marks (U+200E, U+200F, U+202A-E, etc)
  if (code >= 0x200e && code <= 0x202e) {
    return true;
  }
  // Zero-width chars
  if (code === 0x200b || code === 0x200c || code === 0x200d) {
    return true;
  }
  return false;
}

/**
 * Create a safe text element for DOM insertion.
 * @param {string} text - Plain text
 * @param {string} tagName - HTML tag ('span', 'div', 'p', etc)
 * @param {object} attributes - Element attributes (id, class, style, data-*)
 * @returns {HTMLElement}
 */
export function createSafeTextElement(text, tagName = 'span', attributes = {}) {
  // Support both browser and jsdom/test environments
  const docRef = typeof document !== 'undefined' ? document : globalThis.document;
  if (!docRef) {
    throw new Error('createSafeTextElement requires a DOM environment');
  }

  const element = docRef.createElement(tagName);

  // Set attributes safely (avoid innerHTML)
  for (const [key, value] of Object.entries(attributes)) {
    if (key === 'class') {
      element.className = value;
    } else if (key === 'style') {
      // Apply inline styles via cssText (still safe, not HTML)
      element.style.cssText = value;
    } else if (key.startsWith('data-')) {
      element.setAttribute(key, String(value));
    } else {
      element.setAttribute(key, String(value));
    }
  }

  // Set text content
  element.textContent = text;

  return element;
}

/**
 * Escape HTML special characters (for reference only; prefer textContent instead).
 * @param {string} text
 * @returns {string}
 * @deprecated Use textContent or renderSafeText instead
 */
export function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return String(text).replace(/[&<>"']/g, (c) => map[c]);
}

/**
 * Test helper: verify that a string contains no XSS payloads.
 * Returns an array of detected patterns (empty if safe).
 * @param {string} input
 * @returns {string[]} - Detected patterns
 */
export function detectXSSPayloads(input) {
  const detected = [];

  const patterns = [
    { name: 'script-tag', re: /<script[\s\S]*?<\/script>/gi },
    { name: 'event-handler', re: /\s(on\w+)\s*=/gi },
    { name: 'javascript-url', re: /javascript:/gi },
    { name: 'img-onerror', re: /<img[^>]+onerror/gi },
    { name: 'svg-onload', re: /<svg[^>]+onload/gi },
    { name: 'iframe', re: /<iframe/gi },
    { name: 'object', re: /<object/gi },
    { name: 'embed', re: /<embed/gi },
  ];

  for (const pattern of patterns) {
    if (pattern.re.test(input)) {
      detected.push(pattern.name);
    }
  }

  return detected;
}

/**
 * Test helper: render a hostile string and verify DOM safety.
 * @param {string} hostileString - User input that might contain XSS
 * @returns {{rendered: string, element: HTMLElement, safe: boolean}}
 */
export function testRenderSafety(hostileString) {
  const element = createSafeTextElement(hostileString, 'div', { id: 'test' });
  document.body.appendChild(element);

  const rendered = element.textContent;
  const safe = rendered === hostileString; // textContent is always literal

  document.body.removeChild(element);

  return {
    rendered,
    element,
    safe,
  };
}

export default {
  renderSafeText,
  renderSafeCanvasText,
  sanitizeDisplayString,
  createSafeTextElement,
  escapeHtml,
  detectXSSPayloads,
  testRenderSafety,
};
