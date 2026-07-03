import { describe, expect, it, vi } from 'vitest';
import { ResultsUI } from '../../static/js/ui/ResultsUI.js';

function makeClassList(initial = []) {
    const classes = new Set(initial);
    return {
        add: (name) => classes.add(name),
        remove: (name) => classes.delete(name),
        contains: (name) => classes.has(name),
        classes
    };
}

function makeWinMomentHarness(options = {}) {
    const timerApi = {
        setTimeout: vi.fn((callback) => {
            timerApi.callback = callback;
            return 42;
        }),
        clearTimeout: vi.fn()
    };
    const ui = new ResultsUI({
        container: {},
        timerApi,
        winMomentDurationMs: options.winMomentDurationMs ?? 850
    });
    const element = {
        classList: makeClassList(),
        dataset: {}
    };
    const winMomentEl = {
        classList: makeClassList(['hidden'])
    };
    const winNameEl = {
        textContent: '',
        children: []
    };
    ui.element = element;
    ui.elements = {
        winMoment: winMomentEl,
        winName: winNameEl
    };
    return { ui, timerApi, element, winMomentEl, winNameEl };
}

describe('ResultsUI win moment', () => {
    it('starts a sub-one-second pre-table race winner beat and completes it', () => {
        const { ui, timerApi, winNameEl } = makeWinMomentHarness();
        const winnerName = ui._extractRaceWinnerName([
            { position: 2, playerId: 'Second' },
            { position: 1, playerId: 'Ada' }
        ]);

        ui._startWinMoment({ mode: 'race', winnerName });

        expect(ui.getWinMomentDiagnostics()).toMatchObject({
            visible: false,
            active: true,
            completed: false,
            mode: 'race',
            winnerName: 'Ada',
            durationMs: 850,
            tableHidden: true,
            winMomentHidden: false
        });
        expect(ui.getWinMomentDiagnostics().durationMs).toBeLessThan(1000);
        expect(winNameEl.textContent).toBe('Ada');
        expect(timerApi.setTimeout).toHaveBeenCalledWith(expect.any(Function), 850);

        timerApi.callback();

        expect(ui.getWinMomentDiagnostics()).toMatchObject({
            active: false,
            completed: true,
            tableHidden: false,
            winMomentHidden: true
        });
    });

    it('uses derby winnerId when standings order differs', () => {
        const { ui, winNameEl } = makeWinMomentHarness();
        const winnerName = ui._extractDerbyWinnerName({
            winnerId: 'Grace',
            standings: [
                { position: 1, playerId: 'Linus', roundWins: 1, totalPoints: 4 },
                { position: 2, playerId: 'Grace', roundWins: 2, totalPoints: 8 }
            ]
        });

        ui._startWinMoment({ mode: 'derby', winnerName });

        expect(ui.getWinMomentDiagnostics()).toMatchObject({
            active: true,
            mode: 'derby',
            winnerName: 'Grace',
            tableHidden: true
        });
        expect(winNameEl.textContent).toBe('Grace');
    });

    it('writes winner text literally and clears pending timers on hide', () => {
        const { ui, timerApi, winNameEl } = makeWinMomentHarness();
        const unsafe = '<img src=x onerror=alert(1)>';

        ui._startWinMoment({ mode: 'race', winnerName: unsafe });

        expect(winNameEl.textContent).toBe(unsafe);
        expect(winNameEl.children).toHaveLength(0);

        ui.hide();

        expect(timerApi.clearTimeout).toHaveBeenCalledWith(42);
        expect(ui.getWinMomentDiagnostics()).toMatchObject({
            visible: false,
            active: false,
            tableHidden: false,
            winMomentHidden: true
        });
    });
});
