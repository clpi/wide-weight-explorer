#!/usr/bin/env python3
import json, pathlib

root = pathlib.Path('.')
css = (root/'styles.css').read_text()
engine = (root/'engine.js').read_text()
app = (root/'app.js').read_text()
seed = json.loads((root/'seed.json').read_text())
tpl = (root/'template.html').read_text()

seed_js = 'window.WIDE_SEED = ' + json.dumps(seed, separators=(',', ':')) + ';'
for chunk in (css, engine, app, seed_js):
    assert '</script' not in chunk.lower(), 'script terminator inside asset'

out = (tpl.replace('{{CSS}}', css)
          .replace('{{SEED}}', seed_js)
          .replace('{{ENGINE}}', engine)
          .replace('{{APP}}', app))
(root/'index.html').write_text(out)
print('index.html', len(out), 'bytes')
