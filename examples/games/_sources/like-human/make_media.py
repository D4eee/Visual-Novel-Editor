#!/usr/bin/env python3
"""Generates the audio and video of the "Like Human" example (numpy + PIL + ffmpeg).
Run from this folder:  python3 make_media.py <out-dir>"""
import os, subprocess, sys, wave, math, random
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

OUT = sys.argv[1] if len(sys.argv) > 1 else 'out'
os.makedirs(OUT, exist_ok=True)
SR = 44100

def note(n):  # MIDI → Hz
    return 440.0 * 2 ** ((n - 69) / 12)

def env(n, a, r):
    e = np.ones(n)
    a, r = int(a * SR), int(r * SR)
    if a: e[:a] = np.linspace(0, 1, a)
    if r: e[-r:] *= np.linspace(1, 0, r)
    return e

def write(name, x, codec=('-c:a', 'libvorbis', '-q:a', '4'), ext='ogg'):
    x = x / max(1e-6, np.max(np.abs(x))) * 0.8
    tmp = os.path.join(OUT, name + '.wav')
    with wave.open(tmp, 'wb') as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
        st = np.stack([x, np.roll(x, 300)], axis=1) if x.ndim == 1 else x
        w.writeframes((st * 32767).astype('<i2').tobytes())
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', tmp, *codec, os.path.join(OUT, f'{name}.{ext}')], check=True)
    os.remove(tmp)

def pad(chords, bar=4.0, bright=0.25):
    out = np.zeros(int(len(chords) * bar * SR))
    t = np.arange(int(bar * SR)) / SR
    for i, ch in enumerate(chords):
        seg = np.zeros_like(t)
        for n in ch:
            f = note(n)
            for det in (-0.12, 0.0, 0.11):
                ff = f * 2 ** (det / 12)
                seg += np.sin(2 * np.pi * ff * t) + bright * np.sin(2 * np.pi * 2 * ff * t) * 0.5
        seg *= env(len(t), 1.2, 1.2)
        out[i * len(t):(i + 1) * len(t)] += seg
    return out

def arp(chords, bar=4.0, steps=8, octave=12):
    out = np.zeros(int(len(chords) * bar * SR))
    step = bar / steps
    n = int(step * SR)
    t = np.arange(int(step * 2.5 * SR)) / SR
    for i, ch in enumerate(chords):
        seq = [ch[k % len(ch)] + octave for k in range(steps)]
        for s, m in enumerate(seq):
            f = note(m)
            tone = (np.sin(2 * np.pi * f * t) + .3 * np.sin(2 * np.pi * 2 * f * t) + .1 * np.sin(2 * np.pi * 3 * f * t)) * np.exp(-t * 3.2)
            start = int((i * bar + s * step) * SR)
            end = min(len(out), start + len(tone))
            out[start:end] += tone[:end - start] * 0.6
    return out

# Lab: cool, sparse minor pad with soft pulses
lab_chords = [[57, 60, 64], [53, 57, 60], [55, 59, 62], [52, 55, 59]] * 2
lab = pad(lab_chords, 4.0, 0.15) * 0.6 + arp(lab_chords, 4.0, 4, 24) * 0.25
write('bgm_lab', lab)
# City night: warmer progression with an arpeggio
city_chords = [[53, 57, 60, 64], [55, 59, 62, 65], [52, 55, 59, 62], [57, 60, 64, 67]] * 2
city = pad(city_chords, 4.0, 0.3) * 0.5 + arp(city_chords, 4.0, 8, 12) * 0.5
write('bgm_city', city)
# Ending theme: major, brighter
end_chords = [[60, 64, 67], [55, 59, 62], [57, 60, 64], [53, 57, 60]] * 2
ending = pad(end_chords, 4.0, 0.35) * 0.5 + arp(end_chords, 4.0, 8, 12) * 0.5
write('bgm_ending', ending)

# SFX
t = np.arange(int(0.25 * SR)) / SR
write('sfx_beep', np.concatenate([np.sin(2 * np.pi * 1320 * t) * np.exp(-t * 18), np.sin(2 * np.pi * 1760 * t) * np.exp(-t * 18)]))
t = np.arange(int(1.6 * SR)) / SR
write('sfx_chime', sum(np.sin(2 * np.pi * note(m) * t) * np.exp(-t * (2 + k)) for k, m in enumerate([84, 88, 91, 96])))
t = np.arange(int(0.6 * SR)) / SR
rng = np.random.default_rng(1)
glitch = rng.standard_normal(len(t)) * (np.sin(2 * np.pi * 30 * t) > 0) * np.exp(-t * 5) + np.sign(np.sin(2 * np.pi * 220 * t)) * .3 * np.exp(-t * 6)
write('sfx_glitch', glitch)
# rain ambience: filtered noise
n = int(8 * SR)
noise = rng.standard_normal(n)
kernel = np.ones(12) / 12
rain = np.convolve(noise, kernel, mode='same') + rng.standard_normal(n) * .08
fade = int(.5 * SR); rain[:fade] *= np.linspace(0, 1, fade); rain[-fade:] *= np.linspace(1, 0, fade)
write('amb_rain', rain * .5)

# Video: a soft, looping "memory" clip — drifting bokeh lights (VP9/WebM)
frames = os.path.join(OUT, '_frames')
os.makedirs(frames, exist_ok=True)
W, H, FPS, SEC = 640, 360, 24, 6
random.seed(4)
dots = [(random.random() * W, random.random() * H, random.uniform(14, 46), random.choice([(255, 210, 122), (255, 143, 184), (127, 243, 255), (255, 240, 220)]), random.uniform(0, 2 * math.pi)) for _ in range(28)]
for f in range(FPS * SEC):
    p = f / (FPS * SEC)
    img = Image.new('RGB', (W, H), (40, 26, 22))
    layer = Image.new('RGB', (W, H), (0, 0, 0))
    d = ImageDraw.Draw(layer)
    for (x, y, r, col, ph) in dots:
        xx = (x + p * W) % (W + 100) - 50
        yy = y + math.sin(2 * math.pi * p + ph) * 12
        a = 0.5 + 0.5 * math.sin(2 * math.pi * p * 2 + ph)
        c = tuple(int(v * (0.35 + 0.65 * a)) for v in col)
        d.ellipse([xx - r, yy - r, xx + r, yy + r], fill=c)
    layer = layer.filter(ImageFilter.GaussianBlur(6))
    img = Image.blend(img, layer, 0.75)
    img.save(os.path.join(frames, f'{f:04d}.png'))
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-framerate', str(FPS), '-i', os.path.join(frames, '%04d.png'), '-c:v', 'libvpx-vp9', '-b:v', '600k', '-pix_fmt', 'yuv420p', '-an', os.path.join(OUT, 'memory_lights.webm')], check=True)
for fn in os.listdir(frames): os.remove(os.path.join(frames, fn))
os.rmdir(frames)
print('media done')
