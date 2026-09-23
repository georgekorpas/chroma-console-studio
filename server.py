#!/usr/bin/env python3
"""Dependency-free, loopback-only static server. No MIDI or device access."""
import argparse
import http.server
import json
import os
import signal
from pathlib import Path
import subprocess
import sys
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parent
PORT = 8765
URL = f'http://127.0.0.1:{PORT}'
MARKER = 'chroma-console-editor-v1'
FILES = {'/': 'index.html', '/index.html': 'index.html', '/style.css': 'style.css',
         '/app.mjs': 'app.mjs', '/protocol.mjs': 'protocol.mjs', '/desktop.mjs': 'desktop.mjs',
         '/tests/': 'tests/index.html', '/tests/tests.mjs': 'tests/tests.mjs', '/tests/live-ui.mjs': 'tests/live-ui.mjs'}

class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.headers.get('Host') not in (f'127.0.0.1:{PORT}', f'localhost:{PORT}'):
            self.send_error(403)
            return
        path = self.path.split('?', 1)[0]
        if path == '/health':
            data = json.dumps({'app': MARKER}).encode()
            mime = 'application/json'
        elif path in FILES:
            data = (ROOT / FILES[path]).read_bytes()
            mime = {'html':'text/html', 'css':'text/css', 'mjs':'text/javascript'}[FILES[path].rsplit('.',1)[1]]
        else:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header('Content-Type', mime + '; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'")
        self.send_header('Permissions-Policy', 'midi=(self), camera=(), microphone=(), geolocation=()')
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, fmt, *args):
        pass

def running():
    try:
        with urllib.request.urlopen(URL + '/health', timeout=1) as response:
            return json.load(response).get('app') == MARKER
    except (OSError, ValueError, urllib.error.URLError):
        return False

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--serve', action='store_true')
    parser.add_argument('--open', action='store_true')
    parser.add_argument('--stop', action='store_true')
    args = parser.parse_args()
    if args.stop:
        pid_file = ROOT / '.server.pid'
        if not pid_file.exists():
            print('No editor server PID is recorded.')
            return
        pid = int(pid_file.read_text())
        command = subprocess.run(['ps', '-p', str(pid), '-o', 'command='], capture_output=True, text=True).stdout
        if str(ROOT / 'server.py') in command and '--serve' in command:
            os.kill(pid, signal.SIGTERM)
            print('Chroma editor server stopped. The pedal was not changed.')
        else:
            print('The recorded editor process is no longer running.')
        pid_file.unlink(missing_ok=True)
        return
    if args.serve:
        with http.server.ThreadingHTTPServer(('127.0.0.1', PORT), Handler) as server:
            server.serve_forever()
        return
    if not running():
        with (ROOT / '.server.log').open('ab') as log:
            process = subprocess.Popen([sys.executable, str(ROOT / 'server.py'), '--serve'],
                                       cwd=ROOT, stdin=subprocess.DEVNULL, stdout=log, stderr=log,
                                       start_new_session=True)
        for _ in range(30):
            if running():
                (ROOT / '.server.pid').write_text(str(process.pid))
                break
            if process.poll() is not None:
                raise SystemExit('Could not start the editor. Port 8765 may be in use. See .server.log.')
            time.sleep(.1)
        else:
            raise SystemExit('The local editor server did not start. See .server.log.')
    print(f'Chroma Console Editor is running at {URL}')
    if args.open:
        subprocess.run(['open', '-a', 'Google Chrome', URL], check=True)

if __name__ == '__main__':
    main()
