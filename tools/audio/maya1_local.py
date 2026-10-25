#!/usr/bin/env python3
"""Non-quantized Maya1 on eris; shared GPU lock, CPU offload, private raw cache.

Uses the published Maya1 prompt/token/SNAC format. Backend settings are recorded
separately from the canonical voice description: local inference is not a claim
of byte-identical fal.ai output. No private reference recording is needed.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
from contextlib import ExitStack
import signal
import subprocess
import time

MODEL = 'maya-research/maya1'
REVISION = 'b1b9b38ca9decbfcfd6c98ea93dd502bfd0f9572'
SNAC_MODEL = 'hubertsiuzdak/snac_24khz'
SNAC_REVISION = 'd73ad176a12188fcf4f360ba3bf2c2fbbe8f58ec'
BACKEND = {'name':'local-transformers', 'model':MODEL, 'revision':REVISION,
           'dtype':'float16', 'quantized':False, 'decoder':SNAC_MODEL,
           'decoder_revision':SNAC_REVISION, 'sample_rate':24000,
           'top_p':.9, 'repetition_penalty':1.1, 'max_new_tokens':2048,
           'min_new_tokens':28, 'seed':251025, 'decoder_device':'cpu', 'use_cache':True}


def unpack(tokens):
    levels = [[], [], []]
    for i in range(len(tokens)//7):
        s = [(v-128266) % 4096 for v in tokens[i*7:i*7+7]]
        levels[0].append(s[0]); levels[1].extend([s[1],s[4]])
        levels[2].extend([s[2],s[3],s[5],s[6]])
    return levels


def render(rows, voice, rawdir):
    # Qwen's shared helper sets expandable_segments. On this 8GB Turing card
    # Maya1's full model fits with the default allocator (the isolated probe),
    # while expandable segments OOM during shard loading. Keep this change local.
    os.environ.pop('PYTORCH_CUDA_ALLOC_CONF', None)
    import fcntl
    import gc
    import soundfile as sf
    import torch
    from huggingface_hub import snapshot_download
    from transformers import AutoModelForCausalLM, AutoTokenizer
    from snac import SNAC

    base = Path.home()/'Work/dev/jammers-audio'
    os.environ.setdefault('HF_HOME',str(base/'hf-cache'))
    # Explicit path also works when another module imported HF before HF_HOME.
    cache = Path.home()/'.cache/huggingface/hub'
    # Download outside the exclusive window; no GPU resources are held here.
    model_path = snapshot_download(MODEL,revision=REVISION,cache_dir=cache,
        allow_patterns=['*.safetensors','*.json','tokenizer/*','*.txt','LICENSE*'])
    snac_path = snapshot_download(SNAC_MODEL,revision=SNAC_REVISION,cache_dir=cache)
    os.environ['TOKENIZERS_PARALLELISM']='false'
    config = dict(BACKEND, temperature=voice['recipe']['temperature'],
                  prompt=voice['recipe']['prompt'], recipe_sha256=voice['recipe_sha256'])
    config_hash = hashlib.sha256(json.dumps(config,sort_keys=True).encode()).hexdigest()
    paths = [rawdir/r['id']/config_hash/'raw.wav' for r in rows]
    if all(p.exists() and p.with_suffix('.json').exists() for p in paths):
        return paths, config
    # Pause only after owning the GPU slot; queued jobs must not race restoration.
    with (base/'.gpu.lock').open('a') as lock, ExitStack() as restore:
        print('Waiting for shared GPU slot',flush=True)
        fcntl.flock(lock,fcntl.LOCK_EX)
        previous_handler=signal.getsignal(signal.SIGTERM)
        def terminate(signum, frame):
            raise SystemExit(128+signum)
        signal.signal(signal.SIGTERM,terminate)
        restore.callback(signal.signal,signal.SIGTERM,previous_handler)
        active=subprocess.run(['systemctl','--user','is-active','voxtype.service'],capture_output=True,text=True).stdout.strip()=='active'
        if active:
            subprocess.run(['systemctl','--user','stop','voxtype.service'],check=True)
            restore.callback(subprocess.run,['systemctl','--user','start','voxtype.service'],check=True)
        free,total = torch.cuda.mem_get_info()
        # Leave headroom for KV cache and co-resident desktop/CI processes.
        gpu_budget = max(1024**3,free-384*1024**2)
        print('Loading Maya1 FP16 (native Turing math, no quantization), GPU weight budget',round(gpu_budget/1024**3,2),'GiB; remainder on CPU',flush=True)
        start=time.monotonic()
        model=AutoModelForCausalLM.from_pretrained(model_path,torch_dtype=torch.float16,
            device_map='auto',max_memory={0:gpu_budget,'cpu':'16GiB'},
            attn_implementation='sdpa',trust_remote_code=False)
        tokenizer=AutoTokenizer.from_pretrained(model_path,trust_remote_code=False)
        # Decoder on CPU avoids competing with model weights on the 8GB card.
        decoder=SNAC.from_pretrained(SNAC_MODEL,revision=SNAC_REVISION,cache_dir=cache).eval().to('cpu')
        print('Loaded in',round(time.monotonic()-start,1),'s; device map',model.hf_device_map,flush=True)
        for row,path in zip(rows,paths):
            if path.exists() and path.with_suffix('.json').exists():
                continue
            path.parent.mkdir(parents=True,exist_ok=True)
            torch.manual_seed(BACKEND['seed'])
            d=lambda token:tokenizer.decode([token])
            prompt=d(128259)+tokenizer.bos_token+f'<description="{config["prompt"]}"> {row["text"]}'+d(128009)+d(128260)+d(128261)+d(128257)
            inputs=tokenizer(prompt,return_tensors='pt',add_special_tokens=False)
            device=model.get_input_embeddings().weight.device
            inputs={k:v.to(device) for k,v in inputs.items()}
            t=time.monotonic()
            with torch.inference_mode():
                output=model.generate(**inputs,max_new_tokens=BACKEND['max_new_tokens'],min_new_tokens=28,
                    temperature=config['temperature'],top_p=.9,repetition_penalty=1.1,
                    do_sample=True,use_cache=True,eos_token_id=128258,pad_token_id=tokenizer.pad_token_id)
            tokens=output[0,inputs['input_ids'].shape[1]:].tolist()
            if 128258 not in tokens:
                raise RuntimeError('Missing speech EOS; refusing potentially truncated take: '+row['id'])
            codes=[t for t in tokens[:tokens.index(128258)] if 128266<=t<=156937]
            levels=unpack(codes)
            if not levels[0]:
                raise RuntimeError('No speech frames: '+row['id'])
            with torch.inference_mode():
                tensors=[torch.tensor(level,dtype=torch.long).unsqueeze(0) for level in levels]
                z=decoder.quantizer.from_codes(tensors)
                audio=decoder.decoder(z)[0,0].cpu().numpy()
            if len(audio)>2048:
                audio=audio[2048:]
            sf.write(path,audio,24000,subtype='PCM_16')
            meta={'text':row['text'],'canonical_voice_id':voice['canonical_voice_id'],
                  'recipe_sha256':voice['recipe_sha256'],
                  'backend':config,'backend_sha256':config_hash,'seconds':len(audio)/24000,
                  'generation_s':round(time.monotonic()-t,3),'tokens':len(tokens),'complete_eos':True,
                  'raw_sha256':hashlib.sha256(path.read_bytes()).hexdigest()}
            path.with_suffix('.json').write_text(json.dumps(meta,indent=2)+'\n')
            print('Rendered',row['id'],round(len(audio)/24000,2),'s audio in',meta['generation_s'],'s',flush=True)
        del model,decoder
        gc.collect();torch.cuda.empty_cache()
    return paths,config


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--job',type=Path,required=True)
    parser.add_argument('--config',type=Path,required=True)
    parser.add_argument('--work',type=Path,required=True)
    args=parser.parse_args()
    voice=json.loads(args.config.read_text())
    rows=json.loads(args.job.read_text())['rows']
    paths,backend=render(rows,voice,args.work)
    args.work.mkdir(parents=True,exist_ok=True)
    (args.work/'render-index.json').write_text(json.dumps({'paths':[str(p) for p in paths],'backend':backend},indent=2)+'\n')
