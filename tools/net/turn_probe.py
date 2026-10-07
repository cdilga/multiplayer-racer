#!/usr/bin/env python3
"""Probe a TURN server from anywhere with only the Python standard library.

1. STUN Binding (no auth): proves the UDP listener is reachable and shows our mapped address.
2. TURN Allocate with long-term credentials (TURN REST style): proves auth works and returns the
   relayed transport address, i.e. the relay ports are allocatable.

Credentials: pass --username/--credential directly, or --secret to mint a short-lived REST
credential (username "<expiry>:<label>", credential base64(HMAC-SHA1(secret, username))). Never
print or log the secret. --secret-env NAME reads NAME from the environment, or else from the owner's
~/.config/jammers/*.env, so nothing needs sourcing first. Examples:
  python3 turn_probe.py --host turn.dilger.dev --port 3479 --username U --credential C
  python3 turn_probe.py --host turn.dilger.dev --port 3479 --secret-env TURN_STATIC_AUTH_SECRET
"""
import argparse
import base64
import hashlib
import hmac
import ipaddress
import os
import socket
import struct
import sys
import time

MAGIC = 0x2112A442


def attr(t, v):
    pad = (4 - len(v) % 4) % 4
    return struct.pack("!HH", t, len(v)) + v + b"\0" * pad


def msg(mtype, attrs, txid, integrity_key=None, fingerprint=True):
    body = b"".join(attrs)
    if integrity_key is not None:
        hdr = struct.pack("!HHI", mtype, len(body) + 24, MAGIC) + txid
        mac = hmac.new(integrity_key, hdr + body, hashlib.sha1).digest()
        body += attr(0x0008, mac)
    if fingerprint:
        hdr = struct.pack("!HHI", mtype, len(body) + 8, MAGIC) + txid
        crc = (__import__("zlib").crc32(hdr + body) ^ 0x5354554E) & 0xFFFFFFFF
        body += attr(0x8028, struct.pack("!I", crc))
    return struct.pack("!HHI", mtype, len(body), MAGIC) + txid + body


def parse(data):
    mtype, length, magic = struct.unpack("!HHI", data[:8])
    txid, attrs, i = data[8:20], {}, 20
    while i < 20 + length:
        t, l = struct.unpack("!HH", data[i:i + 4])
        attrs.setdefault(t, data[i + 4:i + 4 + l])
        i += 4 + l + ((4 - l % 4) % 4)
    return mtype, txid, attrs


def xor_addr(v, txid):
    family, xport = struct.unpack("!xBH", v[:4])
    port = xport ^ (MAGIC >> 16)
    if family == 1:
        ip = ipaddress.IPv4Address(struct.unpack("!I", v[4:8])[0] ^ MAGIC)
    else:
        key = struct.pack("!I", MAGIC) + txid
        ip = ipaddress.IPv6Address(bytes(a ^ b for a, b in zip(v[4:20], key)))
    return f"{ip}:{port}"


def rpc(sock, addr, packet, timeout):
    # Only this request's reply counts: a late reply to an earlier retransmitted request (a slow server) is skipped.
    txid = packet[8:20]
    sock.settimeout(timeout)
    for _ in range(3):
        sock.sendto(packet, addr)
        try:
            while True:
                r = parse(sock.recvfrom(2048)[0])
                if r[1] == txid:
                    return r
        except socket.timeout:
            continue
    return None


def xor_peer(ip, port, txid):
    """Encode an IPv4 XOR-PEER-ADDRESS value."""
    return struct.pack("!xBH", 1, port ^ (MAGIC >> 16)) + struct.pack("!I", int(ipaddress.IPv4Address(ip)) ^ MAGIC)


def relay_data_test(sock, addr, key, username, realm, nonce, relayed, mapped, timeout):
    """Peer -> relay -> client and client -> relay -> peer, using a second socket on this host.

    Only meaningful where this host's public IP is its own address (a VPS), since the peer's
    address is taken to be the mapped IP plus the peer socket's local port.
    """
    public_ip = mapped.rsplit(":", 1)[0]
    peer = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    peer.bind(("0.0.0.0", 0))
    peer_port = peer.getsockname()[1]
    common = [attr(0x0006, username.encode()), attr(0x0014, realm), attr(0x0015, nonce)]
    txid = os.urandom(12)
    r = rpc(sock, addr, msg(0x0008, [attr(0x0012, xor_peer(public_ip, peer_port, txid))] + common, txid,
                            integrity_key=key), timeout)
    if not r or r[0] != 0x0108:
        print("relay test: CreatePermission FAILED", r and hex(r[0]))
        return
    rip, rport = relayed.rsplit(":", 1)
    peer.sendto(b"jj-peer-to-client", (rip, int(rport)))
    sock.settimeout(timeout)
    try:
        data, _ = sock.recvfrom(2048)
        mtype, _, at = parse(data)
        ok_in = mtype == 0x0017 and at.get(0x0013) == b"jj-peer-to-client"
    except socket.timeout:
        ok_in = False
    print(f"relay test: peer -> relay -> client {'OK' if ok_in else 'FAILED'}")
    txid = os.urandom(12)
    sock.sendto(msg(0x0016, [attr(0x0012, xor_peer(public_ip, peer_port, txid)), attr(0x0013, b"jj-client-to-peer")],
                    txid, fingerprint=False), addr)
    peer.settimeout(timeout)
    try:
        data, src = peer.recvfrom(2048)
        ok_out = data == b"jj-client-to-peer"
        print(f"relay test: client -> relay -> peer {'OK' if ok_out else 'FAILED'} (from {src[0]}:{src[1]})")
    except socket.timeout:
        print("relay test: client -> relay -> peer FAILED (timeout)")


def local_secret(name):
    """Read NAME from the owner's local env files (~/.config/jammers/*.env) so callers needn't export secrets."""
    d = os.path.expanduser("~/.config/jammers")
    for f in sorted(os.listdir(d)) if os.path.isdir(d) else []:
        if f.endswith(".env"):
            for line in open(os.path.join(d, f)):
                k, _, v = line.strip().removeprefix("export ").partition("=")
                if k == name and v:
                    return v.strip().strip("'\"")
    sys.exit(f"turn_probe: {name} is neither in the environment nor in ~/.config/jammers/*.env")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--host", required=True)
    ap.add_argument("--port", type=int, default=3478)
    ap.add_argument("--username")
    ap.add_argument("--credential")
    ap.add_argument("--secret-env", help="name of an env var holding the TURN REST secret")
    ap.add_argument("--timeout", type=float, default=2.0)
    ap.add_argument("--relay-test", action="store_true", help="send data both ways through the relay (needs a public-IP host)")
    a = ap.parse_args()

    if a.secret_env:
        secret = (os.environ.get(a.secret_env) or local_secret(a.secret_env)).encode()
        a.username = f"{int(time.time()) + 600}:probe"
        a.credential = base64.b64encode(hmac.new(secret, a.username.encode(), hashlib.sha1).digest()).decode()

    addr = (socket.gethostbyname(a.host), a.port)
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    print(f"target {a.host} -> {addr[0]}:{addr[1]}")

    txid = os.urandom(12)
    r = rpc(sock, addr, msg(0x0001, [], txid, fingerprint=False), a.timeout)
    if not r:
        print("STUN binding: NO RESPONSE (listener unreachable or filtered)")
        sys.exit(2)
    mapped = xor_addr(r[2][0x0020], r[1]) if 0x0020 in r[2] else "?"
    print(f"STUN binding: OK, our mapped address {mapped}")

    if not (a.username and a.credential):
        return
    req_transport = attr(0x0019, struct.pack("!B3x", 17))  # UDP
    txid = os.urandom(12)
    r = rpc(sock, addr, msg(0x0003, [req_transport], txid), a.timeout)
    if not r or r[0] != 0x0113 or 0x0014 not in r[2] or 0x0015 not in r[2]:
        print("TURN allocate: unexpected first reply", r and hex(r[0]))
        sys.exit(3)
    realm, nonce = r[2][0x0014], r[2][0x0015]
    key = hashlib.md5(a.username.encode() + b":" + realm + b":" + a.credential.encode()).digest()
    txid = os.urandom(12)
    attrs = [req_transport, attr(0x0006, a.username.encode()), attr(0x0014, realm), attr(0x0015, nonce)]
    r = rpc(sock, addr, msg(0x0003, attrs, txid, integrity_key=key), a.timeout)
    if not r:
        print("TURN allocate: NO RESPONSE")
        sys.exit(4)
    if r[0] == 0x0103:
        relayed = xor_addr(r[2][0x0016], r[1])
        lifetime = struct.unpack("!I", r[2].get(0x000D, b"\0\0\0\0"))[0]
        print(f"TURN allocate: OK, relayed address {relayed}, lifetime {lifetime}s (realm {realm.decode()})")
        if a.relay_test:
            relay_data_test(sock, addr, key, a.username, realm, nonce, relayed, mapped, a.timeout)
        # Release the allocation (Refresh with lifetime 0).
        txid = os.urandom(12)
        rel = [attr(0x000D, struct.pack("!I", 0)), attr(0x0006, a.username.encode()), attr(0x0014, realm),
               attr(0x0015, nonce)]
        rpc(sock, addr, msg(0x0004, rel, txid, integrity_key=key), a.timeout)
    else:
        err = r[2].get(0x0009, b"")
        code = (err[2] & 0x7) * 100 + err[3] if len(err) >= 4 else "?"
        print(f"TURN allocate: FAILED type {hex(r[0])} error {code} {err[4:].decode(errors='replace')}")
        sys.exit(5)


if __name__ == "__main__":
    main()
