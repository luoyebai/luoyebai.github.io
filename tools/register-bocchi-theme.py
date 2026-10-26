from pathlib import Path
import base64
import io
import json
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
with Image.open(ROOT / 'assets/bg/bocchi.jpg') as im:
    im.save(ROOT / 'assets/bg/bocchi.webp', 'WEBP', quality=84, method=6)
    size = list(im.size)
    thumb = im.copy()
    thumb.thumbnail((24, 24))
    out = io.BytesIO()
    thumb.save(out, 'JPEG', quality=35)
    lqip = 'data:image/jpeg;base64,' + base64.b64encode(out.getvalue()).decode()

config_path = ROOT / 'site.config.json'
config = json.loads(config_path.read_text(encoding='utf-8'))
theme = dict(id='bocchi', name='波奇光晕', nameEn='Bocchi Halo', bg='assets/bg/bocchi.jpg',
    swatch=['#eaa5bc', '#6acbc9', '#101b2d'],
    seeds=dict(accent='#eaa5bc', accent2='#6acbc9', darkBg='#101b2d', lightBg='#fcf3f5', tintHue=339))
config['themes'] = [t for t in config['themes'] if t['id'] != 'bocchi'] + [theme]
config_path.write_text(json.dumps(config, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
manifest_path = ROOT / 'assets/bg/manifest.json'
manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
manifest['bocchi'] = dict(file=theme['bg'], wid='3168117211', source='无BGM.mp4',
    title='bocchi the rock 孤独摇滚 波奇酱 光晕', size=size,
    kb=(ROOT / theme['bg']).stat().st_size // 1024, avg='#101b2d', lqip=lqip,
    video='assets/bg/bocchi.mp4', video_kb=(ROOT / 'assets/bg/bocchi.mp4').stat().st_size // 1024)
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print('Registered 波奇光晕; existing default theme preserved.')
