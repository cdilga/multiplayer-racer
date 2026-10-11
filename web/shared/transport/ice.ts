import type { IceServer } from './api';

/** Omit redundant RFC 7065 transport defaults. WebKit rejects these explicit query strings;
 * a bare turn URL still means UDP and a bare turns URL still means TLS over TCP. Preserve
 * non-default transports (in particular turn over TCP) and every credential and endpoint. */
export function canonicalIceServers(servers: IceServer[]): IceServer[] {
  return servers.map((server) => ({
    ...server,
    urls: server.urls.map((url) => {
      if (/^turn:/i.test(url) && url.endsWith('?transport=udp')) return url.slice(0, -'?transport=udp'.length);
      if (/^turns:/i.test(url) && url.endsWith('?transport=tcp')) return url.slice(0, -'?transport=tcp'.length);
      return url;
    }),
  }));
}
