#!/usr/bin/env python3
"""Build the audition page's data and players (Mac). Reads private/p1a01b/{eris/metrics.json, ftts/timings.json}, encodes every clip to
mono AAC (.m4a: plays on iOS Safari, unlike Ogg Opus before 18.4) under art/ui/poc/audio/voice/clips/ (gitignored: audio is never committed),
and writes art/ui/poc/audio/voice/manifest.json. The reference recordings are included as players with the metrics we have for them."""
import json, pathlib, re, subprocess
repo = pathlib.Path(__file__).resolve().parents[3]
priv = repo / "private/p1a01b"; page = repo / "art/ui/poc/audio/voice"; clips = page / "clips"
cues = json.loads((pathlib.Path(__file__).parent / "cues.json").read_text())
cands = {k: {"name": v[0], "instruct": v[1]} for k, v in json.loads((pathlib.Path(__file__).parent / "cands.json").read_text()).items()}
rows = json.loads((priv / "eris/metrics.json").read_text())
timings = json.loads((priv / "ftts/timings.json").read_text())
ref_map = json.loads((priv / "eris/refs/map.json").read_text())
raw_ref = {r["ref"]: r for r in rows if r["group"] == "reference"}

def enc(src, dst):
    dst.parent.mkdir(parents=True, exist_ok=True)
    if True:  # always re-encode so a changed filter or source is never stale
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(src), "-ac", "1", "-af", "loudnorm=I=-20:TP=-2:LRA=11", "-ar", "44100", "-c:a", "aac", "-b:a", "64k", str(dst)], check=True)
    return str(dst.relative_to(page))

def clip(r, label, src_root):
    c = {k: r.get(k) for k in ("speaker_sim", "wer", "spread_semitones", "median_hz", "lufs", "seconds", "heard")}
    c.update(label=label, text=r["text"], src=enc(src_root / r["file"], clips / pathlib.Path(r["file"]).with_suffix(".m4a")))
    if r["engine"].startswith("ftts"): c["render_s"] = timings.get(f"{r['ref']}/{r['cue']}")
    return c

def loud(path):
    out = subprocess.run(["ffmpeg", "-nostats", "-i", str(path), "-af", "ebur128", "-f", "null", "-"], capture_output=True, text=True).stderr
    m = re.findall(r"I:\s+(-?[\d.]+) LUFS", out); return float(m[-1]) if m else None

letters = iter("ABCDEFGHIJKLMNOPQRSTUVWXYZ")
by = lambda **kw: [r for r in rows if all(r[k] == v for k, v in kw.items())]
order = {c: i for i, c in enumerate(cues)}

def ref_block(rid, title, sub, detail):
    r = raw_ref[rid]; letter = next(letters)
    c = clip(r, "REF", priv / "eris")
    if rid == "OWNER": c["text"] = "(the owner's own words)"; c["heard"] = None
    return {"letter": letter, "title": title, "sub": sub, "detail": detail, "clips": [c]}

REFS = {"E4F": ("Current voice: E4f reference", "excited reference behind the 61 P1-A01 clips",
                "Seed-VC F0 conversion of a VoiceDesign read into the owner's timbre (+4 semitones). Transcript: " + (priv / "refs/E4F.txt").read_text().strip()),
        "OWNER": ("Owner reference (ref-B)", "the owner's own calm recording, as used for the warm rows",
                  "Transcript kept private: it is the owner's own words, not for the public page. Metrics were scored against it.")}
groups = []
blocks = [ref_block("E4F", *REFS["E4F"]), ref_block("OWNER", *REFS["OWNER"])]
raw = priv / "refs/OWNER-RAW.m4a"; letter = next(letters)
blocks.append({"letter": letter, "title": "Owner raw recording", "sub": "chris-hq.m4a, the unprocessed source of ref-B",
               "detail": "No transcript on file, so no word-accuracy or similarity number; loudness only.",
               "clips": [{"label": "RAW", "text": "(the owner's own words)", "speaker_sim": None, "wer": None, "spread_semitones": None, "median_hz": None,
                          "lufs": loud(raw), "seconds": None, "src": enc(raw, clips / "refs/OWNER-RAW.m4a")}]})
for rid, cid in sorted(ref_map.items()):
    blocks.append(ref_block(rid, f"Restyle-once reference {rid}", f"VoiceDesign '{cands[cid]['name']}' ({cid}), converted to the owner's timbre",
                            "Read of the phonetically rich passage plus announcer lines, Seed-VC F0 --lift 4. Transcript: " + (priv / "refs/R1.txt").read_text().strip()))
groups.append({"id": "refs", "short": "References", "title": "References", "blurb": "The recordings every clone starts from: today's excited reference, the owner's own, and the two new restyle-once references.", "blocks": blocks})

cb = []
for cid, c in cands.items():
    rs = sorted(by(group="cand", ref=cid), key=lambda r: order[r["cue"]])
    cb.append({"letter": next(letters), "title": f"{cid} {c['name']}", "sub": "VoiceDesign 1.7B, prompt only, no reference audio (eris)", "detail": c["instruct"],
               "clips": [clip(r, str(i + 1), priv / "eris") for i, r in enumerate(rs)]})
groups.append({"id": "prompt", "short": "Prompt only", "title": "Prompt-only candidates", "blurb": "Four written descriptions of a broad Australian excited announcer, each saying the same 8 cues. This answers whether a prompt alone gets there, with no owner timbre.", "blocks": cb})

eb = []
for rid in ["E4F", "OWNER"] + sorted(ref_map):
    for eng, title, sub in (("qwen3-1.7B-bf16-eris", "Qwen3-TTS 1.7B bf16", "eris GPU, the P1-A01 pipeline"), ("ftts-0.6B-int8-mac", "FrankenTTS 0.6B int8", "Mac CPU, ftts say from the enrolled .ftvoice")):
        rs = sorted(by(group="ref", ref=rid, engine=eng), key=lambda r: order[r["cue"]])
        eb.append({"letter": next(letters), "title": f"{rid} on {title}", "sub": sub, "clips": [clip(r, str(i + 1), priv / "eris") for i, r in enumerate(rs)]})
groups.append({"id": "engines", "short": "Engines", "title": "Same reference, two engines", "blurb": "Each reference cloned by the 1.7B bf16 pipeline on eris (left) and by the 0.6B int8 FrankenTTS on the Mac (right), same 8 lines (the eris renders use seed 7; ftts has no sampler seed to set). Hear what the cheap local engine costs.", "blocks": eb})

man = {"lede": "Is there a broad Australian, excited, nasal-drawl announcer we can get by prompt, by restyling the reference once, or by recording again? Every player says one of the same 8 cues. Numbers sit under each clip (measured on the raw renders; the players are level-matched to -20 LUFS so loudness does not bias the comparison).",
       "caveat": "Speaker similarity (cosine to the owner's reference, Qwen speaker encoder), Whisper large-v3 word error rate against the line, pitch spread (10th-90th percentile, semitones) and loudness (integrated LUFS) can reject a broken clip. They cannot judge 'sounds like a broad Australian announcer'. That is your ear's call.",
       "footer": "P1-A01b. Prompt-only and clone renders: eris (Qwen3-TTS 1.7B, bf16). FrankenTTS 0.6B int8: Mac CPU. Metrics: Qwen3-TTS speaker encoder and faster-whisper large-v3 on eris. No full 61-row render has been run; that waits for your pick.",
       "groups": groups}
(page / "manifest.json").write_text(json.dumps(man, indent=1))
print("clips:", sum(len(b["clips"]) for g in groups for b in g["blocks"]), "blocks:", sum(len(g["blocks"]) for g in groups))
