// The host capability check (P1-R01, plan §10, R01): before a room exists, this browser must draw the world (WebGL2
// or WebGPU), run the sim (WebAssembly) and run it off the main thread (module workers). If it can't, the host page
// says why and offers Join instead of opening a room it can't run.

export interface Capability {
  ok: boolean;
  webgl2: boolean;
  webgpu: boolean;
  wasm: boolean;
  moduleWorkers: boolean;
  /** Plain-language reasons, one per missing piece. */
  missing: string[];
}

function hasWebgl2(): boolean {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return !!gl;
  } catch {
    return false;
  }
}

async function hasWebgpu(): Promise<boolean> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  if (!gpu) return false;
  try {
    return !!(await gpu.requestAdapter());
  } catch {
    return false;
  }
}

function hasWasm(): boolean {
  try {
    // The smallest valid module: magic + version.
    return typeof WebAssembly === 'object' && WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
  } catch {
    return false;
  }
}

function hasModuleWorkers(): boolean {
  if (typeof Worker === 'undefined') return false;
  let supported = false;
  try {
    // Reading `type` is how a browser shows it understands module workers; an empty data: worker is never started.
    const opts = {
      get type(): 'module' {
        supported = true;
        return 'module';
      },
    };
    new Worker('data:text/javascript,', opts).terminate();
  } catch {
    /* constructing may fail for other reasons; `supported` already says whether the option was read */
  }
  return supported;
}

export async function checkCapability(): Promise<Capability> {
  const webgl2 = hasWebgl2();
  const webgpu = await hasWebgpu();
  const wasm = hasWasm();
  const moduleWorkers = hasModuleWorkers();
  const missing: string[] = [];
  if (!webgl2 && !webgpu) missing.push('3D graphics (WebGL2 or WebGPU) are turned off or not supported, so it can’t draw the race.');
  if (!wasm) missing.push('WebAssembly isn’t available, so it can’t run the game’s physics.');
  if (!moduleWorkers) missing.push('Background workers aren’t available, so the game can’t run smoothly.');
  return { ok: missing.length === 0, webgl2, webgpu, wasm, moduleWorkers, missing };
}

/** Replaces the page with the explanation and a way to join from this device instead. No room is created. */
export function showUnsupported(root: HTMLElement, cap: Capability, joinHref: string): void {
  root.replaceChildren();
  const box = document.createElement('section');
  box.className = 'jj-unsupported';
  box.setAttribute('role', 'alert');
  const h = document.createElement('h1');
  h.textContent = 'This browser can’t host a game';
  const list = document.createElement('ul');
  for (const m of cap.missing) {
    const li = document.createElement('li');
    li.textContent = m;
    list.append(li);
  }
  const next = document.createElement('p');
  next.textContent = 'Host from another device (a laptop or a newer phone), or join a game from this one.';
  const join = document.createElement('a');
  join.href = joinHref;
  join.className = 'jj-join';
  join.textContent = 'Join a game';
  box.append(h, list, next, join);
  root.append(box);
}
