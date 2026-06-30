/**
 * BugReportUI - Modal that helps the host file a useful bug report.
 *
 * It captures a screenshot + a snapshot of the current game state, gives the
 * reporter a structured template to fill in, then downloads the screenshot and
 * opens a pre-filled email so the report lands in the maintainer's inbox.
 *
 * The captured state includes correlation IDs (room code, socket id, timestamp)
 * so reports can be matched against server logs after the fact.
 *
 * Usage:
 *   const bugReport = new BugReportUI({
 *       container,
 *       getDebugInfo: () => game.collectDebugInfo(),
 *       captureScreenshot: () => game.captureScreenshot()
 *   });
 *   bugReport.init();
 *   bugReport.open();
 */

import { BUILD_INFO, getSkewState } from '../buildInfo.js';

const REPORT_EMAIL = 'bugs@jammers.dilger.dev';

// The template guides the reporter toward the details that actually help.
const REPORT_TEMPLATE =
`What went wrong? (be specific — what did you see?)


What did you expect to happen instead?


What were you doing right before it happened? (steps to reproduce)
1.
2.
3.

How many players, and on what devices/browsers? (e.g. 3 players, iPhone 13 Safari + Pixel 7 Chrome)


Anything else that might help?
`;

/**
 * Build the filename stem / subject slug for a report from its debug snapshot.
 * Pure function (no DOM) so it can be unit tested.
 * @param {Object} debugInfo
 * @returns {string}
 */
function buildReportSlug(debugInfo = {}) {
    const room = debugInfo.roomCode || 'no-room';
    const ts = (debugInfo.timestamp || '').replace(/[:.]/g, '-') || 'unknown-time';
    return `bug-${room}-${ts}`;
}

/**
 * Build a concise, mailto-safe summary of the debug snapshot. Keeps the
 * high-signal fields that let a report be correlated with server logs.
 * Pure function (no DOM).
 * @param {Object} debugInfo
 * @returns {string}
 */
function buildSummaryText(debugInfo = {}) {
    const players = Array.isArray(debugInfo.players) ? debugInfo.players.length : 0;
    // Build identity + stale flag let a report be matched to the exact deploy
    // and reveal "this was a stale client" bugs that look like gameplay faults.
    const skew = getSkewState();
    return [
        `Time: ${debugInfo.timestamp || '-'}`,
        `Room: ${debugInfo.roomCode || '-'}`,
        `Socket: ${debugInfo.socketId || '-'}`,
        `Mode: ${debugInfo.settings?.mode || '-'}`,
        `State: ${debugInfo.gameState || '-'}`,
        `FPS: ${debugInfo.fps != null ? debugInfo.fps : '-'}`,
        `Players: ${players}`,
        `Build: ${BUILD_INFO.buildId} (${BUILD_INFO.buildSha.slice(0, 12)}) @ ${BUILD_INFO.buildTime}`,
        `Stale client: ${skew.stale ? `YES - behind server ${skew.serverBuildId || '?'}` : 'no'}`,
        `URL: ${debugInfo.url || '-'}`,
        `Browser: ${debugInfo.userAgent || '-'}`
    ].join('\n');
}

/**
 * Structured build/stale fields for a report payload. Pure (reads frozen build
 * identity + latest skew state). Lets machine consumers correlate a report to a
 * deploy and know whether the client was stale at submit time.
 * @returns {{buildId: string, buildSha: string, buildTime: string, wasStale: boolean, serverBuildId: (string|null)}}
 */
function buildReportBuildInfo() {
    const skew = getSkewState();
    return {
        buildId: BUILD_INFO.buildId,
        buildSha: BUILD_INFO.buildSha,
        buildTime: BUILD_INFO.buildTime,
        wasStale: skew.stale === true,
        serverBuildId: skew.serverBuildId
    };
}

/**
 * Build a mailto: URL for a report. Pure function (no DOM).
 * @param {Object} opts
 * @param {string} opts.email
 * @param {Object} opts.debugInfo
 * @param {string} opts.description - the reporter's written description
 * @param {string|null} [opts.screenshotFilename]
 * @returns {string}
 */
function buildMailto({ email, debugInfo = {}, description = '', screenshotFilename = null }) {
    const subject = `Bug report: ${debugInfo.roomCode || 'multiplayer-racer'} @ ${debugInfo.timestamp || ''}`;
    const body =
`${description}

----------------------------------------
Please attach the screenshot that just downloaded${screenshotFilename ? ` (${screenshotFilename})` : ''}.
----------------------------------------

Debug info (auto-captured — please leave this in):
${buildSummaryText(debugInfo)}
`;
    return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

class BugReportUI {
    /**
     * @param {Object} options
     * @param {HTMLElement} [options.container]
     * @param {() => Object} options.getDebugInfo - returns a debug snapshot object
     * @param {() => (string|null)} [options.captureScreenshot] - returns image data URL
     * @param {string} [options.reportEmail]
     */
    constructor(options = {}) {
        this.container = options.container || document.body;
        this.getDebugInfo = options.getDebugInfo || (() => ({}));
        this.captureScreenshot = options.captureScreenshot || (() => null);
        this.reportEmail = options.reportEmail || REPORT_EMAIL;

        this.elements = {};
        this.screenshotDataUrl = null;
        this.debugInfo = null;
        this.initialized = false;
    }

    init() {
        if (this.initialized) return;
        this._injectStyles();
        this._createElements();
        this.initialized = true;
    }

    /**
     * Capture current state + screenshot, then show the modal.
     */
    open() {
        if (!this.initialized) this.init();

        // Snapshot state first so the screenshot matches the reported moment.
        try {
            this.debugInfo = this.getDebugInfo() || {};
        } catch (e) {
            this.debugInfo = { collectError: String(e) };
        }
        // Always attach build identity + stale flag so every report (even one
        // whose game snapshot failed) carries the deploy correlation fields.
        this.debugInfo.build = buildReportBuildInfo();

        try {
            this.screenshotDataUrl = this.captureScreenshot();
        } catch (e) {
            this.screenshotDataUrl = null;
        }

        this.elements.textarea.value = REPORT_TEMPLATE;
        this.elements.debugPre.textContent = JSON.stringify(this.debugInfo, null, 2);

        if (this.screenshotDataUrl) {
            this.elements.preview.src = this.screenshotDataUrl;
            this.elements.previewWrap.classList.remove('hidden');
            this.elements.screenshotNote.textContent =
                'A screenshot was captured and will download when you submit — please attach it to the email.';
        } else {
            this.elements.previewWrap.classList.add('hidden');
            this.elements.screenshotNote.textContent =
                'Screenshot could not be captured (the game canvas may not be ready).';
        }

        this.elements.status.textContent = '';
        this.elements.modal.classList.remove('hidden');
        this.elements.textarea.focus();
    }

    close() {
        this.elements.modal?.classList.add('hidden');
    }

    /**
     * Download the captured screenshot to the reporter's device.
     * @private
     */
    _downloadScreenshot() {
        if (!this.screenshotDataUrl) return null;
        const filename = `${buildReportSlug(this.debugInfo)}.jpg`;
        const link = document.createElement('a');
        link.href = this.screenshotDataUrl;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        return filename;
    }

    /**
     * Submit: download screenshot + open the email client.
     * @private
     */
    _submit() {
        const screenshotFilename = this._downloadScreenshot();
        const mailto = buildMailto({
            email: this.reportEmail,
            debugInfo: this.debugInfo,
            description: this.elements.textarea.value,
            screenshotFilename
        });
        window.location.href = mailto;
        this.elements.status.textContent = screenshotFilename
            ? 'Opening your email app… your screenshot downloaded — attach it before sending.'
            : 'Opening your email app…';
    }

    /**
     * Copy the full report (description + debug snapshot) to the clipboard,
     * a fallback for when the mail client misbehaves.
     * @private
     */
    async _copyReport() {
        const text =
`${this.elements.textarea.value}

Debug info:
${JSON.stringify(this.debugInfo, null, 2)}`;
        try {
            await navigator.clipboard.writeText(text);
            this.elements.status.textContent = 'Report copied to clipboard.';
        } catch (e) {
            this.elements.status.textContent = 'Could not copy — please select the debug text manually.';
        }
    }

    /**
     * @private
     */
    _createElements() {
        const modal = document.createElement('div');
        modal.id = 'bug-report-modal';
        modal.classList.add('hidden');
        modal.innerHTML = `
            <div class="bug-report-content">
                <div class="bug-report-title">🐞 Report a Bug</div>
                <div class="bug-report-intro">
                    Thanks for helping make this better! The more detail you add, the
                    faster it gets fixed. We've grabbed a screenshot and a snapshot of
                    the current game state automatically.
                </div>
                <textarea class="bug-report-textarea" spellcheck="true"></textarea>
                <div class="bug-report-note bug-report-screenshot-note"></div>
                <div class="bug-report-preview-wrap hidden">
                    <img class="bug-report-preview" alt="captured screenshot" />
                </div>
                <details class="bug-report-debug">
                    <summary>Debug info that will be sent</summary>
                    <pre class="bug-report-debug-pre"></pre>
                </details>
                <div class="bug-report-status"></div>
                <div class="bug-report-actions">
                    <button class="bug-report-btn bug-report-submit" data-action="submit">📧 Download screenshot &amp; open email</button>
                    <button class="bug-report-btn bug-report-copy" data-action="copy">📋 Copy report</button>
                    <button class="bug-report-btn bug-report-cancel" data-action="cancel">Cancel</button>
                </div>
            </div>
        `;

        modal.addEventListener('click', (e) => {
            // Click on the dimmed backdrop closes the modal.
            if (e.target === modal) {
                this.close();
                return;
            }
            const action = e.target?.dataset?.action;
            if (action === 'submit') this._submit();
            else if (action === 'copy') this._copyReport();
            else if (action === 'cancel') this.close();
        });

        this.container.appendChild(modal);

        this.elements = {
            modal,
            textarea: modal.querySelector('.bug-report-textarea'),
            debugPre: modal.querySelector('.bug-report-debug-pre'),
            preview: modal.querySelector('.bug-report-preview'),
            previewWrap: modal.querySelector('.bug-report-preview-wrap'),
            screenshotNote: modal.querySelector('.bug-report-screenshot-note'),
            status: modal.querySelector('.bug-report-status')
        };
    }

    /**
     * @private
     */
    _injectStyles() {
        if (document.getElementById('bug-report-ui-styles')) return;

        const style = document.createElement('style');
        style.id = 'bug-report-ui-styles';
        style.textContent = `
            #bug-report-modal {
                position: fixed;
                inset: 0;
                z-index: 2100;
                background: rgba(0, 0, 0, 0.75);
                display: flex;
                align-items: center;
                justify-content: center;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            }
            #bug-report-modal.hidden {
                display: none;
            }
            .bug-report-content {
                background: #16213e;
                border: 1px solid rgba(255, 255, 255, 0.2);
                border-radius: 10px;
                padding: 20px;
                width: 90%;
                max-width: 560px;
                max-height: 90vh;
                overflow-y: auto;
                color: white;
                display: flex;
                flex-direction: column;
                gap: 12px;
            }
            .bug-report-title {
                font-size: 1.3rem;
                font-weight: bold;
                color: #00ff88;
                text-align: center;
            }
            .bug-report-intro {
                font-size: 0.9rem;
                color: #c7d0e0;
                line-height: 1.4;
            }
            .bug-report-textarea {
                width: 100%;
                min-height: 200px;
                box-sizing: border-box;
                background: #0d1429;
                color: white;
                border: 1px solid rgba(255, 255, 255, 0.2);
                border-radius: 6px;
                padding: 10px;
                font-family: inherit;
                font-size: 0.9rem;
                line-height: 1.4;
                resize: vertical;
            }
            .bug-report-note {
                font-size: 0.8rem;
                color: #8d99ae;
            }
            .bug-report-preview-wrap {
                text-align: center;
            }
            .bug-report-preview-wrap.hidden {
                display: none;
            }
            .bug-report-preview {
                max-width: 100%;
                max-height: 180px;
                border-radius: 6px;
                border: 1px solid rgba(255, 255, 255, 0.2);
            }
            .bug-report-debug {
                font-size: 0.8rem;
                color: #8d99ae;
            }
            .bug-report-debug summary {
                cursor: pointer;
                user-select: none;
            }
            .bug-report-debug-pre {
                max-height: 160px;
                overflow: auto;
                background: #0d1429;
                border-radius: 6px;
                padding: 8px;
                margin-top: 6px;
                font-size: 0.72rem;
                white-space: pre-wrap;
                word-break: break-word;
            }
            .bug-report-status {
                font-size: 0.82rem;
                color: #4cc9f0;
                min-height: 1em;
            }
            .bug-report-actions {
                display: flex;
                flex-wrap: wrap;
                gap: 8px;
            }
            .bug-report-btn {
                flex: 1 1 auto;
                background: #16213e;
                color: white;
                border: 1px solid rgba(255, 255, 255, 0.2);
                border-radius: 6px;
                padding: 10px;
                font-size: 0.9rem;
                cursor: pointer;
            }
            .bug-report-btn:hover {
                background: #1f2b52;
            }
            .bug-report-submit {
                background: #4361ee;
                border-color: #4361ee;
                flex-basis: 100%;
            }
            .bug-report-submit:hover {
                background: #3a0ca3;
            }
            .bug-report-cancel {
                background: #333;
            }
        `;
        document.head.appendChild(style);
    }

    destroy() {
        this.elements.modal?.remove();
        this.elements = {};
        this.initialized = false;
    }
}

// Export for ES Modules
export { BugReportUI, REPORT_EMAIL, REPORT_TEMPLATE, buildReportSlug, buildSummaryText, buildMailto, buildReportBuildInfo };

// Export for non-module scripts
if (typeof window !== 'undefined') {
    window.BugReportUI = BugReportUI;
}
