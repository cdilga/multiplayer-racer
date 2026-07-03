import { test, expect } from './fixtures';
import { gotoHost, waitForRoomCode } from './fixtures';
import { mkdirSync } from 'node:fs';

// Opt-in visual evidence: set TOPOLOGY_EVIDENCE_DIR to capture badge screenshots.
async function maybeCapture(page, fileName: string) {
    const dir = process.env.TOPOLOGY_EVIDENCE_DIR;
    if (!dir) return;
    mkdirSync(dir, { recursive: true });
    await page.locator('#room-code-section, .room-code-section').first().screenshot({
        path: `${dir}/${fileName}`,
    }).catch(async () => { await page.screenshot({ path: `${dir}/${fileName}`, fullPage: true }); });
}

// Surfacing of the room topology (chosen at room creation) in the host lobby.
// Local is the default and the only topology selectable today; the badge must
// still render it, and must update correctly for remote/mixed so the UI is
// ready for the Create-Room chooser (br-76ia / Remote Play).
test.describe('Lobby topology badge', () => {
    test('host lobby shows the Local topology badge by default', async ({ hostPage }) => {
        await gotoHost(hostPage);
        await waitForRoomCode(hostPage);

        const badge = hostPage.locator('#topology-badge');
        await expect(badge).toBeVisible();
        await expect(badge).toHaveAttribute('data-topology', 'local');
        await expect(badge).toContainText(/Local/i);
        await maybeCapture(hostPage, 'topology-badge-local.png');
    });

    test('badge reflects topology updates for remote and mixed', async ({ hostPage }) => {
        await gotoHost(hostPage);
        await waitForRoomCode(hostPage);

        const badge = hostPage.locator('#topology-badge');

        // Drive the lobby's public setTopology() the way a Create-Room chooser
        // / server-confirmed remote room eventually will.
        await hostPage.evaluate(() => window.game?.ui?.lobby?.setTopology('remote'));
        await expect(badge).toHaveAttribute('data-topology', 'remote');
        await expect(badge).toContainText(/Remote/i);
        await maybeCapture(hostPage, 'topology-badge-remote.png');

        await hostPage.evaluate(() => window.game?.ui?.lobby?.setTopology('mixed'));
        await expect(badge).toHaveAttribute('data-topology', 'mixed');
        await expect(badge).toContainText(/Mixed/i);
        await maybeCapture(hostPage, 'topology-badge-mixed.png');

        // Unknown values coerce back to the Local default (never break the lobby).
        await hostPage.evaluate(() => window.game?.ui?.lobby?.setTopology('garbage'));
        await expect(badge).toHaveAttribute('data-topology', 'local');
        await expect(badge).toContainText(/Local/i);
    });
});
