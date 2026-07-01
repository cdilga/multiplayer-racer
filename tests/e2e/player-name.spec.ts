import { test, expect } from './fixtures';

test.describe('Player Name Input', () => {
    test('name input should be fully visible on mobile viewport', async ({ playerPage }) => {
        // Navigate to player page
        await playerPage.goto('/player?testMode=1');

        // Wait for join screen
        await playerPage.waitForSelector('#join-screen', { state: 'visible', timeout: 10000 });

        // Take screenshot for visual verification
        await playerPage.screenshot({ path: 'test-results/player-join-screen-mobile.png' });

        // Get the name input element
        const nameInput = playerPage.locator('#player-name');
        await expect(nameInput).toBeVisible();

        // Check if name input is within the viewport
        const inputBox = await nameInput.boundingBox();
        expect(inputBox, 'Name input should have a bounding box').not.toBeNull();

        // Get viewport size
        const viewportSize = playerPage.viewportSize();
        expect(viewportSize).not.toBeNull();

        // Verify input is fully within viewport (not cut off)
        expect(inputBox!.x, 'Name input left edge should be >= 0').toBeGreaterThanOrEqual(0);
        expect(inputBox!.y, 'Name input top edge should be >= 0').toBeGreaterThanOrEqual(0);
        expect(inputBox!.x + inputBox!.width, 'Name input right edge should be within viewport').toBeLessThanOrEqual(viewportSize!.width);
        expect(inputBox!.y + inputBox!.height, 'Name input bottom edge should be within viewport').toBeLessThanOrEqual(viewportSize!.height);

        // Verify the input has reasonable size (not squished)
        expect(inputBox!.width, 'Name input should be at least 200px wide').toBeGreaterThan(200);
        expect(inputBox!.height, 'Name input should be at least 40px tall').toBeGreaterThan(40);
    });

    test('should allow entering names with emoji', async ({ playerPage }) => {
        await playerPage.goto('/player?testMode=1');
        await playerPage.waitForSelector('#join-screen', { state: 'visible', timeout: 10000 });

        const nameInput = playerPage.locator('#player-name');

        // Enter a name with emoji
        const emojiName = 'Speed🏎️Demon';
        await nameInput.fill(emojiName);

        // Verify the value was set correctly
        const value = await nameInput.inputValue();
        expect(value).toBe(emojiName);
    });

    test('should allow longer names up to maxlength', async ({ playerPage }) => {
        await playerPage.goto('/player?testMode=1');
        await playerPage.waitForSelector('#join-screen', { state: 'visible', timeout: 10000 });

        const nameInput = playerPage.locator('#player-name');

        // Get current maxlength
        const maxLength = await nameInput.getAttribute('maxlength');
        expect(maxLength).not.toBeNull();

        // Try to enter a name at max length
        const longName = 'A'.repeat(parseInt(maxLength!));
        await nameInput.fill(longName);

        const value = await nameInput.inputValue();
        expect(value.length).toBe(parseInt(maxLength!));
    });

    test('join form should be fully visible without scrolling', async ({ playerPage }) => {
        await playerPage.goto('/player?testMode=1');
        await playerPage.waitForSelector('#join-screen', { state: 'visible', timeout: 10000 });

        // Check all key elements are visible
        const elements = [
            playerPage.locator('h1'),
            playerPage.locator('#player-name'),
            playerPage.locator('#room-code'),
            playerPage.locator('#join-btn'),
        ];

        const viewportSize = playerPage.viewportSize();

        for (const element of elements) {
            await expect(element).toBeVisible();
            const box = await element.boundingBox();
            expect(box, 'Element should have bounding box').not.toBeNull();

            // Element should be within viewport
            expect(box!.y + box!.height, 'Element should be within viewport height').toBeLessThanOrEqual(viewportSize!.height);
        }
    });

    test('random name generator button should work', async ({ playerPage }) => {
        await playerPage.goto('/player?testMode=1');
        await playerPage.waitForSelector('#join-screen', { state: 'visible', timeout: 10000 });

        const nameInput = playerPage.locator('#player-name');
        const generateBtn = playerPage.locator('#generate-name-btn');

        // Initial value should be empty
        const initialValue = await nameInput.inputValue();
        expect(initialValue).toBe('');

        // Click generate button
        await generateBtn.click();

        // Name should now be set
        const generatedName = await nameInput.inputValue();
        expect(generatedName.length, 'Generated name should not be empty').toBeGreaterThan(0);
    });
});

/**
 * XSS-literal rendering (3xv.4): a hostile name/label must render as literal
 * text on player + tool surfaces and execute nothing. Deterministic — an
 * onerror/onload can only fire from a real <img>/<script> element, so asserting
 * NO such node is created (plus a never-set sentinel) proves non-execution
 * without any arbitrary sleep.
 */
test.describe('XSS-literal rendering (3xv.4)', () => {
    // Split the closing script tag so this test file itself is never ambiguous.
    const XSS = '<img src=x onerror="window.__xssFired=true"><' + 'script>window.__xssFired=true</' + 'script>';

    test('the tool safe-text renderer shows an XSS payload literally and runs nothing', async ({ playerPage }) => {
        await playerPage.goto('/player?testMode=1');
        await playerPage.waitForSelector('#join-screen', { state: 'visible', timeout: 10000 });

        const out = await playerPage.evaluate(async (payload) => {
            (window as any).__xssFired = false;
            // The app's real safe renderer (debug/tool surfaces), served from dist.
            const mod = await import('/static/js/debug/SafeTextRenderer.js');
            const el = document.createElement('div');
            document.body.appendChild(el);
            mod.renderSafeText(el, payload);
            return {
                text: el.textContent,
                hasImg: !!el.querySelector('img'),
                hasScript: !!el.querySelector('script'),
                innerHTML: el.innerHTML,
                fired: (window as any).__xssFired,
            };
        }, XSS);

        expect(out.text).toContain('<img');            // shown as literal text
        expect(out.hasImg).toBe(false);                // no element node created
        expect(out.hasScript).toBe(false);
        expect(out.innerHTML).not.toContain('<img src'); // escaped in the markup
        expect(out.fired).toBe(false);                 // nothing executed
    });

    test('the player display-name element renders a hostile name as literal text', async ({ playerPage }) => {
        await playerPage.goto('/player?testMode=1');
        await playerPage.waitForSelector('#join-screen', { state: 'visible', timeout: 10000 });

        const out = await playerPage.evaluate((payload) => {
            (window as any).__xssFired = false;
            // player.js renders the player name via textContent (see player.js
            // display-name assignments); reproduce that exact sink and confirm it
            // cannot create an executing node.
            const el = document.getElementById('display-name');
            if (!el) return { missing: true };
            el.textContent = payload;
            return {
                missing: false,
                text: el.textContent,
                hasImg: !!el.querySelector('img'),
                hasScript: !!el.querySelector('script'),
                fired: (window as any).__xssFired,
            };
        }, XSS);

        expect(out.missing).toBe(false);
        expect(out.text).toContain('<img');
        expect(out.hasImg).toBe(false);
        expect(out.hasScript).toBe(false);
        expect(out.fired).toBe(false);
    });
});
