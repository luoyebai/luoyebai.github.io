"""Prepare the user-selected Wallpaper Engine video for the website."""
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.cache/media-tools'))
import imageio_ffmpeg

source = Path(r'D:\SteamLibrary\steamapps\workshop\content\431960\3168117211\无BGM.mp4')
ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
common = [ffmpeg, '-y', '-hide_banner', '-loglevel', 'error']
subprocess.run(common + ['-i', str(source), '-map', '0:v:0', '-an',
    '-vf', 'scale=1920:-2,fps=24', '-c:v', 'libx264', '-preset', 'medium',
    '-crf', '26', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    str(ROOT / 'assets/bg/bocchi.mp4')], check=True)
subprocess.run(common + ['-ss', '5', '-i', str(source), '-frames:v', '1',
    '-vf', 'scale=1920:-2', '-q:v', '2', str(ROOT / 'assets/bg/bocchi.jpg')], check=True)
print('Prepared full 20-second muted loop and 1920px poster.')
