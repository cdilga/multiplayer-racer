import { test, expect, waitForRoomCode, gotoHost } from './fixtures';

/**
 * br-copy-room-code-flol — click / Cmd+C to copy the join link + visible feedback.
 * Behavioral: clicking the QR or code text copies the join URL; Cmd/Ctrl+C copies
 * it; a 'Copied!' feedback appears then hides.
 */
test.describe('room code copy-to-clipboard (flol)', () => {
    test('clicking QR + text and Cmd+C copy the join link, with visible feedback', async ({ hostPage }) => {
        await hostPage.context().grantPermissions(['clipboard-read', 'clipboard-write']);
        await gotoHost(hostPage);
        const roomCode = await waitForRoomCode(hostPage);

        // Make the persistent overlay present with the room code.
        await hostPage.evaluate((code) => {
            // @ts-ignore
            const overlay = window.game.ui.roomCodeOverlay;
            overlay.setRoomCode(code);
            overlay.element.classList.remove('hidden');
        }, roomCode);

        const readClip = () => hostPage.evaluate(() => navigator.clipboard.readText());
        const feedbackShown = () => hostPage.evaluate(() =>
            // @ts-ignore
            window.game.ui.roomCodeOverlay.element.classList.contains('show-copied'));
        const expectedLink = await hostPage.evaluate(() =>
            // @ts-ignore
            window.game.ui.roomCodeOverlay.joinLink());
        expect(expectedLink).toContain(`/join/${roomCode}`);

        // 1) Click the code TEXT -> copies join link + shows feedback.
        await hostPage.evaluate(() => {
            navigator.clipboard.writeText('');
            // @ts-ignore
            window.game.ui.roomCodeOverlay.codeText.click();
        });
        await expect.poll(readClip).toBe(expectedLink);
        expect(await feedbackShown()).toBe(true);

        // Feedback clears after a couple seconds.
        await hostPage.waitForTimeout(2200);
        expect(await feedbackShown()).toBe(false);

        // 2) Click the QR IMAGE -> also copies the join link.
        await hostPage.evaluate(() => {
            navigator.clipboard.writeText('');
            // @ts-ignore
            window.game.ui.roomCodeOverlay.qrImage.click();
        });
        await expect.poll(readClip).toBe(expectedLink);

        // 3) Cmd/Ctrl+C (no selection) copies the join link.
        await hostPage.evaluate(() => navigator.clipboard.writeText(''));
        await hostPage.evaluate(() => {
            const isMac = navigator.platform.toUpperCase().includes('MAC');
            document.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'c', ctrlKey: !isMac, metaKey: isMac, bubbles: true, cancelable: true
            }));
        });
        await expect.poll(readClip).toBe(expectedLink);
    });

    test('lobby room-code + QR are click-to-copy with feedback', async ({ hostPage }) => {
        await hostPage.context().grantPermissions(['clipboard-read', 'clipboard-write']);
        await gotoHost(hostPage);
        const roomCode = await waitForRoomCode(hostPage);

        const lobbyLink = await hostPage.evaluate(() =>
            // @ts-ignore
            window.game.ui.lobby.joinLink());
        expect(lobbyLink).toContain(`/join/${roomCode}`);

        await hostPage.evaluate(() => navigator.clipboard.writeText(''));
        await hostPage.click('#room-code-display');
        await expect.poll(() => hostPage.evaluate(() => navigator.clipboard.readText())).toBe(lobbyLink);
        // 'Copied!' feedback appears in the hint.
        await expect(hostPage.locator('#join-url')).toContainText('Copied');
        // ...and clears after a couple seconds.
        await hostPage.waitForTimeout(2200);
        await expect(hostPage.locator('#join-url')).not.toContainText('Copied');
    });
});
