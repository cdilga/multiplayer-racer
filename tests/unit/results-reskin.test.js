import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('static/js/ui/ResultsUI.js', 'utf8');

describe('ResultsUI reskin style contract', () => {
    it('keeps Skip Bin Arcade sticker and CRT chrome in the ResultsUI-owned styles', () => {
        expect(source).toContain('results-chrome-label');
        expect(source).toContain('Skip Bin Arcade Results');
        expect(source).toContain('repeating-linear-gradient');
        expect(source).toContain('--results-crt-line');
        expect(source).toContain('--results-sticker-ink');
        expect(source).toContain('border: 4px solid var(--results-sticker-ink)');
        expect(source).toContain('box-shadow:');
    });

    it('preserves win moment and rematch countdown contracts while reskinning', () => {
        expect(source).toContain('win-moment-active');
        expect(source).toContain('this._startRematchCountdown();');
        expect(source).toContain('this.elements.rematchLabel.textContent = this.rematchCountdown.canceled');
        expect(source).toContain("? ''");
        expect(source).toContain("kicker.textContent = this.rematchCountdown.canceled ? 'Rematch canceled' : 'Rematch armed'");
        expect(source).toContain("this.elements.rematchCancelBtn.textContent = this.rematchCountdown.canceled ? 'Canceled' : 'Cancel'");
    });

    it('stays host-only without controller renderer imports or per-frame hooks', () => {
        expect(source).not.toMatch(/frontend\/player|static\/js\/player|world-renderer|GameHost|RenderSystem/);
        expect(source).not.toMatch(/requestAnimationFrame|setInterval|console\./);
    });

    it('keeps the results modal bounded and readable at desktop viewport', () => {
        expect(source).toContain('max-width: 640px');
        expect(source).toContain('max-height: 90vh');
        expect(source).toContain('overflow-y: auto');
        expect(source).toContain('max-width: 520px');
    });
});
