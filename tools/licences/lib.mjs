// The licence list's logic (P1-C09): which lockfile packages ship, what licence each carries, and whether the committed
// list still matches the lockfiles and the policy. Pure functions; `generate.mjs` feeds them cargo metadata and the web
// lockfile, `check.mjs` feeds them the committed list and the lockfiles, and `check.test.mjs` feeds them an injected case.

/** `name@version` for every `[[package]]` of a Cargo.lock that comes from a registry or git (our own crates have no source). */
export function cargoLockPackages(text) {
  const out = [];
  for (const block of text.split('[[package]]').slice(1)) {
    const name = /^name = "(.*)"$/m.exec(block)?.[1];
    const version = /^version = "(.*)"$/m.exec(block)?.[1];
    const source = /^source = "(.*)"$/m.exec(block)?.[1];
    if (name && version && source) out.push(`${name}@${version}`);
  }
  return out.sort();
}

const nameOf = (path) => path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length);

/** `name@version` for the web lockfile's non-dev packages (workspace links have no version and are skipped). */
export function npmShippedPackages(lock) {
  const out = [];
  for (const [path, p] of Object.entries(lock.packages ?? {})) {
    if (!path.includes('node_modules/') || p.link || !p.version || p.dev) continue;
    out.push(`${nameOf(path)}@${p.version}`);
  }
  return out.sort();
}

/** Every `name@version` in the lockfile's packages, dev included (the list must account for them too). */
export function npmAllPackages(lock) {
  const out = [];
  for (const [path, p] of Object.entries(lock.packages ?? {})) {
    if (!path.includes('node_modules/') || p.link || !p.version) continue;
    out.push(`${nameOf(path)}@${p.version}`);
  }
  return out.sort();
}

function balanced(s) {
  let d = 0;
  for (const c of s) {
    if (c === '(') d++;
    if (c === ')' && --d < 0) return false;
  }
  return d === 0;
}

/** Splits at top level (outside parentheses) on a separator pattern. */
function split(s, sep) {
  const parts = [];
  let depth = 0;
  let cur = '';
  const re = new RegExp(`^(?:${sep.source})`, sep.flags);
  for (let i = 0; i < s.length; ) {
    const c = s[i];
    if (c === '(') depth++;
    if (c === ')') depth--;
    const m = depth === 0 ? re.exec(s.slice(i)) : null;
    if (m?.[0].length) {
      parts.push(cur);
      cur = '';
      i += m[0].length;
    } else {
      cur += c;
      i++;
    }
  }
  parts.push(cur);
  return parts;
}

/** An SPDX expression against the policy: `OR` needs one side, `AND` needs both, `X WITH Y` is one id; `/` is the old `OR`. */
export function licenceAllowed(expr, allow) {
  if (!expr) return false;
  const parse = (s) => {
    s = s.trim();
    while (s.startsWith('(') && s.endsWith(')') && balanced(s.slice(1, -1))) s = s.slice(1, -1).trim();
    const or = split(s, /\s+OR\s+|\//i);
    if (or.length > 1) return or.some(parse);
    const and = split(s, /\s+AND\s+/i);
    if (and.length > 1) return and.every(parse);
    return allow.includes(s);
  };
  return parse(expr);
}

/**
 * What is wrong with the committed list: a lockfile package it doesn't account for, a shipped dependency with no licence or
 * one outside the policy, an entry for a package that is no longer locked. An empty array is a pass.
 */
export function problems({ list, cargoLock, npmLock, policy }) {
  const out = [];
  const shipped = new Map([...list.rust, ...list.web].map((e) => [`${e.name}@${e.version}`, e]));
  const notShipped = new Set([...(list.rustNotShipped ?? []), ...(list.webNotShipped ?? [])]);
  const locked = [...cargoLockPackages(cargoLock), ...npmAllPackages(npmLock)];
  for (const id of locked) {
    if (!shipped.has(id) && !notShipped.has(id)) out.push(`${id} is locked but has no entry in the licence list: run node tools/licences/generate.mjs`);
  }
  const lockedSet = new Set(locked);
  for (const id of [...shipped.keys(), ...notShipped]) {
    if (!lockedSet.has(id)) out.push(`${id} is in the licence list but no longer locked: run node tools/licences/generate.mjs`);
  }
  for (const [id, e] of shipped) {
    const exception = policy.exceptions[e.name];
    if (exception) {
      if (e.licence !== exception.licence) out.push(`${id} carries ${e.licence ?? 'no licence'}, not the excepted ${exception.licence}`);
      continue;
    }
    if (!e.licence) out.push(`${id} ships with no licence entry`);
    else if (!licenceAllowed(e.licence, policy.allow)) out.push(`${id} ships under ${e.licence}, outside the policy (tools/licences/policy.json)`);
  }
  return out;
}
