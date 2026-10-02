#!/usr/bin/env python3
"""Clone a voice with Qwen3-TTS (1.7B Base) and render a cue sheet, keeping the best of N takes.

Runs on the GPU box (eris). The reusable clone prompt (speaker embedding + in-context codec
tokens, i.e. the voice "latents") is built once from a reference clip and its exact transcript,
saved next to the outputs, and reused for every line. Each line gets N seeded candidates, scored by
  * word accuracy: Whisper large-v3 transcript vs the intended text (WER), and
  * speaker similarity: cosine between the candidate's and the reference's speaker embeddings,
and the best take is copied to <out>/best/<cue>.wav. Everything lands in <out>/manifest.json.

Private inputs/outputs (owner voice) must stay outside the repo.

Example:
  python voice_clone.py --ref-wav private/voice/ref-A.wav --ref-text-file private/voice/ref-A.txt \
      --cues cues.tsv --out private/voice/renders/A --candidates 4
"""
import argparse
import json
import pathlib
import re
import shutil
import time

import numpy as np
import soundfile as sf
import torch

MODEL_ID = "Qwen/Qwen3-TTS-12Hz-1.7B-Base"


def load_model(dtype_name):
    """Load at the checkpoint's native precision by default.

    The 1.7B checkpoint ships in bf16, so bf16 *is* full precision: upcasting to fp32 adds no
    information (and needs ~7.7 GB of weights, which doesn't fit an 8 GB card). fp16 can overflow.
    Turing GPUs (sm_75) run bf16 through emulation: slower, numerically fine for offline renders.
    """
    import gc

    from qwen_tts import Qwen3TTSModel

    if dtype_name == "auto":
        bf16_ok = torch.cuda.is_bf16_supported(including_emulation=True)
        order = ["bfloat16"] if bf16_ok else ["float16"]
    else:
        order = [{"bf16": "bfloat16", "fp32": "float32", "fp16": "float16"}[dtype_name]]
    last = None
    for name in order:
        try:
            model = Qwen3TTSModel.from_pretrained(
                MODEL_ID, device_map="cuda:0", dtype=getattr(torch, name), attn_implementation="sdpa"
            )
            return model, name
        except torch.cuda.OutOfMemoryError as exc:
            last = repr(exc)
            gc.collect()
            torch.cuda.empty_cache()
    raise RuntimeError(f"could not load {MODEL_ID} in {order}: {last}")


def words(text):
    return re.findall(r"[a-z0-9']+", text.lower())


def wer(ref, hyp):
    r, h = words(ref), words(hyp)
    d = list(range(len(h) + 1))
    for i in range(1, len(r) + 1):
        prev, d[0] = d[0], i
        for j in range(1, len(h) + 1):
            cur = min(d[j] + 1, d[j - 1] + 1, prev + (r[i - 1] != h[j - 1]))
            prev, d[j] = d[j], cur
    return d[len(h)] / max(1, len(r))


def spk_embedding(model, audio, sr):
    item = model.create_voice_clone_prompt(ref_audio=(audio, sr), x_vector_only_mode=True)[0]
    emb = getattr(item, "ref_spk_embedding", None)
    if emb is None:  # fall back to whatever tensor field the installed version uses
        emb = next(v for v in vars(item).values() if torch.is_tensor(v) and v.dim() <= 2)
    return emb.float().flatten().cpu()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--ref-wav", required=True)
    ap.add_argument("--ref-text-file", required=True)
    ap.add_argument("--cues", required=True, help="TSV: cue_id<TAB>text")
    ap.add_argument("--out", required=True)
    ap.add_argument("--candidates", type=int, default=4)
    ap.add_argument("--dtype", choices=["auto", "bf16", "fp32", "fp16"], default="auto")
    ap.add_argument("--language", default="English")
    args = ap.parse_args()

    out = pathlib.Path(args.out)
    (out / "takes").mkdir(parents=True, exist_ok=True)
    (out / "best").mkdir(exist_ok=True)
    ref_text = pathlib.Path(args.ref_text_file).read_text().strip()
    cues = [line.split("\t", 1) for line in pathlib.Path(args.cues).read_text().splitlines() if "\t" in line]

    t0 = time.time()
    model, dtype = load_model(args.dtype)
    prompt = model.create_voice_clone_prompt(ref_audio=args.ref_wav, ref_text=ref_text)
    torch.save(prompt, out / "voice_prompt.pt")  # the reusable clone "latents"
    ref_audio, ref_sr = sf.read(args.ref_wav)
    ref_emb = spk_embedding(model, ref_audio, ref_sr)

    manifest = {"model": MODEL_ID, "dtype": dtype, "ref_wav": args.ref_wav, "ref_text": ref_text,
                "candidates_per_cue": args.candidates, "cues": []}

    # Phase 1: render every take (and its speaker similarity) with only the TTS model on the GPU.
    # An 8 GB card can't hold the TTS model and Whisper large-v3 at once.
    for cue_id, text in cues:
        takes = []
        for k in range(args.candidates):
            seed = 1000 + k
            torch.manual_seed(seed)
            wavs, sr = model.generate_voice_clone(text=text, language=args.language, voice_clone_prompt=prompt)
            audio = np.asarray(wavs[0], dtype=np.float32)
            path = out / "takes" / f"{cue_id}.s{seed}.wav"
            sf.write(path, audio, sr)
            emb = spk_embedding(model, audio, sr)
            sim = float(torch.nn.functional.cosine_similarity(emb, ref_emb, dim=0))
            takes.append({"seed": seed, "file": str(path), "speaker_sim": round(sim, 4),
                          "seconds": round(len(audio) / sr, 2)})
            print(f"rendered {cue_id} seed {seed} sim {sim:.3f}", flush=True)
        manifest["cues"].append({"cue": cue_id, "text": text, "takes": takes})

    import gc

    del model
    gc.collect()
    torch.cuda.empty_cache()

    # Phase 2: score word accuracy with Whisper large-v3, then keep the best take per cue.
    from faster_whisper import WhisperModel

    asr = WhisperModel("large-v3", device="cuda", compute_type="float16")
    for cue in manifest["cues"]:
        for take in cue["takes"]:
            segs, _ = asr.transcribe(take["file"], language="en", beam_size=5)
            take["heard"] = " ".join(s.text.strip() for s in segs)
            take["wer"] = round(wer(cue["text"], take["heard"]), 3)
            # Word accuracy first (a wrong word is unusable), then voice match.
            take["score"] = round((1.0 - min(take["wer"], 1.0)) * 0.6 + max(take["speaker_sim"], 0.0) * 0.4, 4)
        best = max(cue["takes"], key=lambda t: t["score"])
        cue["best"] = best
        shutil.copyfile(best["file"], out / "best" / f"{cue['cue']}.wav")
        print(f"{cue['cue']:14s} best seed {best['seed']} wer {best['wer']} sim {best['speaker_sim']}", flush=True)

    manifest["elapsed_s"] = round(time.time() - t0, 1)
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print("done", out, "dtype", dtype, "elapsed", manifest["elapsed_s"], "s")


if __name__ == "__main__":
    main()
