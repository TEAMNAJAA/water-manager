import json
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

OUT = Path(sys.argv[2] if len(sys.argv) > 2 else "clip_inbox")
SEEN = set()


class Handler(BaseHTTPRequestHandler):
    def _reply(self, code, body=None):
        data = json.dumps(body or {}).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        device = self.headers.get("X-Device", "unknown")
        if self.path == "/api/clip/heartbeat":
            print(time.strftime("%H:%M:%S"), device, "heartbeat", body.decode())
            return self._reply(200, {"interval": 3600})
        if self.path == "/api/clip/photo":
            key = (device, self.headers.get("X-Seq"), self.headers.get("X-Light"))
            if key in SEEN:
                return self._reply(409)
            SEEN.add(key)
            folder = OUT / device
            folder.mkdir(parents=True, exist_ok=True)
            name = f"{key[1]}_{key[2]}_{self.headers.get('X-Captured-At')}.jpg"
            (folder / name).write_bytes(body)
            print(time.strftime("%H:%M:%S"), device, "photo", name, len(body), "bytes")
            return self._reply(201)
        self._reply(404)

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    print(f"mock NamJai server on http://0.0.0.0:{port}, saving to {OUT.resolve()}")
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()
