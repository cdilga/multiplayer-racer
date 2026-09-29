"""Tiny client for the live Blender MCP socket (localhost:9876). python3 bmcp.py file.py  |  import bmcp; bmcp.run(code)"""
import json, socket, sys
def call(cmd, params=None, port=9876):
    s = socket.create_connection(("localhost", port), timeout=600)
    s.sendall(json.dumps({"type": cmd, "params": params or {}}).encode())
    buf = b""
    while True:
        c = s.recv(1 << 20)
        if not c: break
        buf += c
        try: return json.loads(buf)
        except ValueError: pass
    return json.loads(buf)
def run(code): return call("execute_code", {"code": code})
if __name__ == "__main__":
    r = run(open(sys.argv[1]).read()); print(json.dumps(r)[:4000])
