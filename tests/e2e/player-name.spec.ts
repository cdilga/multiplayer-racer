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
