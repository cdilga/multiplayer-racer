// paint-key.js (br-vhtm): the one paint-key rule, shared by the host renderer (identity-paint.ts), the vehicle viewer
// (tools/vehicles/view) and the evidence page (tools/vehicles/evidence). Plain JS so the tool pages load it unbundled.
//
// The bake (tools/vehicles/paint-key.mjs) stores the atlas premultiplied: alpha is the texel's NON-paint coverage and rgb
// is the non-paint colour times that coverage (in linear light), so pure paint is (0,0,0,0). Linear filtering and
// mipmapping average premultiplied texels correctly, so an edge between paint and a livery colour blends between the
// tinted paint and that colour, never toward untinted white (the old rule keyed pure-white texels and left every
// filtered edge grey). Paint texels have rgb 0 under alpha 0, so a browser that premultiplies on decode loses nothing.
//
// Runs after <map_fragment> (diffuseColor = map texel, opacity 1): `tint` is a GLSL vec3 expression in linear light.
// It leaves `paintMask` (the paint coverage, 0..1) in scope and makes the fragment opaque again.
export const paintKeyGlsl = (tint) => `
        float paintMask = 1.0 - diffuseColor.a;
        diffuseColor.rgb += paintMask * ( ${tint} );
        diffuseColor.a = 1.0;`;
