import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const manifestPath = path.resolve(process.cwd(), 'docs/contracts/socket-protocol-manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

function eventByName(name) {
    return manifest.events[name];
}

function exampleById(id) {
    return manifest.examples.find((example) => example.id === id);
}

function validateType(type, value) {
    switch (type) {
    case 'string':
        return typeof value === 'string';
    case 'non_empty_string':
        return typeof value === 'string' && value.trim().length > 0;
    case 'room_code':
        return typeof value === 'string' && /^[A-Z0-9]{4}$/.test(value);
    case 'topology':
        return manifest.vocabulary.topologies.includes(value);
    case 'ruleset':
        return manifest.vocabulary.rulesets.includes(value);
    case 'role':
        return manifest.vocabulary.roles.includes(value);
    case 'positive_int':
        return Number.isInteger(value) && value > 0;
    case 'non_negative_int':
        return Number.isInteger(value) && value >= 0;
    case 'boolean':
        return typeof value === 'boolean';
    case 'number':
        return typeof value === 'number' && Number.isFinite(value);
    case 'number_or_null':
        return value === null || (typeof value === 'number' && Number.isFinite(value));
    case 'string_or_int_or_null':
        return value === null || typeof value === 'string' || Number.isInteger(value);
    case 'hex_color':
        return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
    case 'game_state':
        return ['waiting', 'racing', 'finished'].includes(value);
    default:
        throw new Error(`Unknown schema type: ${type}`);
    }
}

function validateSchema(schema, value, pathLabel = 'payload') {
    if (schema.type === 'array') {
        if (!Array.isArray(value)) {
            return [`${pathLabel} should be an array`];
        }
        if (schema.length !== undefined && value.length !== schema.length) {
            return [`${pathLabel} should have length ${schema.length}`];
        }
        return value.flatMap((item, index) => validateSchema(schema.items, item, `${pathLabel}[${index}]`));
    }

    if (schema.type === 'object' || schema.required || schema.optional) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            return [`${pathLabel} should be an object`];
        }
        const errors = [];
        const required = schema.required || {};
        const optional = schema.optional || {};

        for (const [key, childSchema] of Object.entries(required)) {
            if (!(key in value)) {
                errors.push(`${pathLabel}.${key} is required`);
                continue;
            }
            errors.push(...validateSchema(childSchema, value[key], `${pathLabel}.${key}`));
        }

        for (const [key, childSchema] of Object.entries(optional)) {
            if (key in value && value[key] !== undefined) {
                errors.push(...validateSchema(childSchema, value[key], `${pathLabel}.${key}`));
            }
        }
        return errors;
    }

    return validateType(schema.type, value) ? [] : [`${pathLabel} should satisfy ${schema.type}`];
}

describe('socket protocol manifest', () => {
    it('keeps topology, ruleset, and role vocabularies orthogonal', () => {
        const all = [
            ...manifest.vocabulary.topologies,
            ...manifest.vocabulary.rulesets,
            ...manifest.vocabulary.roles
        ];
        expect(new Set(all).size).toBe(all.length);
        expect(manifest.vocabulary.seat.current_wire_fields.join_and_lifecycle).toContain('player_id');
        expect(manifest.vocabulary.seat.current_wire_fields.result_rows).toContain('playerId');
    });

    it('declares every event with lane, sender, receiver, malformed policy, and schema', () => {
        for (const [name, event] of Object.entries(manifest.events)) {
            expect(name).toMatch(/^[a-z_]+$/);
            expect(['reliable', 'volatile']).toContain(event.lane);
            expect(typeof event.sender).toBe('string');
            expect(event.sender.length).toBeGreaterThan(0);
            expect(typeof event.receiver).toBe('string');
            expect(event.receiver.length).toBeGreaterThan(0);
            expect(typeof event.malformed).toBe('string');
            expect(event.malformed.length).toBeGreaterThan(0);
            expect(event.schema).toBeTruthy();
            expect(event.sequence).toBeTruthy();
            if (event.lane === 'volatile' && event.receiver === 'server') {
                expect(event.malformed.toLowerCase()).toContain('drop');
            }
        }
    });

    it('validates every checked-in example payload against the declared event schema', () => {
        for (const example of manifest.examples) {
            expect(Array.isArray(example.messages)).toBe(true);
            expect(example.messages.length).toBeGreaterThan(0);

            for (const message of example.messages) {
                const event = eventByName(message.event);
                expect(event, `Missing event definition for ${message.event}`).toBeTruthy();
                const errors = validateSchema(event.schema, message.payload, `${example.id}.${message.event}`);
                expect(errors, errors.join('\n')).toEqual([]);
            }
        }
    });

    it('locks the Local and remote rendering role expectations from AGENTS.md', () => {
        const local = exampleById('local-controller-join').messages[0].payload;
        const remote = exampleById('remote-driver-viewer-join').messages[0].payload;
        const mixed = exampleById('mixed-rendering-join').messages[0].payload;

        expect(local.topology).toBe('local');
        expect(local.roles).toEqual(['controller']);
        expect(local.roles).not.toContain('viewer');

        expect(remote.topology).toBe('remote');
        expect(remote.roles).toEqual(['controller', 'viewer']);

        expect(mixed.topology).toBe('mixed');
        expect(mixed.roles).toEqual(['controller', 'viewer']);
    });

    it('keeps the seat and sequence invariants explicit in the examples', () => {
        const duplicate = exampleById('duplicate-tab-takeover').messages;
        const spoof = exampleById('controller-spoof-rejection').messages[0];
        const snapshot = exampleById('remote-viewer-state').messages[0];
        const raceResults = exampleById('race-results').messages[0].payload;
        const derbyResults = exampleById('derby-results').messages[0].payload;

        expect(duplicate[0].payload.player_id).toBe(duplicate[1].payload.player_id);
        expect(duplicate[1].payload.player_id).toBe(duplicate[2].payload.id);

        expect(spoof.payload.seq).toBeGreaterThanOrEqual(0);
        expect(snapshot.payload.seq).toBeGreaterThanOrEqual(0);

        expect(raceResults.mode).toBe('race');
        expect(raceResults.results[0]).toHaveProperty('finishTime');
        expect(raceResults.results[0]).toHaveProperty('bestLapTime');

        expect(derbyResults.mode).toBe('derby');
        expect(derbyResults.results[0]).toHaveProperty('totalPoints');
        expect(derbyResults.results[0]).toHaveProperty('roundWins');
    });
});
