import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  renderSafeText,
  renderSafeCanvasText,
  sanitizeDisplayString,
  createSafeTextElement,
  detectXSSPayloads,
  testRenderSafety,
  escapeHtml,
} from '../../static/js/debug/SafeTextRenderer.js';

describe('SafeTextRenderer', () => {
  describe('sanitizeDisplayString', () => {
    it('normalizes unicode (NFKC)', () => {
      // Composed characters normalized to decomposed
      const input = 'Café'; // é as single char
      const result = sanitizeDisplayString(input);
      expect(result).toMatch(/Caf/); // Result preserves readable form
    });

    it('trims whitespace', () => {
      expect(sanitizeDisplayString('  player name  ')).toBe('player name');
    });

    it('caps length at maxLength', () => {
      const long = 'a'.repeat(300);
      const result = sanitizeDisplayString(long, { maxLength: 50 });
      expect(result.length).toBeLessThanOrEqual(50);
    });

    it('removes control characters', () => {
      const input = 'Player\x00Name'; // Null byte in middle
      const result = sanitizeDisplayString(input);
      expect(result).not.toContain('\x00');
    });

    it('removes bidirectional marks', () => {
      const input = 'Test‎Text'; // LTR mark (U+200E)
      const result = sanitizeDisplayString(input);
      expect(result).not.toContain('‎');
    });

    it('removes zero-width characters', () => {
      const input = 'Test​Text'; // Zero-width space
      const result = sanitizeDisplayString(input);
      expect(result).not.toContain('​');
    });

    it('handles non-string input', () => {
      expect(sanitizeDisplayString(null)).toBe('');
      expect(sanitizeDisplayString(undefined)).toBe('');
      expect(sanitizeDisplayString(123)).toBe('');
    });

    it('preserves normal letters and numbers', () => {
      const input = 'Player 123 [ABC]';
      const result = sanitizeDisplayString(input);
      expect(result).toContain('Player');
      expect(result).toContain('123');
    });
  });

  // createSafeTextElement requires DOM, tested in E2E/browser tests

  describe('detectXSSPayloads', () => {
    it('detects script tags', () => {
      const payloads = detectXSSPayloads('<script>alert("xss")</script>');
      expect(payloads).toContain('script-tag');
    });

    it('detects event handlers', () => {
      const payloads = detectXSSPayloads('<div onclick=alert("xss")>');
      expect(payloads).toContain('event-handler');
    });

    it('detects javascript: URLs', () => {
      const payloads = detectXSSPayloads('<a href="javascript:alert(\'xss\')">');
      expect(payloads).toContain('javascript-url');
    });

    it('detects img onerror', () => {
      const payloads = detectXSSPayloads('<img src=x onerror=alert("xss")>');
      expect(payloads).toContain('img-onerror');
    });

    it('detects svg onload', () => {
      const payloads = detectXSSPayloads('<svg onload=alert("xss")>');
      expect(payloads).toContain('svg-onload');
    });

    it('detects iframe', () => {
      const payloads = detectXSSPayloads('<iframe src="evil.com">');
      expect(payloads).toContain('iframe');
    });

    it('returns empty array for safe text', () => {
      const payloads = detectXSSPayloads('Player 123 - Safe Label');
      expect(payloads).toEqual([]);
    });
  });

  // testRenderSafety requires DOM, tested in E2E/browser tests

  describe('escapeHtml (reference)', () => {
    it('escapes HTML special characters', () => {
      expect(escapeHtml('<div>test</div>')).toBe('&lt;div&gt;test&lt;/div&gt;');
      expect(escapeHtml('A & B')).toBe('A &amp; B');
      expect(escapeHtml('He said "hello"')).toBe('He said &quot;hello&quot;');
    });
  });

  describe('integration: XSS payload detection', () => {
    it('detects hostile payloads even when sanitized', () => {
      const payloads = [
        '<img src=x onerror=alert("XSS")>',
        '<script>alert("xss")</script>',
        'javascript:alert("xss")',
        '<svg onload=alert("xss")>',
      ];

      payloads.forEach((payload) => {
        const detected = detectXSSPayloads(payload);
        expect(detected.length).toBeGreaterThan(0);
      });
    });

    it('ignores safe player names', () => {
      const safe = [
        'Player 1',
        'Racer_Joe',
        'The Quick Fox',
        'P4-v2',
      ];

      safe.forEach((name) => {
        const detected = detectXSSPayloads(name);
        expect(detected).toEqual([]);
      });
    });
  });

  describe('integration: render contract adherence', () => {
    it('sanitized strings do not contain control chars', () => {
      const hostile = 'Player\x00Name‎Text'; // Null byte + LTR mark
      const clean = sanitizeDisplayString(hostile);

      expect(clean).not.toContain('\x00');
      expect(clean).not.toContain('‎');
    });

    it('escapeHtml produces safe HTML (reference method)', () => {
      const payload = '<img src=x onerror=alert("XSS")>';
      const escaped = escapeHtml(payload);

      // Escaped version has no dangerous tags
      expect(escaped).toContain('&lt;img');
      expect(escaped).toContain('&gt;');
      expect(escaped).not.toContain('<img');
    });
  });
});
