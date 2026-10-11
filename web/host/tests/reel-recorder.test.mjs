import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { resolve } from 'node:path';
import { createServer } from '../../node_modules/vite/dist/node/index.js';
import { unpackFrame } from '../src/reel/frame.ts';
import { encodeSnapshot, decodeSnapshot, snapshotBytes } from '../src/render/snapshot.ts';

const vite = await createServer({ root: resolve(import.meta.dirname, '../..'), appType: 'custom', server: { middlewareMode: true }, logLevel: 'error' });
after(() => vite.close());
const { HighlightRecorder } = await vite.ssrLoadModule('/host/src/reel/recorder.ts');

const identities = [
  { seat: 1, car: 100, number: 7, name: 'Roo', rgb: [255, 40, 60] },
  { seat: 2, car: 101, number: 12, name: 'Gazza', rgb: [30, 90, 250] },
];
function frame(tick, { air = false, life = 1, cars = 2 } = {}) {
  const buf = new ArrayBuffer(snapshotBytes(cars));
  encodeSnapshot(buf, tick, Array.from({length: cars}, (_,i) => ({ id: 100+i, life,
    flags: air ? 256 : 0, pos: [tick/10, 1, i*3], rot: [0,0,0,1] })));
  return decodeSnapshot(new DataView(buf));
}
// Fixture positions below are in 60Hz units; convert them to the shipped 120Hz simulation clock.
const feed = (r, start, end, options) => { for (let tick = start; tick <= end; tick += 2) r.capture(frame(tick * 2, options), identities); };
const event = (r, e) => r.event({...e, tick:e.tick * 2});

test('two detaches and a wreck retain exact identities, independent of a 20s rolling history', () => {
  const r = new HighlightRecorder(); r.reset({ map: { version: 13 }, assets: 'roster-v1' });
  feed(r, 0, 240);
  event(r, { tick: 240, kind: 'detach', actors: [identities[0]] });
  feed(r, 242, 270);
  event(r, { tick: 270, kind: 'detach', actors: [identities[1]] });
  feed(r, 272, 300);
  event(r, { tick: 300, kind: 'wreck', actors: identities });
  feed(r, 302, 1800);
  assert.ok(r.inspect().oldestRingTick > 840);
  const [clip] = r.select();
  assert.equal(r.select().length, 1, 'overlapping pre/post-roll merges');
  assert.deepEqual(clip.events.map(e => [e.kind, e.actors.map(a => a.number)]),
    [['detach',[7]], ['detach',[12]], ['wreck',[7,12]]]);
  assert.equal(r.profile.tickHz, 120);
  assert.equal(clip.frames[0].tick, 120); assert.equal(clip.frames.at(-1).tick, 840);
  assert.equal((clip.events[0].tick-clip.frames[0].tick)/r.profile.tickHz,3,'three real seconds of preroll');
  assert.equal((clip.frames.at(-1).tick-clip.events.at(-1).tick)/r.profile.tickHz,2,'two real seconds of postroll');
  assert.equal(clip.frames[1].tick-clip.frames[0].tick,4,'30Hz recording on the simulation clock');
  assert.deepEqual([...unpackFrame(clip.frames[0].bytes).id], [100,101]);
  assert.equal(unpackFrame(clip.frames[0].bytes).pos[0], 12);
  assert.deepEqual(r.baseline(), {map:{version:13}, assets:'roster-v1'});
  const actors=r.actors(); actors[0].rgb[0]=0;
  assert.deepEqual(r.actors(),identities,'all captured car paints are owned, including non-event cars');
  assert.ok(r.inspect().ownedBytes < 64 * 1024 * 1024);
});

test('memory pressure evicts footage by value; oversized actors never become a live cap', () => {
  const r = new HighlightRecorder({budgetBytes: 160_000}); r.reset({ map: 'fixture' });
  for (let tick = 0; tick < 3600; tick += 2) {
    r.capture(frame(tick*2), identities);
    if (tick % 400 === 240) event(r,{tick, kind: tick===3040 ? 'wreck' : 'detach', actors:[identities[(tick/400|0)%2]]});
    assert.ok(r.inspect().ownedBytes <= 160_000);
    assert.ok(r.inspect().highWaterBytes <= 160_000);
  }
  assert.ok(r.inspect().evictedClips > 0);
  assert.ok(r.select().some(c => c.events.some(e => e.kind === 'wreck')));
  const huge = frame(7200, {cars:4000});
  const before = huge.id.slice(); r.capture(huge, identities);
  assert.deepEqual(huge.id, before);
  assert.equal(huge.cars, 4000);
  assert.ok(r.inspect().rejectedIntervals > 0);
  assert.ok(r.inspect().ownedBytes <= 160_000);
});

test('lost intervals discard incomplete causality without orphaning older retained clips', () => {
  const r = new HighlightRecorder(); r.reset({ map: 'fixture' });
  feed(r, 0, 240); event(r,{tick:240,kind:'wreck',actors:[identities[0]]}); feed(r,242,600);
  event(r,{tick:600,kind:'detach',actors:[identities[1]]});
  feed(r,650,900);
  assert.equal(r.inspect().rejectedIntervals, 1);
  assert.deepEqual(r.select().flatMap(c => c.events.map(e=>e.kind)), ['wreck']);
});

test('contact readout triggers air once per flight/life and close finishes show both identities', () => {
  const r = new HighlightRecorder(); r.reset({ map: 'fixture' });
  feed(r,0,180);
  feed(r,182,300,{air:true});
  feed(r,302,400); event(r,{tick:400,kind:'finish',actors:[identities[0]]});
  feed(r,402,430); event(r,{tick:430,kind:'finish',actors:[identities[1]]}); feed(r,432,600);
  const events = r.select().flatMap(c=>c.events);
  assert.equal(events.filter(e=>e.kind==='air').length, 2, 'one per car, not per sample');
  assert.deepEqual(events.find(e=>e.kind==='close-finish').actors.map(a=>a.number),[12,7]);
  const before = structuredClone(r.inspect()); r.select(); r.baseline();
  assert.deepEqual(r.inspect(),before,'playback reads never mutate the recording');
  r.reset({map:'next-round'}); assert.equal(r.inspect().retainedClips,0);
});

test('a race-long overlapping event chain selects at most sixty seconds without actor truncation',()=>{
  const r=new HighlightRecorder();r.reset({map:'fixture'});
  for(let tick=0;tick<=6000;tick+=2){
    r.capture(frame(tick*2),identities);
    if(tick%180===0)event(r,{tick,kind:'detach',actors:identities});
  }
  const selected=r.select();
  assert.ok(selected.length>0);
  assert.ok(selected.reduce((n,c)=>n+(c.frames.at(-1).tick-c.frames[0].tick)/r.profile.tickHz,0)<=60);
  assert.deepEqual([...unpackFrame(selected[0].frames[0].bytes).id],[100,101]);
});
