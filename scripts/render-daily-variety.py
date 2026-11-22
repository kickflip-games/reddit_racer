"""Render the validated production-path forecast; requires Pillow, no network.

Usage: python3 scripts/render-daily-variety.py <forecast.json> <output.png>
All geometry, gaps, elevation and driving rhythm come from the candidate code.
"""
import json
import math
import sys
from datetime import date
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

source, destination = map(Path, sys.argv[1:3])
forecast = json.loads(source.read_text())
rows = forecast['rows']
assert len(rows) == 30
assert rows[0]['day'] == '2026-11-23' and rows[-1]['day'] == '2026-12-22'
assert all(r['quality']['valid'] and not r['audit']['generatorFallback'] for r in rows)
assert all(c['upperY']-c['lowerY'] >= 10.55 for r in rows for c in r['crossings'])
W, HEADER, CARD = 720, 245, 550
im = Image.new('RGB', (W, HEADER + CARD * len(rows) + 65), '#edf2ef')
d = ImageDraw.Draw(im)
fontdir = Path('/usr/share/fonts/truetype/dejavu')
font = lambda size, bold=False: ImageFont.truetype(str(fontdir / ('DejaVuSans-Bold.ttf' if bold else 'DejaVuSans.ttf')), size)
ink, muted, orange, green = '#162f35', '#51686a', '#d66a20', '#208866'
text = lambda xy, s, size=24, fill=ink, bold=False: d.text(xy, s, font=font(size, bold), fill=fill)
text((30, 18), 'THE DAILY LAP', 32, bold=True)
text((30, 62), '30-day course forecast', 28)
text((30, 102), 'Nov 23 – Dec 22, 2026 · UTC · t5_kyc33w', 23)
d.rounded_rectangle((30, 140, 690, 180), 8, fill='#fbe3d9')
text((45, 144), 'DRAFT / NOT DEPLOYED · candidate V6', 23, '#9a3e28', True)
text((30, 192), 'Green ▶ start   Orange ▲ gap   Blue → yellow: height', 21)
text((30, 220), 'Bridge casing = upper deck · elevation axes 0–18 m', 20)
names = {'sweeping': 'Fast sweeping', 'switchbacks': 'Long runs + switchbacks', 'technical': 'Compact technical', 'ridge': 'Steep ridge loopbacks', 'crossover': 'Mixed course + small overpass'}

def frame(track, s):
    points = track['samples']
    import bisect
    i = max(0, bisect.bisect_right([p['s'] for p in points], s)-1)
    a, b = points[i], points[(i+1) % len(points)]
    end = b['s'] if i+1 < len(points) else track['totalLength']
    t = (s-a['s'])/(end-a['s'])
    return {k: a[k]+(b[k]-a[k])*t for k in ['x','z','y','tx','tz']}

def tint(y):
    t = min(1, max(0, y/18))
    a, b = (42, 101, 133), (229, 174, 60)
    return tuple(round(x+(z-x)*t) for x,z in zip(a,b))

for i, row in enumerate(rows):
    top = HEADER + i * CARD
    d.rounded_rectangle((16, top+8, 704, top+CARD-4), 16, fill='white')
    track = row['track']; samples = track['samples']; jumps = track.get('jumps', [])
    day = date.fromisoformat(row['day'])
    text((34, top+21), f'{day.strftime("%b")} {day.day:02} · {names[row["family"]]}', 25, bold=True)
    text((34, top+60), f'{track["totalLength"]:.0f} m  ·  peak {row["peakElevation"]:.1f} m  ·  climb {row["ascent"]:.1f} m', 24, muted)
    xmin, xmax = min(p['x'] for p in samples), max(p['x'] for p in samples)
    zmin, zmax = min(p['z'] for p in samples), max(p['z'] for p in samples)
    scale = min(600/(xmax-xmin), 260/(zmax-zmin))
    ox = 360-(xmax+xmin)/2*scale; oz = top+230-(zmax+zmin)/2*scale
    point = lambda p: (ox+p['x']*scale, oz+p['z']*scale)
    boundaries = sorted(set([p['s'] for p in samples]+[track['totalLength']]+[s for j in jumps for s in (j['takeoff'],j['landing'])]))
    for a,b in zip(boundaries, boundaries[1:]):
        if any(j['takeoff'] <= (a+b)/2 < j['landing'] for j in jumps):
            continue  # The actual road stroke is absent across the canonical gap.
        pa,pb = frame(track,a), frame(track,b)
        d.line([point(pa), point(pb)], fill=tint((pa['y']+pb['y'])/2), width=7)
    # Repaint only the actual upper traversal, with a contrasting casing that
    # interrupts the lower stroke. Never draw an ambiguous flat intersection.
    for c in row['crossings']:
        bridge = [frame(track,c['upperS']-14+j) for j in range(29)]
        d.line([point(p) for p in bridge],fill='white',width=15)
        d.line([point(p) for p in bridge],fill=ink,width=11)
        d.line([point(p) for p in bridge],fill=tint(c['upperY']),width=7)
        x,y=point(frame(track,c['upperS']))
        text((x+14,y-27),'OVER',17,ink,True)
    start = frame(track,0); sx,sy = point(start)
    dx,dz = start['tx'],start['tz']
    d.polygon([(sx+dx*13,sy+dz*13),(sx-dx*9-dz*9,sy-dz*9+dx*9),(sx-dx*9+dz*9,sy-dz*9-dx*9)],fill=green,outline='white',width=2)
    for n,j in enumerate(jumps):
        p=frame(track,j['takeoff']);x,y=point(p)
        d.polygon([(x,y-9),(x-8,y+6),(x+8,y+6)],fill=orange)
        text((x+10,y-20),f'J{n+1}',21,orange,True)
    gaplabel = f'{len(jumps)} jump · {jumps[0]["landing"]-jumps[0]["takeoff"]:.0f} m gap' if jumps else '0 jumps · continuous road'
    if row['crossings']: gaplabel += ' · bridge 12 m / underpass 0 m'
    text((34,top+370),gaplabel,23,orange if jumps else muted)
    # Common elevation scale for every date. Gaps are left open here too.
    left,right,bottom,height=85,666,top+468,65
    for elev in (0,9,18):
        y=bottom-elev/18*height
        d.line((left,y,right,y), fill='#dce5e3',width=1)
        text((30,y-11),f'{elev}m',18,muted)
    for a,b in zip(boundaries,boundaries[1:]):
        if any(j['takeoff'] <= (a+b)/2 < j['landing'] for j in jumps):continue
        pa,pb=frame(track,a),frame(track,b)
        d.line((left+a/track['totalLength']*(right-left),bottom-pa['y']/18*height,left+b/track['totalLength']*(right-left),bottom-pb['y']/18*height),fill=tint((pa['y']+pb['y'])/2),width=3)
    # Braking rhythm directly from the winning authoritative input tape.
    replay=row['quality']['fastReplay'];transitions=replay['transitions']
    for k,t in enumerate(transitions):
        end=transitions[k+1]['tick'] if k+1<len(transitions) else replay['endTick']
        x=left+t['tick']/replay['endTick']*(right-left);xe=left+end/replay['endTick']*(right-left)
        d.rectangle((x,top+480,xe,top+488),fill='#477da2' if t['held'] else '#f3b964')
    m=row['quality']['metrics'];text((34,top+501),f'{m["meaningfulLifts"]} lifts · {m["fast"]["seconds"]:.2f} s  |  hold {m["hold"]["seconds"]:.2f} s',23)
text((30,im.height-48),'Production daily seeds · accepted routes · zero reserves',22)
im.save(destination, optimize=True)
assert Image.open(destination).size == (W, HEADER + CARD * 30 + 65)
print(json.dumps({'file':str(destination),'width':im.width,'height':im.height,'rows':len(rows),'bytes':destination.stat().st_size}))

# A separate paired view makes the silhouette/rhythm change inspectable.
comparison = Image.new('RGB', (1120, 80+5*385), '#edf2ef')
d = ImageDraw.Draw(comparison)
text((28,18),'Same public seeds · previous V5 / candidate V6',28,bold=True)
text((28,52),'DRAFT / NOT DEPLOYED · each silhouette fitted independently',19,muted)
for row_index,row in enumerate(rows[:5]):
    top=80+row_index*385
    for column,track in enumerate((row['baseline']['track'],row['track'])):
        left=column*560
        d.rounded_rectangle((left+12,top+8,left+548,top+375),12,fill='white')
        text((left+28,top+18),f'{row["day"]} · {"Previous" if column==0 else row['family'].title()}',20,bold=True)
        points=track['samples']
        xmin,xmax=min(p['x'] for p in points),max(p['x'] for p in points)
        zmin,zmax=min(p['z'] for p in points),max(p['z'] for p in points)
        scale=min(450/(xmax-xmin),235/(zmax-zmin))
        ox=left+280-(xmax+xmin)/2*scale;oz=top+175-(zmax+zmin)/2*scale
        point=lambda p:(ox+p['x']*scale,oz+p['z']*scale)
        jumps=track.get('jumps',[])
        boundaries=sorted(set([p['s'] for p in points]+[track['totalLength']]+[s for j in jumps for s in (j['takeoff'],j['landing'])]))
        for a,b in zip(boundaries,boundaries[1:]):
            if any(j['takeoff']<=(a+b)/2<j['landing'] for j in jumps):continue
            pa,pb=frame(track,a),frame(track,b)
            d.line([point(pa),point(pb)],fill='#829293' if column==0 else tint((pa['y']+pb['y'])/2),width=5)
        if column == 1:
            for c in row['crossings']:
                bridge=[frame(track,c['upperS']-14+j) for j in range(29)]
                d.line([point(p) for p in bridge],fill='white',width=13)
                d.line([point(p) for p in bridge],fill=ink,width=9)
                d.line([point(p) for p in bridge],fill=tint(c['upperY']),width=5)
        sx,sy=point(points[0]);d.ellipse((sx-5,sy-5,sx+5,sy+5),fill=green)
        m=row['baseline']['metrics'] if column==0 else row['quality']['metrics']
        text((left+28,top+306),f'{track["totalLength"]:.0f} m · {m["meaningfulLifts"]} lifts · {m["fast"]["seconds"]:.2f} s',22)
        peak=max(p['y'] for p in points)
        text((left+28,top+337),f'Peak {peak:.1f} m · {len(jumps)} gaps',21,muted)
comparison_path=destination.with_name(destination.stem+'-comparison.png')
comparison.save(comparison_path,optimize=True)
