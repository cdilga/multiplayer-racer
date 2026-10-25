#!/usr/bin/env python3
"""Edit the owner-selected Aussie Maya1 v1 narration and staged real-host captures."""
import argparse, hashlib, json, subprocess, tempfile
from pathlib import Path
from fontTools.ttLib import TTFont
ROOT=Path(__file__).resolve().parents[2]
def run(args): subprocess.run(args,check=True)
def seconds(p): return float(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',str(p)]))
def digest(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def stamp(t):
 m=round(t*1000);return f'{m//3600000:02}:{m//60000%60:02}:{m//1000%60:02}.{m%1000:03}'
def encode(inputs,filters,dest,dur):
 run(['ffmpeg','-y','-loglevel','error',*inputs,'-vf',filters,'-t',str(dur),'-r','30','-an','-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p',str(dest)])
def main():
 ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--captures',type=Path,required=True);ap.add_argument('--roster',type=Path,default=Path('/tmp/jj-promo-roster'));ap.add_argument('--roads',type=Path,default=Path('/tmp/jj-promo3'));ap.add_argument('--engine',type=Path,default=Path('/tmp/jj-promo-engine.wav'));ap.add_argument('--silent-preview',action='store_true',help='Review pictures with silent placeholders in /tmp; never overwrite website media');args=ap.parse_args()
 out=Path('/tmp/jj-promo-silent-preview') if args.silent_preview else ROOT/'assets/promo';out.mkdir(parents=True,exist_ok=True)
 evidence=out if args.silent_preview else ROOT/'docs/evidence/P1-PROMO2';evidence.mkdir(parents=True,exist_ok=True)
 if args.silent_preview:
  manifest={'canonical_voice_id':None,'rows':json.loads((ROOT/'tools/promo/voice-job.json').read_text())['rows']}
 else:
  manifest=json.loads((ROOT/'assets/audio/voice/promo-manifest.json').read_text());assert manifest.get('canonical_voice_id')=='aussie-maya1-v1','Owner selected Aussie Maya1 v1; refuse legacy voice';assert manifest['summary']['fail']==0
 rows=manifest['rows'];assert len(rows)==11
 capture=json.loads((args.captures/'capture.json').read_text());result=capture['result'];winner=min(result['results'],key=lambda r:r['place']);seat=next(s for s in result['seats'] if s['number']==winner['number']);damage=seat['derby']['points']
 titles=['THE WHOLE MOB ROCKED UP.','NO PLAYER CAP.','BRING WHAT YOU HAVE.','SAME WI-FI? TOO EASY.','PICK YOUR PRIDE AND JOY.','YOU LITTLE BEAUTIES.','THAT WILL BUFF RIGHT OUT.','RACE. DERBY. REMATCH.','ABSOLUTE BEDLAM.',f'{winner["name"].upper()} TAKES THE WIN.','JOYSTICK JAMMERS']
 labels=['WE BUILT A PARTY RACER. THE PARTY GOT OUT OF HAND.','64-CAR GAMEPLAY SAMPLE / KEEP INVITING MATES','PHONES / GAMEPADS ON PHONES OR LAPTOPS / KEYBOARDS','DIRECT LOCAL CONNECTIONS WHEN THE NETWORK ALLOWS','CRUZ MISSILE / AU HAWK / TRADIE UTE / LION PRESIDENT','PIG CATCHER / POSTIE BIKE / HAWK DASH','ONE SHARED SCREEN. A MASSIVE PILEUP.','DIRT / TOWN / ROCKS / BITUMEN / UNREASONABLE AIRTIME','BOOMERANGS / TAKEDOWNS / LOOSE BODYWORK',f'64-CAR DERBY / {damage:.0f} DAMAGE POINTS / ACTUAL ROUND RESULT','BRING EVERYONE. PLAY IN YOUR BROWSER.']
 timeline=[];t=0
 with tempfile.TemporaryDirectory(prefix='jj-promo-edit-') as td:
  tmp=Path(td);fonts={}
  for name in ['barlow-condensed-900-italic','barlow-semi-condensed-700','barlow-semi-condensed-600']:
   font=TTFont(ROOT/f'art/ui/fonts/{name}.woff2');font.flavor=None;fonts[name]=tmp/f'{name}.ttf';font.save(fonts[name])
  # Cold open on carnage, then the real lobby filling. The first frame is gameplay.
  encode(['-i',str(args.captures/'pileup.mp4')],'scale=1280:720,setsar=1',tmp/'cold.mp4',1.7)
  encode(['-i',str(args.captures/'joining.mp4')],'scale=1120:630,pad=1280:720:80:65:color=0x15203A,setsar=1',tmp/'join.mp4',8)
  (tmp/'opening.txt').write_text(f"file '{tmp}/cold.mp4'\nfile '{tmp}/join.mp4'\n")
  run(['ffmpeg','-y','-loglevel','error','-f','concat','-safe','0','-i',str(tmp/'opening.txt'),'-c','copy',str(tmp/'opening.mp4')])
  # Show the actual controller pages, with editorial labels instead of invented device mockups.
  for n,(file,label) in enumerate([('controller-phone.jpg','PHONE TOUCHSCREEN'),('controller-pad-phone.jpg','GAMEPAD CONNECTED TO A PHONE'),('controller-keyboard.jpg','LAPTOP KEYBOARD / GAMEPAD HUB')]):
   labelpath=tmp/f'controller-{n}.txt';labelpath.write_text(label)
   vf=f'scale=1100:500:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2+35:color=0x15203A,drawtext=fontfile={fonts["barlow-semi-condensed-700"]}:textfile={labelpath}:fontsize=28:fontcolor=0xF5B841:x=(w-tw)/2:y=628,setsar=1'
   encode(['-loop','1','-i',str(args.captures/file)],vf,tmp/f'controller{n}.mp4',2.7)
  (tmp/'controllers.txt').write_text(''.join(f"file '{tmp}/controller{n}.mp4'\n" for n in range(3)))
  run(['ffmpeg','-y','-loglevel','error','-f','concat','-safe','0','-i',str(tmp/'controllers.txt'),'-c','copy',str(tmp/'controllers.mp4')])
  # Editorial winner card from the actual round's complete result data. Highlights can replace the game's card,
  # so never assume a fixed crop of that animated screen contains the winner.
  winnerpath=tmp/'winner-name.txt';winnerpath.write_text(f'#{winner["number"]}  {winner["name"].upper()}')
  vf=(f'eq=brightness=-0.18,drawbox=x=286:y=206:w=708:h=308:color=0x15203A:t=fill,'
      'drawbox=x=294:y=214:w=692:h=292:color=0xFFF4DA:t=fill,'
      f'drawtext=fontfile={fonts["barlow-semi-condensed-700"]}:text=DERBY WINNER:fontsize=34:fontcolor=0x15203A:x=(w-tw)/2:y=240,'
      f'drawtext=fontfile={fonts["barlow-condensed-900-italic"]}:textfile={winnerpath}:fontsize=82:fontcolor=0x15203A:x=(w-tw)/2:y=300,'
      f'drawtext=fontfile={fonts["barlow-semi-condensed-700"]}:text={damage:.0f} DAMAGE POINTS:fontsize=32:fontcolor=0x15203A:x=(w-tw)/2:y=420')
  encode(['-stream_loop','-1','-i',str(args.captures/'derby.mp4')],vf,tmp/'winner.mp4',8)
  names={v['id']:v['name'] for v in json.loads((ROOT/'web/shared/src/roster.json').read_text())['cars']}
  groups=[['cruz-missile','au-hawk','tradie-ute','lion-president'],['pig-catcher','postie-bike','hawk-dash','cruz-missile']]
  for g,ids in enumerate(groups):
   ins=[];filters=[]
   for k,id in enumerate(ids):
    ins+=['-stream_loop','-1','-i',str(args.roster/(id+'.mp4'))]
    labelpath=tmp/f'car-{g}-{k}.txt';labelpath.write_text(names[id].upper())
    filters.append(f'[{k}:v]scale=640:360,crop=640:270:0:90,drawbox=x=0:y=0:w=iw:h=40:color=0x15203A@0.8:t=fill,drawtext=fontfile={fonts["barlow-semi-condensed-700"]}:textfile={labelpath}:fontsize=24:fontcolor=0xF5B841:x=16:y=6[c{k}]')
   filters.append('[c0][c1][c2][c3]xstack=inputs=4:layout=0_0|640_0|0_270|640_270,pad=1280:720:0:130:color=0x15203A[v]')
   run(['ffmpeg','-y','-loglevel','error',*ins,'-filter_complex',';'.join(filters),'-map','[v]','-t','10','-an','-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p',str(tmp/f'roster{g}.mp4')])
  for k,(shot,dur) in enumerate([('jump',2),('dirt',1.7),('town',1.7),('rocks',1.7),('rivals',1.7)]):
   encode(['-i',str(args.roads/(shot+'.mp4'))],'scale=1280:720,setsar=1',tmp/f'road{k}.mp4',dur)
  (tmp/'roads.txt').write_text(''.join(f"file '{tmp}/road{k}.mp4'\n" for k in range(5)))
  run(['ffmpeg','-y','-loglevel','error','-f','concat','-safe','0','-i',str(tmp/'roads.txt'),'-c','copy',str(tmp/'roads.mp4')])
  sources=[tmp/'opening.mp4',args.captures/'crowd.mp4',tmp/'controllers.mp4',tmp/'controller0.mp4',tmp/'roster0.mp4',tmp/'roster1.mp4',args.captures/'pileup.mp4',tmp/'roads.mp4',args.captures/'derby.mp4',tmp/'winner.mp4',args.captures/'pileup.mp4']
  for i,(row,src,title,label) in enumerate(zip(rows,sources,titles,labels)):
   if args.silent_preview:
    voice=tmp/f'silent-{i}.wav';run(['ffmpeg','-y','-v','error','-f','lavfi','-i','anullsrc=r=48000:cl=mono','-t',str(len(row['text'].split())/2.8),str(voice)])
   else:
    voice=ROOT/'assets/audio/voice'/row['file'];assert digest(voice)==row['sha256']
   dur=round((seconds(voice)+(2 if i==10 else .8))*30)/30
   if i==7: dur=max(dur,8.8) # Keep every biome in the montage, even if the spoken line is brief.
   titlepath=tmp/f'title{i}.txt';titlepath.write_text(title);labelpath=tmp/f'label{i}.txt';labelpath.write_text(label)
   vf=(f'scale=1280:720,setsar=1,drawbox=x=0:y=0:w=iw:h=130:color=0x15203A@0.92:t=fill,'
       f'drawtext=fontfile={fonts["barlow-condensed-900-italic"]}:textfile={titlepath}:fontsize=58:fontcolor=0xFFF4DA:x=36:y=18,'
       f'drawtext=fontfile={fonts["barlow-semi-condensed-700"]}:textfile={labelpath}:fontsize=22:fontcolor=0xF5B841:x=38:y=86,'
       'drawbox=x=0:y=680:w=iw:h=40:color=0x15203A@0.94:t=fill,'
       f'drawtext=fontfile={fonts["barlow-semi-condensed-600"]}:text=WORK IN PROGRESS / STAGED GAMEPLAY / JAMMERS.DILGER.DEV:fontsize=18:fontcolor=0xFFF4DA:x=36:y=691')
   if i==10:
    vf=(f'scale=1280:720,setsar=1,drawbox=x=0:y=0:w=iw:h=ih:color=0x15203A@0.92:t=fill,'
        f'drawtext=fontfile={fonts["barlow-condensed-900-italic"]}:text=JOYSTICK JAMMERS:fontsize=106:fontcolor=0xFFF4DA:x=(w-tw)/2:y=150,'
        f'drawtext=fontfile={fonts["barlow-semi-condensed-700"]}:text=BRING EVERYONE.:fontsize=44:fontcolor=0xF5B841:x=(w-tw)/2:y=292,'
        f'drawtext=fontfile={fonts["barlow-condensed-900-italic"]}:text=JAMMERS.DILGER.DEV:fontsize=86:fontcolor=0xFFF4DA:x=(w-tw)/2:y=400,'
        f'drawtext=fontfile={fonts["barlow-semi-condensed-600"]}:text=OPEN A BROWSER. HOST A ROOM. JOIN THE CARNAGE.:fontsize=29:fontcolor=0xF5B841:x=(w-tw)/2:y=520')
   run(['ffmpeg','-y','-loglevel','error','-stream_loop','-1','-i',str(src),'-i',str(voice),'-t',str(dur),'-vf',vf,'-af','adelay=200|200,apad','-r','30','-c:v','libx264','-preset','fast','-crf','19','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-ar','48000','-ac','2',str(tmp/f'{i}.mp4')])
   timeline.append({'start':round(t,3),'seconds':dur,'source':str(src) if not str(src).startswith(td) else src.name,'voice':row.get('file'),'text':row['text'],'title':title,'label':label});t+=dur
  (tmp/'concat.txt').write_text(''.join(f"file '{tmp}/{i}.mp4'\n" for i in range(11)))
  run(['ffmpeg','-y','-loglevel','error','-f','concat','-safe','0','-i',str(tmp/'concat.txt'),'-c','copy',str(tmp/'joined.mp4')])
  graph=(f'[0:a]asplit=2[voice][key];[1:a]volume=0.28,afade=t=out:st={t-2}:d=2[music];[music][key]sidechaincompress=threshold=0.025:ratio=10:attack=10:release=300[ducked];[2:a]volume=0.20,afade=t=out:st={t-3}:d=1[engine];[voice][ducked][engine]amix=inputs=3:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11[mix]')
  run(['ffmpeg','-y','-loglevel','error','-i',str(tmp/'joined.mp4'),'-stream_loop','-1','-i',str(ROOT/'assets/audio/music/race-2.ogg'),'-stream_loop','-1','-i',str(args.engine),'-filter_complex',graph,'-map','0:v','-map','[mix]','-t',str(t),'-c:v','copy','-c:a','aac','-b:a','192k','-ar','48000','-movflags','+faststart',str(out/'bring-your-friends.mp4')])
  run(['ffmpeg','-y','-loglevel','error','-ss','0.8','-i',str(out/'bring-your-friends.mp4'),'-frames:v','1','-update','1','-q:v','2',str(out/'bring-your-friends.jpg')])
 cues=['WEBVTT','']
 for line in timeline:
  words=line['text'].split();mid=len(words)//2;cues.extend([f'{stamp(line["start"]+.2)} --> {stamp(line["start"]+line["seconds"]-.3)}',' '.join(words[:mid]),' '.join(words[mid:]),''])
 (out/'bring-your-friends.vtt').write_text('\n'.join(cues))
 (evidence/'timeline.json').write_text(json.dumps({'seconds':round(t,3),'fps':30,'size':[1280,720],'canonical_voice_id':manifest['canonical_voice_id'],'timeline':timeline,'winner':winner,'damage_points':damage,'video_sha256':digest(out/'bring-your-friends.mp4'),'music_sha256':digest(ROOT/'assets/audio/music/race-2.ogg'),'engine_sha256':digest(args.engine),'audio_note':'Editorial mix: Maya1 voice, ducked race-2 score, committed Jammers engine/SFX lap bed. Effects are not telemetry-synchronised.'},indent=2)+'\n');print(f'Rendered {t:.2f}s')
if __name__=='__main__':main()
