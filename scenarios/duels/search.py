"""P1-S09's timing search harness (not run by CI): writes duel fixtures into scenarios/duels/scratch/ (git-ignored), runs
crates/jj-sim/tests/duels.rs on the RCH workers (`rch exec -- cargo test --release -p jj-sim --test duels`), and reads its
`RESULTS` lines back. `run_jobs` takes jobs (name, pose, linvel, variants {label: [(from_s, to_s, input fields)]}, secs,
gate, optional set / solo / ap_all / seed / extra); `multi_opt` runs seeded random search with local refinement over
parameter vectors; `bank` runs the S03 feel bank under a tuning. Use it from a script:
    exec(open('scenarios/duels/search.py').read())
How the committed duels' timings were found is in docs/evidence/P1-S09/search-log.md. After a search, delete
scenarios/duels/scratch/ACTIVE (or the next plain `cargo test` runs the scratch duels, not the committed ones).
"""
import json,subprocess,sys,os,random
os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
HZ=120
def S(x): return None if x is None else round(x*HZ)
def span(car,a,b,**kw):
    d={"car":car,"fromTick":S(a)}
    if b is not None: d["toTick"]=S(b)
    d.update(kw); return d
def run_jobs(jobs):
    """jobs: list of dict(name,pose,linvel,variants,secs,gate,extra,set). Returns name -> label -> result dict."""
    d='scenarios/duels/scratch'
    os.makedirs(d+'/orderings',exist_ok=True)
    for f in os.listdir(d+'/orderings'): os.remove(f'{d}/orderings/{f}')
    for j in jobs:
        labels=list(j['variants']); inputs=[]
        for i,l in enumerate(labels):
            for (a,b,kw) in j['variants'][l]: inputs.append(span(i,a,b,**kw))
        fx={"scenario":j['name'],"what":"scratch","map":"scenarios/duels/yard/duel-yard.json","seed":j.get('seed',91),"ticks":S(j['secs']),
            "cars":j.get('cars') or [{"pose":j['pose'],"linvel":j['linvel']} for _ in labels]}
        if j.get('extra'): fx.update(j['extra'])
        if j.get('ap_all'): fx['autopilot']=[{'tick':0,'car':i,'on':True} for i in range(len(labels))]
        fx["inputs"]=inputs; fx["expect"]=[]
        json.dump(fx,open(f"{d}/{j['name']}.json",'w'))
        json.dump({"duel":j['name'],"fixture":f"{j['name']}.json","gate":j['gate'],"labels":labels,"beats":[],"set":j.get('set',[]),"solo":j.get('solo',False)},open(f"{d}/orderings/{j['name']}.json",'w'))
    open(f'{d}/ACTIVE','w').write('1')
    out=subprocess.run(['rch','exec','--','cargo','test','--release','-p','jj-sim','--test','duels','--','--nocapture'],capture_output=True,text=True)
    out=out.stdout+out.stderr
    open("/tmp/out.txt","w").write(out)
    res={}
    for l in out.replace("\x1b","").splitlines():
        if l.startswith('RESULTS '):
            _,name,rest=l.split(' ',2); r={}
            for item in rest.split(';'):
                lab,g,v,w,mo,pr,lg,lu,at=item.split('|')
                r[lab]=dict(gate=None if g=='None' else float(g[5:-1]),v=float(v),wr=float(w),maxoff=float(mo),prog=float(pr),legal=float(lg),lup=float(lu),air=float(at))
            res[name]=r
    if len(res)<len(jobs): print("missing results",len(res),len(jobs))
    return res
def trial(name,pose,linvel,variants,secs,gate,extra=None,set=None):
    return run_jobs([dict(name=name,pose=pose,linvel=linvel,variants=variants,secs=secs,gate=gate,extra=extra,set=set or [])]).get(name,{})
def show(r):
    for k,v in sorted(r.items(), key=lambda kv:(kv[1]['gate'] is None, kv[1]['gate'] or 0)):
        print(f"{k:34} gate={v['gate']} v={v['v']} wr={v['wr']} off={v['maxoff']} prog={v['prog']} legal={v['legal']} lup={v['lup']} air={v['air']}")

def optimise(name,pose,linvel,build,bounds,secs,gate,n=240,rounds=4,seed=1,extra=None,score=None,verbose=True):
    """Random search then local refinement. build(p)->list of (a,b,kw); bounds: list of (lo,hi). Returns best (score, p)."""
    import random
    rng=random.Random(seed)
    pop=[tuple(rng.uniform(lo,hi) for lo,hi in bounds) for _ in range(n)]
    best=[]
    sig=0.25
    for rd in range(rounds):
        V={f"v{i}":build(p) for i,p in enumerate(pop)}
        r=trial(name,pose,linvel,V,secs,gate,extra)
        sc=[]
        for i,p in enumerate(pop):
            v=r.get(f"v{i}")
            if v is None: continue
            s=score(v) if score else (v['gate'] if v['gate'] else None)
            if s is not None: sc.append((s,p))
        best=sorted(best+sc,key=lambda x:x[0])[:8]
        if verbose: print(name,'round',rd,'valid',len(sc),'best',[round(b[0],3) for b in best[:4]],flush=True)
        if not best: pop=[tuple(rng.uniform(lo,hi) for lo,hi in bounds) for _ in range(n)]; continue
        pop=[]
        for _ in range(n):
            b=rng.choice(best[:4])[1]
            pop.append(tuple(min(hi,max(lo,x+rng.gauss(0,sig*(hi-lo)))) for x,(lo,hi) in zip(b,bounds)))
        sig*=0.6
    return best

def multi_opt(fams,rounds=4,n=200,seed=1,seeds=None,score=None):
    """fams: list of dict(name,pose,linvel,build,bounds,secs,gate,extra,set). seeds: name -> list of param tuples to include in round 0."""
    import random
    rng=random.Random(seed)
    state={f['name']:dict(best=[],sig=0.25,pop=None) for f in fams}
    for f in fams:
        st=state[f['name']]
        st['pop']=list((seeds or {}).get(f['name'],[]))+[tuple(rng.uniform(lo,hi) for lo,hi in f['bounds']) for _ in range(n)]
    for rd in range(rounds):
        jobs=[]
        for f in fams:
            st=state[f['name']]
            V={f"v{i}":f['build'](p) for i,p in enumerate(st['pop'])}
            jobs.append(dict(name=f['name'],pose=f['pose'],linvel=f['linvel'],variants=V,secs=f['secs'],gate=f['gate'],extra=f.get('extra'),set=f.get('set',[]),ap_all=f.get('ap_all',False),solo=f.get('solo',False)))
        res=run_jobs(jobs)
        for f in fams:
            st=state[f['name']]; r=res.get(f['name'],{})
            sc=[]
            for i,p in enumerate(st['pop']):
                v=r.get(f"v{i}")
                if v is None: continue
                s=score(f,v) if score else v['gate']
                if s is not None: sc.append((s,p))
            st['best']=sorted(st['best']+sc,key=lambda x:x[0])[:8]
            print(f['name'],'r',rd,'valid',len(sc),'best',[round(b[0],3) for b in st['best'][:3]],flush=True)
            if not st['best']:
                st['pop']=[tuple(rng.uniform(lo,hi) for lo,hi in f['bounds']) for _ in range(n)]; continue
            pop=list(b[1] for b in st['best'][:3])
            for _ in range(n):
                b=rng.choice(st['best'][:4])[1]
                pop.append(tuple(min(hi,max(lo,x+rng.gauss(0,st['sig']*(hi-lo)))) for x,(lo,hi) in zip(b,f['bounds'])))
            st['pop']=pop; st['sig']*=0.65
    return {k:v['best'] for k,v in state.items()}

def bank(sets):
    d='scenarios/duels/scratch'
    open(f'{d}/BANK','w').write('\n'.join(sets)+'\n')
    # no duel orderings needed: keep a dummy so the duel test passes
    out=subprocess.run(['rch','exec','--','cargo','test','--release','-p','jj-sim','--test','duels','--','--nocapture','the_feel_bank'],capture_output=True,text=True)
    out=out.stdout+out.stderr
    os.remove(f'{d}/BANK')
    bad=[l[5:] for l in out.replace("\x1b","").splitlines() if l.startswith('BANK ')]
    for l in bad: print(l)
    if not bad: print(out[-1500:])
