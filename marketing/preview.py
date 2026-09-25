"""Preview the site locally, footer included: python3 preview.py [port]

The pages include the shared footer with nginx server-side includes, which a
plain file server (python3 -m http.server, double-clicking a file) leaves out.
This serves the folder the same way nginx does, with the includes filled in.
"""

import functools
import http.server
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
INCLUDE = re.compile(r'<!--#\s*include\s+(?:virtual|file)="([^"]+)"\s*-->')


class Handler(http.server.SimpleHTTPRequestHandler):
    def send_head(self):
        path = Path(self.translate_path(self.path))
        if path.is_dir():
            path = path / "index.html"
        if path.suffix != ".html" or not path.is_file():
            return super().send_head()

        html = INCLUDE.sub(lambda m: (ROOT / m.group(1).lstrip("/")).read_text(), path.read_text())
        body = html.encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
        return None


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    handler = functools.partial(Handler, directory=str(ROOT))
    print(f"PestBase site on http://localhost:{port}")
    http.server.ThreadingHTTPServer(("", port), handler).serve_forever()
