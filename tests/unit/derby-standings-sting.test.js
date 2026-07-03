import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

function makeTextNode() {
    return { textContent: '' };
}

function makeHarness() {
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
        derbyStingDurationMs: 900
    });
    const appendedRows = [];
    ui.element = {
        classList: makeClassList(['hidden']),
        dataset: {}
    };
    ui.elements = {
        derbySting: {
            classList: makeClassList(['hidden']),
            dataset: {}
        },
        derbyStingRound: makeTextNode(),
        derbyStingWinner: makeTextNode(),
        derbyStingList: {
            innerHTML: '',
            appendChild: (row) => appendedRows.push(row)
        }
    };
    return { ui, callbacks, timerApi, appendedRows };
}

describe('ResultsUI derby standings sting', () => {
    let originalDocument;

    beforeEach(() => {
        originalDocument = globalThis.document;
        globalThis.document = {
            createElement: () => {
                const name = makeTextNode();
                const points = makeTextNode();
                return {
                    className: '',
                    innerHTML: '',
                    querySelector(selector) {
                        if (selector === '.results-derby-sting-name') return name;
                        if (selector === '.results-derby-sting-points') return points;
                        return null;
                    },
                    __name: name,
                    __points: points
                };
            }
        };
    });

    afterEach(() => {
        globalThis.document = originalDocument;
    });

    it('sorts round-end score payloads into compact top-three standings', () => {
        const { ui } = makeHarness();

        const standings = ui._extractDerbyStingStandings({
            winnerId: 'Ada',
            scores: {
                Linus: 2,
                Ada: 8,
                Grace: 5,
                Hopper: 1
            }
        });

        expect(standings).toEqual([
            { playerId: 'Ada', totalPoints: 8, roundWins: 0, position: 1 },
            { playerId: 'Grace', totalPoints: 5, roundWins: 0, position: 2 },
            { playerId: 'Linus', totalPoints: 2, roundWins: 0, position: 3 }
        ]);
    });

    it('renders as active, keeps the results modal hidden, and auto-hides once', () => {
        const { ui, callbacks, timerApi, appendedRows } = makeHarness();

        ui.showDerbyStandingsSting({
            round: 2,
            winnerId: 'Grace',
            scores: {
                Ada: 4,
                Grace: 9,
                Linus: 3
            }
        });

        expect(timerApi.setTimeout).toHaveBeenCalledWith(expect.any(Function), 900);
        expect(ui.getDerbyStandingsStingDiagnostics()).toMatchObject({
            active: true,
            completed: false,
            hidden: false,
            modalVisible: false,
            round: 2,
            winnerName: 'Grace',
            rowCount: 3,
            durationMs: 900
        });
        expect(ui.elements.derbyStingRound.textContent).toBe('Round 2');
        expect(ui.elements.derbyStingWinner.textContent).toBe('Grace wins');
        expect(appendedRows).toHaveLength(3);
        expect(appendedRows[0].__name.textContent).toBe('Grace');
        expect(appendedRows[0].__points.textContent).toBe('9 pts');

        callbacks.shift()();

        expect(timerApi.clearTimeout).toHaveBeenCalled();
        expect(ui.getDerbyStandingsStingDiagnostics()).toMatchObject({
            active: false,
            completed: true,
            hidden: true,
            modalVisible: false
        });
    });

    it('clears the sting when the full results UI is hidden', () => {
        const { ui, callbacks } = makeHarness();

        ui.showDerbyStandingsSting({
            round: 1,
            winnerId: 'Ada',
            scores: { Ada: 8 }
        });
        expect(callbacks).toHaveLength(1);

        ui.hide();

        expect(ui.getDerbyStandingsStingDiagnostics()).toMatchObject({
            active: false,
            hidden: true
        });
    });
});
