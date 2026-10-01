// inspect_glb.mjs — throwaway inspection of cruz_missile.lod1.glb node hierarchy, used once while
// writing load_vehicle_v2.mjs to confirm the chassis frame / node-nesting assumptions from
// ASSET-CONTRACT.md before trusting them in the real loader.
import { loadScene, nodeByName, worldPos } from "../../C-physics/gltf-lite.mjs";

const GLB = "../../../../art/vehicles/cruz-missile/cruz_missile.lod1.glb";
const scene = loadScene(new URL(GLB, import.meta.url).pathname);
const mat4Translation = (m) => [m[12], m[13], m[14]];

for (const n of scene.nodes) {
    const parentName = n.parent >= 0 ? scene.nodes[n.parent].name : "(root)";
    const wt = mat4Translation(n.world);
    const hasExtras = n.extras ? Object.keys(n.extras).join(",") : "";
    console.log(`${n.name.padEnd(20)} parent=${parentName.padEnd(14)} local_t=${n.translation.map(x=>x.toFixed(3))} rot=${n.rotation.map(x=>x.toFixed(3))} world_t=${wt.map(x=>x.toFixed(3))} mesh=${n.mesh ?? "-"} extras=[${hasExtras}]`);
}

const chassis = nodeByName(scene, "chassis");
console.log("\nchassis world matrix:", chassis.world);
console.log("chassis local rotation:", chassis.rotation, "local translation:", chassis.translation);
