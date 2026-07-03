import { describe, expect, it, vi } from 'vitest';
import { ResultsUI } from '../../static/js/ui/ResultsUI.js';

function makeClassList(initial = []) {
    const classes = new Set(initial);
    return {
        add: (name) => classes.add(name),
        remove: (name) => classes.delete(name),
        contains: (name) => classes.has(name),
        toggle: (name, force) => {
            const shouldAdd = force === undefined ? !classes.has(name) : !!force;
            if (shouldAdd) classes.add(name);
            else classes.delete(name);
            return shouldAdd;
        }
    };
}

function makeHarness(options = {}) {
    const callbacks = [];
    const timerApi = {
        setTimeout: vi.fn((callback) => {
            callbacks.push(callback);
            return callbacks.length;
        }),
        clearTimeout: vi.fn()
    };
    const ui = new ResultsUI({
        container: {},
        timerApi,
        winMomentDurationMs: 850,
        rematchCountdownDurationMs: options.durationMs ?? 3000,
        rematchCountdownTickMs: options.tickMs ?? 1000
    });
    const element = {
        classList: makeClassList(),
        dataset: {}
    };
    ui.element = element;
    ui.elements = {
        winMoment: { classList: makeClassList(['hidden']) },
        winName: { textContent: '' },
        rematch: { classList: makeClassList(['hidden']) },
        rematchCount: { textContent: '' },
        rematchLabel: { textContent: '' },
        rematchCancelBtn: { disabled: false, textContent: 'Cancel' }
    };
    let now = 0;
    ui._nowMs = () => now;
    return {
        ui,
        timerApi,
        callbacks,
        advance(ms) {
            now += ms;
            callbacks.shift()?.();
        }
    };
}

describe('ResultsUI rematch countdown', () => {
    it('starts only after the win moment completes and then auto-starts rematch once', () => {
        const { ui, callbacks, advance } = makeHarness({ durationMs: 2000, tickMs: 1000 });
        const playAgain = vi.fn();
        ui.setOnPlayAgain(playAgain);

        ui._startWinMoment({ mode: 'race', winnerName: 'Ada' });

        expect(ui.getWinMomentDiagnostics()).toMatchObject({ active: true, tableHidden: true });
        expect(ui.getRematchCountdownDiagnostics()).toMatchObject({ active: false, hidden: true });

        callbacks.shift()();

        expect(ui.getWinMomentDiagnostics()).toMatchObject({ active: false, completed: true });
        expect(ui.getRematchCountdownDiagnostics()).toMatchObject({
            active: true,
            canceled: false,
            secondsRemaining: 2,
            hidden: false,
            countText: '2'
        });

        advance(1000);
        expect(ui.getRematchCountdownDiagnostics()).toMatchObject({
            active: true,
            secondsRemaining: 1,
            countText: '1'
        });
        expect(playAgain).not.toHaveBeenCalled();

        advance(1000);
        expect(ui.getRematchCountdownDiagnostics()).toMatchObject({
            active: false,
            completed: true,
            autoStarted: true,
            hidden: true
        });
        expect(playAgain).toHaveBeenCalledTimes(1);
    });

    it('cancel button state prevents the auto-rematch callback', () => {
        const { ui, callbacks, advance } = makeHarness({ durationMs: 2000, tickMs: 1000 });
        const playAgain = vi.fn();
        ui.setOnPlayAgain(playAgain);

        ui._startWinMoment({ mode: 'race', winnerName: 'Ada' });
        callbacks.shift()();
        ui.cancelRematchCountdown();

        expect(ui.getRematchCountdownDiagnostics()).toMatchObject({
            active: false,
            canceled: true,
            completed: false,
            cancelReason: 'cancel-button',
            countText: 'Canceled',
            label: ''
        });

        advance(3000);
        expect(playAgain).not.toHaveBeenCalled();
    });

    it('manual play-again cancels the armed countdown before invoking the callback', () => {
        const { ui, callbacks } = makeHarness();
        const playAgain = vi.fn();
        ui.setOnPlayAgain(playAgain);

        ui._startWinMoment({ mode: 'race', winnerName: 'Ada' });
        callbacks.shift()();

        ui.elements.playAgainBtn = {
            addEventListener(eventName, callback) {
                if (eventName === 'click') callback();
            }
        };
        ui.elements.lobbyBtn = null;
        ui.elements.rematchCancelBtn = null;
        ui._bindElements = ResultsUI.prototype._bindElements;
        ui._cancelRematchCountdown('manual-play-again');
        ui.onPlayAgain();

        expect(ui.getRematchCountdownDiagnostics()).toMatchObject({
            active: false,
            canceled: true,
            cancelReason: 'manual-play-again'
        });
        expect(playAgain).toHaveBeenCalledTimes(1);
    });

    it('hide clears active countdown timers and hides the panel', () => {
        const { ui, callbacks, timerApi } = makeHarness();

        ui._startWinMoment({ mode: 'race', winnerName: 'Ada' });
        callbacks.shift()();
        ui.hide();

        expect(timerApi.clearTimeout).toHaveBeenCalled();
        expect(ui.getRematchCountdownDiagnostics()).toMatchObject({
            active: false,
            hidden: true
        });
    });
});
