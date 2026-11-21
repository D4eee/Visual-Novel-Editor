#!/usr/bin/env python3
"""Generates the images of the "Like Human" example game as SVG, then renders PNGs
with rsvg-convert. Run from this folder:  python3 make_images.py <out-dir>"""
import os, random, subprocess, sys

OUT = sys.argv[1] if len(sys.argv) > 1 else 'out'
os.makedirs(OUT, exist_ok=True)
W, H = 1280, 720

def render(name, svg, w=W, h=H):
    src = os.path.join(OUT, name + '.svg')
    open(src, 'w').write(svg)
    subprocess.run(['rsvg-convert', '-w', str(w), '-h', str(h), src, '-o', os.path.join(OUT, name + '.png')], check=True)
    os.remove(src)

def svg(body, w=W, h=H, defs=''):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}"><defs>{defs}</defs>{body}</svg>'

# ---------------------------------------------------------------- backgrounds
def lab():
    r = random.Random(1)
    defs = '''<linearGradient id="wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0d2230"/><stop offset="1" stop-color="#173444"/></linearGradient>
<linearGradient id="floor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1d3a47"/><stop offset="1" stop-color="#0a161d"/></linearGradient>
<radialGradient id="glow" cx=".5" cy=".3" r=".6"><stop offset="0" stop-color="#7ff3ff" stop-opacity=".35"/><stop offset="1" stop-color="#7ff3ff" stop-opacity="0"/></radialGradient>
<linearGradient id="win" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#bff8ff"/><stop offset="1" stop-color="#4fb6c9"/></linearGradient>'''
    b = '<rect width="1280" height="720" fill="url(#wall)"/>'
    b += '<rect x="420" y="70" width="440" height="300" rx="8" fill="url(#win)" opacity=".85"/>'
    b += '<path d="M640 70 V370 M420 220 H860" stroke="#0d2230" stroke-width="10"/>'
    b += '<polygon points="420,370 860,370 1020,720 260,720" fill="#bff8ff" opacity=".07"/>'
    b += '<rect y="470" width="1280" height="250" fill="url(#floor)"/>'
    for i in range(9):
        x = -200 + i * 210
        b += f'<line x1="640" y1="470" x2="{x}" y2="720" stroke="#2c5260" stroke-width="2" opacity=".6"/>'
    for y in (500, 545, 610, 700):
        b += f'<line x1="0" y1="{y}" x2="1280" y2="{y}" stroke="#2c5260" stroke-width="2" opacity=".5"/>'
    # consoles
    for (x, w) in ((40, 300), (940, 300)):
        b += f'<rect x="{x}" y="300" width="{w}" height="190" rx="10" fill="#0a1820" stroke="#2f6b7a" stroke-width="3"/>'
        for k in range(3):
            sx = x + 20 + k * (w - 40) / 3
            b += f'<rect x="{sx:.0f}" y="320" width="{(w-70)/3:.0f}" height="90" rx="6" fill="#06222b" stroke="#49d6e8" stroke-width="2"/>'
            pts = ' '.join(f'{sx+6+j*8:.0f},{365 + r.randint(-25, 25)}' for j in range(int((w - 70) / 3 / 8)))
            b += f'<polyline points="{pts}" fill="none" stroke="#7ff3ff" stroke-width="2" opacity=".9"/>'
        for k in range(8):
            b += f'<circle cx="{x+30+k*34}" cy="450" r="7" fill="{r.choice(["#ff6f9f","#ffd27a","#7ff3ff","#2f6b7a"])}"/>'
    # cables
    b += '<path d="M60 720 C 200 600, 300 690, 420 600" stroke="#081218" stroke-width="16" fill="none"/>'
    b += '<path d="M1240 720 C 1100 640, 980 700, 900 610" stroke="#081218" stroke-width="12" fill="none"/>'
    b += '<rect width="1280" height="720" fill="url(#glow)"/>'
    render('bg_lab', svg(b, defs=defs))

def city(name, sky_top, sky_bottom, window_color, star_alpha, sun=None):
    r = random.Random(7)
    defs = f'''<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{sky_top}"/><stop offset="1" stop-color="{sky_bottom}"/></linearGradient>
<linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".55"/></linearGradient>'''
    b = '<rect width="1280" height="720" fill="url(#sky)"/>'
    for _ in range(140):
        b += f'<circle cx="{r.randint(0,1280)}" cy="{r.randint(0,380)}" r="{r.choice([1,1,1.5,2])}" fill="#fff" opacity="{r.random()*star_alpha:.2f}"/>'
    if sun:
        b += f'<circle cx="980" cy="400" r="120" fill="{sun}" opacity=".9"/><circle cx="980" cy="400" r="210" fill="{sun}" opacity=".18"/>'
    else:
        b += '<circle cx="1040" cy="130" r="54" fill="#f6f1d8"/><circle cx="1062" cy="118" r="50" fill="' + sky_top + '"/>'
    for layer, (base, col, alpha) in enumerate(((420, '#1b2346', .7), (480, '#121833', .9), (540, '#0b0f22', 1))):
        x = -20
        while x < 1300:
            w = r.randint(50, 130); h = r.randint(80, 260) - layer * 30
            b += f'<rect x="{x}" y="{base-h}" width="{w}" height="{h+300}" fill="{col}" opacity="{alpha}"/>'
            for wy in range(base - h + 14, base + 160, 22):
                for wx in range(x + 8, x + w - 10, 16):
                    if r.random() < .28:
                        b += f'<rect x="{wx}" y="{wy}" width="7" height="10" fill="{window_color}" opacity="{.35 + r.random()*.6:.2f}"/>'
            x += w + r.randint(4, 20)
    b += '<rect y="560" width="1280" height="160" fill="#090b16"/>'
    b += '<rect y="600" width="1280" height="12" fill="#2a2f4d"/>'
    for x in range(0, 1300, 64):
        b += f'<rect x="{x}" y="600" width="8" height="120" fill="#2a2f4d"/>'
    b += '<rect width="1280" height="720" fill="url(#fade)"/>'
    render(name, svg(b, defs=defs))

def memory():
    defs = '''<linearGradient id="w" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5b3a2e"/><stop offset="1" stop-color="#2b1b18"/></linearGradient>
<linearGradient id="light" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffd9a0" stop-opacity=".55"/><stop offset="1" stop-color="#ffd9a0" stop-opacity="0"/></linearGradient>'''
    b = '<rect width="1280" height="720" fill="url(#w)"/>'
    b += '<rect x="120" y="80" width="300" height="360" rx="6" fill="#ffcf8a"/><path d="M270 80 V440 M120 260 H420" stroke="#5b3a2e" stroke-width="12"/>'
    b += '<polygon points="120,80 420,80 900,720 300,720" fill="url(#light)"/>'
    for i in range(5):
        y = 120 + i * 90
        b += f'<rect x="820" y="{y}" width="380" height="12" fill="#3a241e"/>'
        x = 830
        r = random.Random(i)
        while x < 1180:
            w = r.randint(14, 30)
            b += f'<rect x="{x}" y="{y-r.randint(50,74)}" width="{w}" height="{80}" fill="{r.choice(["#8c4b3c","#c58f5a","#6d7a5c","#a35d6b","#d9b38c"])}" opacity=".9" transform="translate(0 {-6})"/>'
            x += w + 3
    b += '<rect y="560" width="1280" height="160" fill="#2b1b18"/><ellipse cx="640" cy="660" rx="380" ry="40" fill="#1b100e" opacity=".6"/>'
    b += '<rect x="520" y="470" width="260" height="110" rx="8" fill="#6e4a3a"/><rect x="540" y="580" width="16" height="110" fill="#4a2f26"/><rect x="744" y="580" width="16" height="110" fill="#4a2f26"/>'
    b += '<circle cx="600" cy="455" r="22" fill="#e9e3d8"/><rect x="660" y="430" width="70" height="40" rx="4" fill="#c9b8a0"/>'
    render('bg_memory', svg(b, defs=defs))

def title():
    r = random.Random(3)
    defs = '''<radialGradient id="g" cx=".7" cy=".35" r=".9"><stop offset="0" stop-color="#3b3f8f"/><stop offset=".55" stop-color="#191b3a"/><stop offset="1" stop-color="#0b0c18"/></radialGradient>'''
    b = '<rect width="1280" height="720" fill="url(#g)"/>'
    for _ in range(70):
        x, y = r.randint(0, 1280), r.randint(0, 720)
        b += f'<circle cx="{x}" cy="{y}" r="{r.choice([1,2,3])}" fill="#9fe9ff" opacity="{r.random()*.7:.2f}"/>'
    # a network of nodes (the story graph) fading into a face profile
    pts = [(r.randint(700, 1200), r.randint(120, 600)) for _ in range(22)]
    for i, (x, y) in enumerate(pts):
        for (x2, y2) in pts[i+1:i+3]:
            b += f'<line x1="{x}" y1="{y}" x2="{x2}" y2="{y2}" stroke="#7ff3ff" stroke-width="1.5" opacity=".35"/>'
        b += f'<circle cx="{x}" cy="{y}" r="{r.choice([4,6,8])}" fill="{r.choice(["#7ff3ff","#ff8fb8","#ffd27a"])}" opacity=".85"/>'
    b += '<path d="M 980 720 C 980 600, 900 590, 905 520 C 880 505, 900 480, 890 470 C 870 450, 905 440, 900 425 C 890 380, 870 360, 900 320 C 930 230, 1040 210, 1110 250 C 1190 300, 1200 420, 1150 520 C 1120 580, 1140 650, 1160 720 Z" fill="#0b0c18" opacity=".85"/>'
    render('bg_title', svg(b, defs=defs))

# ---------------------------------------------------------------- characters
def bust(name, skin, hair, hair_shape, outfit, accent, eyes, mouth, brows, extra='', glitch=False):
    w, h = 560, 720
    face = f'''
<path d="M150 720 C 150 600, 200 545, 280 535 C 360 545, 410 600, 410 720 Z" fill="{outfit}"/>
<path d="M245 520 h70 v40 c0 20 -70 20 -70 0 z" fill="{skin}"/>
{hair_shape[0]}
<ellipse cx="280" cy="380" rx="118" ry="140" fill="{skin}"/>
<ellipse cx="166" cy="392" rx="16" ry="26" fill="{skin}"/><ellipse cx="394" cy="392" rx="16" ry="26" fill="{skin}"/>
{hair_shape[1]}
{brows}
{eyes}
<path d="M276 400 q4 22 -6 30" stroke="#000" stroke-opacity=".18" stroke-width="3" fill="none"/>
{mouth}
<ellipse cx="215" cy="440" rx="20" ry="10" fill="{accent}" opacity=".18"/><ellipse cx="345" cy="440" rx="20" ry="10" fill="{accent}" opacity=".18"/>
{extra}'''
    body = face
    if glitch:
        body = f'<g opacity=".55" transform="translate(-10 0)" style="mix-blend-mode:screen"><g fill="#00e5ff">{face}</g></g>' + face + '<g fill="#00e5ff" opacity=".7"><rect x="120" y="300" width="320" height="6"/><rect x="140" y="420" width="300" height="4"/><rect x="100" y="470" width="200" height="8"/></g>'
    render(name, svg(body, w, h), w, h)

def eyes_open(color, lid='#2b1a1a', y=380, size=1.0, sparkle=True):
    s = ''
    for cx in (230, 330):
        s += f'<ellipse cx="{cx}" cy="{y}" rx="{19*size:.0f}" ry="{24*size:.0f}" fill="#fff"/>'
        s += f'<ellipse cx="{cx}" cy="{y+3}" rx="{13*size:.0f}" ry="{18*size:.0f}" fill="{color}"/>'
        s += f'<ellipse cx="{cx}" cy="{y+4}" rx="{6*size:.0f}" ry="{9*size:.0f}" fill="#111"/>'
        if sparkle: s += f'<circle cx="{cx+5}" cy="{y-6}" r="5" fill="#fff"/>'
        s += f'<path d="M{cx-22} {y-14} q22 -22 44 0" stroke="{lid}" stroke-width="6" fill="none" stroke-linecap="round"/>'
    return s

def eyes_smile(lid='#2b1a1a', y=382):
    return ''.join(f'<path d="M{cx-20} {y} q20 -20 40 0" stroke="{lid}" stroke-width="6" fill="none" stroke-linecap="round"/>' for cx in (230, 330))

def brows(color, y=335, tilt=0):
    return ''.join(f'<path d="M{cx-22} {y + (tilt if cx < 280 else -tilt)} q22 -10 44 {(-tilt*2 if cx < 280 else tilt*2)}" stroke="{color}" stroke-width="7" fill="none" stroke-linecap="round"/>' for cx in (230, 330))

MIKA = dict(skin='#f6d3bf', hair='#3a2420', outfit='#f2f2f5', accent='#ff6f9f')
mika_hair = ('<path d="M150 380 C 140 240, 230 200, 290 205 C 380 205, 430 270, 418 390 L 430 520 C 400 540, 380 520, 380 500 L 160 500 C 150 520, 120 530, 128 500 Z" fill="#3a2420"/>',
             '<path d="M164 360 C 170 260, 250 238, 300 250 C 250 270, 230 300, 225 330 C 270 280, 330 270, 400 330 C 400 290, 380 255, 350 240 C 400 255, 420 300, 400 370 C 380 320, 330 300, 300 300 C 250 300, 200 320, 164 360 Z" fill="#3a2420"/>'
             '<path d="M150 330 C 160 250, 220 220, 280 222" stroke="#ff6f9f" stroke-width="10" fill="none"/>'
             '<rect x="138" y="360" width="22" height="70" rx="10" fill="#ff6f9f"/><path d="M150 430 q-10 60 60 70" stroke="#555" stroke-width="5" fill="none"/><circle cx="212" cy="500" r="8" fill="#555"/>')
mika_coat = '<path d="M210 560 L280 640 L350 560 L340 720 L220 720 Z" fill="#cfd5e3"/><path d="M262 600 h36 v120 h-36z" fill="#7a8cc2"/><rect x="330" y="620" width="40" height="8" rx="3" fill="#ff6f9f"/>'

def characters():
    m = MIKA
    bust('mika_neutral', m['skin'], m['hair'], mika_hair, m['outfit'], m['accent'], eyes_open('#6a4b3a'), '<path d="M255 462 q25 10 50 0" stroke="#a0524d" stroke-width="5" fill="none" stroke-linecap="round"/>', brows('#3a2420'), mika_coat)
    bust('mika_smile', m['skin'], m['hair'], mika_hair, m['outfit'], m['accent'], eyes_smile(), '<path d="M248 455 q32 34 64 0 z" fill="#a0524d"/><path d="M256 458 q24 10 48 0" fill="#fff"/>', brows('#3a2420', 330), mika_coat)
    bust('mika_surprised', m['skin'], m['hair'], mika_hair, m['outfit'], m['accent'], eyes_open('#6a4b3a', size=1.12), '<ellipse cx="280" cy="466" rx="14" ry="18" fill="#a0524d"/>', brows('#3a2420', 318, -4), mika_coat)
    bust('mika_sad', m['skin'], m['hair'], mika_hair, m['outfit'], m['accent'], eyes_open('#6a4b3a', y=386, sparkle=False), '<path d="M255 470 q25 -12 50 0" stroke="#a0524d" stroke-width="5" fill="none" stroke-linecap="round"/>', brows('#3a2420', 335, 6), mika_coat)
    seven_hair = ('<path d="M160 370 C 150 250, 230 215, 285 215 C 360 215, 420 260, 405 380 L 400 300 C 360 270, 200 270, 165 310 Z" fill="#e8f2ff"/>',
                  '<path d="M165 340 C 175 255, 245 232, 295 238 C 350 242, 400 270, 402 340 C 380 300, 340 285, 300 290 L 320 320 L 270 292 C 230 295, 190 310, 165 340 Z" fill="#e8f2ff"/>')
    seven_suit = ('<path d="M150 720 C 150 600, 200 560, 280 552 C 360 560, 410 600, 410 720 Z" fill="#1b2140"/>'
                  '<path d="M280 560 V720" stroke="#7ff3ff" stroke-width="4" opacity=".8"/><path d="M200 600 L260 640 M360 600 L300 640" stroke="#7ff3ff" stroke-width="3" opacity=".6"/>'
                  '<path d="M380 400 l20 10 l-6 30" stroke="#7ff3ff" stroke-width="3" fill="none" opacity=".9"/><circle cx="374" cy="398" r="5" fill="#7ff3ff"/>')
    skin = '#e6eaf2'
    mouth = '<path d="M258 462 h44" stroke="#8a90a8" stroke-width="5" stroke-linecap="round"/>'
    bust('seven_neutral', skin, '#e8f2ff', seven_hair, '#1b2140', '#7ff3ff', eyes_open('#29c4e0', lid='#6b7390'), mouth, brows('#c9d6ea'), seven_suit)
    bust('seven_smile', skin, '#e8f2ff', seven_hair, '#1b2140', '#7ff3ff', eyes_open('#29c4e0', lid='#6b7390', size=.95), '<path d="M256 458 q24 16 48 0" stroke="#8a90a8" stroke-width="5" fill="none" stroke-linecap="round"/>', brows('#c9d6ea', 330), seven_suit)
    bust('seven_glitch', skin, '#e8f2ff', seven_hair, '#1b2140', '#7ff3ff', eyes_open('#ff6f9f', lid='#6b7390'), mouth, brows('#c9d6ea', 335, 5), seven_suit, glitch=True)

def icon():
    defs = '<linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3b3f8f"/><stop offset="1" stop-color="#0b0c18"/></linearGradient>'
    b = '<rect x="32" y="32" width="448" height="448" rx="100" fill="url(#g)"/>'
    b += '<path d="M200 140 C 140 150, 120 220, 140 300 C 150 340, 140 370, 150 400 L 260 400 C 250 360, 280 330, 310 320 C 350 310, 360 270, 340 250 C 360 240, 350 220, 335 215 C 345 200, 330 190, 320 180 C 300 150, 250 132, 200 140 Z" fill="#e8f2ff"/>'
    b += '<circle cx="300" cy="215" r="10" fill="#29c4e0"/><path d="M210 190 q-30 60 0 120" stroke="#7ff3ff" stroke-width="6" fill="none"/>'
    b += '<path d="M350 150 c 20 -20 50 -10 50 15 c 0 30 -50 55 -50 55 c 0 0 -50 -25 -50 -55 c 0 -25 30 -35 50 -15z" fill="#ff6f9f" transform="translate(30 0) scale(.8)"/>'
    render('icon', svg(b, 512, 512, defs), 512, 512)

def items():
    # A collectible: an old photo (father in his TV repair room).
    b = '<g transform="rotate(-8 128 128)"><rect x="34" y="28" width="188" height="206" rx="6" fill="#f4efe4" stroke="#c9bfa8" stroke-width="3"/>'
    b += '<rect x="48" y="42" width="160" height="140" fill="#3a2a22"/>'
    b += '<rect x="58" y="96" width="70" height="56" rx="8" fill="#1d1512"/><rect x="66" y="104" width="54" height="40" rx="5" fill="#9fe0d8" opacity=".85"/>'
    b += '<circle cx="168" cy="92" r="17" fill="#d8b49a"/><path d="M140 182 q0 -60 28 -66 q28 6 30 66z" fill="#5d7d9a"/>'
    b += '<rect x="48" y="42" width="160" height="140" fill="#ffcc88" opacity=".18"/>'
    b += '<text x="128" y="214" font-family="Georgia, serif" font-size="17" fill="#6b5d4a" text-anchor="middle" font-style="italic">Dad, 1998</text></g>'
    render('item_photo', svg(b, 256, 256), 256, 256)
    # Three frames of a status light (a sprite).
    for i, (c, g) in enumerate([('#ff5d6c', .35), ('#ffc857', .6), ('#7ff3ff', 1)]):
        b = f'<circle cx="48" cy="48" r="40" fill="{c}" opacity="{g * .25}"/><circle cx="48" cy="48" r="22" fill="#11131c"/><circle cx="48" cy="48" r="16" fill="{c}" opacity="{g}"/><circle cx="43" cy="42" r="5" fill="#fff" opacity=".7"/>'
        render(f'led_{i}', svg(b, 96, 96), 96, 96)

lab()
city('bg_rooftop', '#0b1030', '#3a2f6b', '#ffd27a', .9)
city('bg_dawn', '#ff9a7a', '#ffd9a0', '#fff1cf', .15, sun='#fff3c4')
memory()
title()
characters()
icon()
items()
print('images done')
