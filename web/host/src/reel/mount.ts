import type { SimClient, RoomView } from '../worker/client';
import type { World } from '../render/world';
import type { RoundScreens } from '../round/screens';
import { HighlightRecorder, type Identity } from './recorder';
import { ReelPlayer } from './player';

const actorsOf = (room: RoomView | null): Identity[] => (room?.seats ?? []).flatMap(s => s.car === null ? [] : [{
  seat:s.seat, car:s.car, number:s.number, name:s.name, rgb:[...s.rgb] as [number,number,number],
}]);

/** Additive listeners: scoring, audio and transport retain their own event feeds and pooled-buffer lifecycle. */
export function mountReel(client: SimClient, world: World, screens: RoundScreens): void {
  const recorder = new HighlightRecorder();
  const player = new ReelPlayer(world.backend.kind, () => screens.refit());
  let round: number | null = null;
  let phase = client.room?.phase;
  let tick = 0;
  const previous = world.onSnapshotFrame;
  world.onSnapshotFrame = frame => {
    previous(frame);
    tick = frame.tick;
    if (phase === 'Running' || phase === 'Finalising') recorder.capture(frame, actorsOf(client.room));
  };
  client.watchEvents(events => {
    if (phase !== 'Running' && phase !== 'Finalising') return;
    for (const event of events) {
      const [kind, detail] = Object.entries(event)[0] ?? [];
      if (!detail || !['PartDetached','Wrecked','Finished'].includes(kind!)) continue;
      const actors = actorsOf(client.room).filter(a => a.seat === Number(detail.seat) || a.seat === Number(detail.instigator));
      // Victim/finisher first, so the orbit follows the actual event subject.
      actors.sort((a,b) => Number(b.seat===Number(detail.seat)) - Number(a.seat===Number(detail.seat)));
      recorder.event({tick, kind:kind==='PartDetached'?'detach':kind==='Wrecked'?'wreck':'finish', actors});
    }
  });
  client.watchRoom(room => {
    const previousPhase = phase; phase = room.phase;
    if (phase === 'Running' && room.round !== round) {
      player.stop(); round = room.round;
      if (world.map) recorder.reset({map:world.map.map,round,vehicles:room.vehicles});
    }
    if (phase === 'Intermission' && previousPhase !== phase) {
      const slot = screens.replaySlot();
      if (slot) void player.play(slot,recorder);
    } else if (phase !== 'Intermission' && previousPhase === 'Intermission') player.stop();
  });
  addEventListener('pagehide', () => player.stop());
  // R90 readout and explicit replay skip. It exposes no way for playback to change live simulation.
  (window as unknown as {__jjReel:unknown}).__jjReel = {
    inspect:()=>({recorder:recorder.inspect(),player:player.inspect()}), hide:()=>player.hide(),
    pause:(on:boolean)=>player.pause(on), seek:(seconds:number)=>player.seek(seconds,recorder.profile.tickHz),
  };
}
