"""Generate smaller wallpaper alternatives; keep the original source images."""
import json
from pathlib import Path
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[1]

def main():
    config = json.loads((ROOT / 'site.config.json').read_text(encoding='utf-8'))
    before = after = 0
    for theme in config['themes']:
        source = ROOT / theme['bg']
        target = source.with_suffix('.webp')
        with Image.open(source) as original:
            image = ImageOps.exif_transpose(original).convert('RGB')
            image.thumbnail((1920, 1920), Image.Resampling.LANCZOS)
            image.save(target, 'WEBP', quality=80, method=6)
        before += source.stat().st_size
        after += target.stat().st_size
        print(f'{target.name}: {source.stat().st_size:,} -> {target.stat().st_size:,} bytes')
    print(f'Total: {before:,} -> {after:,} bytes ({100 * (1 - after / before):.1f}% smaller)')

if __name__ == '__main__':
    main()
