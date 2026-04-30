#!/usr/bin/env python3
import sys, os
from http.server import HTTPServer, SimpleHTTPRequestHandler
from functools import partial

class SPAHandler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        real = super().translate_path(path)
        if os.path.exists(real):
            return real
        return os.path.join(self.directory, 'index.html')

    def log_message(self, fmt, *args):
        pass

port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
directory = os.path.abspath(sys.argv[2] if len(sys.argv) > 2 else '.')
print(f'SPA server → http://localhost:{port}', flush=True)
HTTPServer(('', port), partial(SPAHandler, directory=directory)).serve_forever()
