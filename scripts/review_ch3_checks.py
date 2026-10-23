"""第三章：从题面参数独立模拟分区、地址变换、置换和时间，不读取原答案。"""
from collections import deque
from fractions import Fraction as F
from math import ceil


def pages(refs,capacity,policy,initial=()):
    resident=list(initial);last={p:i-len(initial) for i,p in enumerate(initial)}
    loaded=dict(last);referenced={p:0 for p in initial}
    fifo=deque(initial);faults=[];victims=[]
    for i,p in enumerate(refs):
        if policy=='nru':
            # 本检查专用NRU参数：每次引用前清R；只读页M始终0；同类FIFO打破平局。
            referenced={q:0 for q in resident}
        if p not in resident:
            faults.append(i+1)
            if len(resident)==capacity:
                if policy=='fifo':v=fifo.popleft()
                elif policy=='lru':v=min(resident,key=lambda q:last[q])
                elif policy=='opt':
                    def distance(q):
                        try:return refs.index(q,i+1)
                        except ValueError:return float('inf')
                    v=max(resident,key=distance)
                elif policy=='nru':v=min(resident,key=lambda q:(referenced[q],loaded[q]))
                else:raise ValueError(policy)
                resident.remove(v);victims.append(v)
            resident.append(p)
            loaded[p]=i
            if policy=='fifo':fifo.append(p)
        last[p]=i
        referenced[p]=1
    return dict(faults=len(faults),at=faults,victims=victims,resident=resident)


def allocate(holes,size,kind):
    eligible=[(a,n) for a,n in holes if n>=size]
    if not eligible:return None
    chosen=min(eligible,key=(lambda h:h[0]) if kind=='first' else (lambda h:(h[1],h[0])))
    holes.remove(chosen);a,n=chosen
    if n>size:holes.append((a+size,n-size))
    holes.sort()
    return a


def release(holes,address,size):
    merged=[]
    for a,n in sorted(holes+[(address,size)]):
        if merged and sum(merged[-1])==a:
            start,length=merged[-1];merged[-1]=(start,length+n)
        else:merged.append((a,n))
    return merged


def translate(address,size,table):
    p,o=divmod(address,size)
    return table[p]*size+o


def eat(hit,tlb,memory,levels=1):
    return tlb+memory+(1-hit)*levels*memory


def scan_restore():
    free=[32,15,21,41];content={};resident={};used=set();hits=[];lastscan=0
    for p,t in [(1,1),(3,2),(0,4),(0,6),(1,11),(0,13),(2,14)]:
        while lastscan+5<=t:
            for q in list(resident):
                if q not in used:free.append(resident.pop(q))
            used.clear();lastscan+=5
        if p not in resident:
            old=next((f for f in free if content.get(f)==p),None)
            f=old if old is not None else free[0]
            free.remove(f);resident[p]=f;content[f]=p
        used.add(p);hits.append(resident[p])
    return hits


def run_checks():
    out={}
    def check(name,actual,expected):
        assert actual==expected,(name,actual,expected)
        out[name]={'actual':actual,'expected':expected,'ok':True}
    holes=[(180,10),(280,50),(330,60),(410,102)]
    check('best-s1-07',allocate(holes,40,'best'),280)
    holes=release([(180,10),(280,50),(410,102)],330,60)
    check('best-s1-07-coalesced',allocate(holes,40,'best'),410)
    holes=[(0,55)]
    a=allocate(holes,15,'best');allocate(holes,30,'best');holes=release(holes,a,15)
    allocate(holes,8,'best');allocate(holes,6,'best')
    check('best-s1-61',max(n for a,n in holes),9)
    holes=release([(20,40),(500,80),(1000,100),(200,200)],60,140)
    check('coalesce-s1-66',[len(holes),min(holes,key=lambda x:x[1])],[3,(500,80)])
    for kind,expected in [('first',[220,100,None]),('best',[530,100,220])]:
        h=[(100,32),(150,10),(200,5),(220,218),(530,96)]
        check('allocate-s31-01-'+kind,[allocate(h,n,kind) for n in [96,20,200]],expected)
    for kind,expected in [('first',[(290,10),(400,112)]),('best',[(240,60),(450,62)])]:
        h=[(0,512)];a=allocate(h,300,kind);allocate(h,100,kind);h=release(h,a,300)
        for n in [150,50,90]:allocate(h,n,kind)
        check('allocate-s31-02-'+kind,h,expected)
    check('address-s1-08',480*1024+154,491674)
    check('address-s1-16',translate(4097,4096,{1:1}),4097)
    check('address-s1-54',[2**18//1024,2**7,translate(1500,2048,{0:2}),2500//2048],[256,128,5596,1])
    check('address-s1-55',(2**20//256)*1,4096)
    check('levels-s1-57',ceil((48-12)/9),4)
    check('directory-s1-62',2**(16-9),128)
    check('address-s1-68',[(0x20501225>>22)&1023,(0x20501225>>12)&1023],[0x81,0x101])
    check('address-s2-19',2**(32-9),2**23)
    check('address-s2-20',translate(0xA6F,1024,{2:11}),0x2E6F)
    check('address-s31-03',[12*2048+586,4000+586],[25162,4586])
    check('segment-s31-04',[210+430,2350+10,500>=90,1350+400,112>=95,5>=5],[640,2360,True,1750,True,True])
    check('address-s31-05',[translate(0xAC5,1024,{2:4}),0x1AC5//1024,0x3AC5//1024],[0x12C5,6,14])
    check('address-s31-06',[translate(p*4096+o,4096,{0:9,1:0,2:1,3:14}) for p,o in [(0,0),(1,72),(2,1023),(3,99)]],[0x9000,0x48,0x13FF,0xE063])
    check('octal-s31-07',[divmod(int(s,8),64) for s in ['105','217','567','1120','2500']],[(1,5),(2,15),(5,55),(9,16),(21,0)])
    check('bitmap-s31-10',2**26//2**12//8,2048)
    check('pte-s31-11',[2**20*4,0x200000+8*4,0x200000+9*4,0x900000//4096,0x901000],[2**22,0x200020,0x200024,0x900,0x901000])
    check('octal-s32-01',[divmod(int(s,8),32) for s in ['101','204','576']],[(2,1),(4,4),(11,30)])
    check('tlb-s2-14',F(3,4)+F(1,4)*3,F(3,2))
    check('eat-s2-30',[eat(F(85,100),F(1,5),1),eat(F(1,2),F(1,5),1)],[F(135,100),F(17,10)])
    check('eat-s31-08',eat(F(85,100),0,F(15,10)),F(1725,1000))
    check('eat-s32-02',F(8,10)*1+F(18,100)*2+F(2,100)*(20000+2),F(4012,10))
    check('eat-s32-06',1/(F(3,10)*8+F(7,10)*20),F(5,82))
    check('eat-s32-07',[eat(F(98,100),10,100,1),eat(F(98,100),10,100,2),eat(F(95,100),10,100,2)],[112,114,120])
    check('threshold-s32-07',[eat(F(95,100),10,100,2)<120,eat(F(951,1000),10,100,2)<120],[False,True])
    check('levels-s32-13',[3*10+12,4*(15-3)+15,4*(16-3)+16],[42,63,68])
    check('eat-s32-14',F(98,100)*10+F(2,100)*F(9,10)*210+F(2,100)*F(1,10)*(10_000_000+220),F(1000701,50))
    check('fault-s32-15',[10+100+100,10+100+10**8+10+100,10+100,translate(0x1565,4096,{1:0x101})],[210,100000220,110,0x101565])
    check('clock-s32-16',[0x17CA//1024,7*1024+0x17CA%1024,2*1024+0x17CA%1024],[5,0x1FCA,0xBCA])
    check('restore-s32-17',scan_restore(),[32,15,21,21,32,21,41])
    check('directory-s32-18',[1+1024,0x1000000>>22,0x1112048>>22],[1025,4,4])
    va=0x10800000+(1*1024+2)*4
    check('array-s32-21',[va,va>>22,(va>>12)&1023,0x201000+(va>>22)*4,0x301000+((va>>12)&1023)*4],[0x10801008,0x42,1,0x201108,0x301004])
    p=0x12345678>>22;t=0xB8C00000>>22
    check('pte-s32-22',[0xB8C00000+p*4,0x65400000+p*4,0xBAB45678>>22,t,0xB8C00000+t*4,0x65400000>>22,0xBAB45678%(1<<22)],[0xB8C00120,0x65400120,0x2EA,0x2E3,0xB8C00B8C,0x195,0x345678])
    refs=[1,8,1,7,8,2,7,2,1,8,3,8,2,1,3,1,7,1,3,7]
    check('lru-s2-22',pages(refs,4,'lru')['faults'],6)
    refs=[1,2,3,4,1,2,5,1,2,3,4,5]
    check('belady-s2-17',[pages(refs,n,'fifo')['faults'] for n in [3,4]],[9,10])
    # NRU 每次引用前周期清R，所有页只读；同类中按装入时间择最早者，是允许的NRU实例。
    # 每次选择时所有候选均为(0,0)，于是与FIFO相同，是NRU并非栈算法的具体反例。
    check('nru-s2-33',[pages(refs,n,'nru')['faults'] for n in [3,4]],[9,10])
    check('working-set-s2-52',sorted(set([1,3,4,5,6,0,3,2,3,2][-6:])),[0,2,3,6])
    check('faster-disk-s2-40-41',F(1,1+50)>F(1,1+100),True)
    check('fifo-lru-s32-10',all(pages([1,2,1,2],n,'fifo')==pages([1,2,1,2],n,'lru') for n in range(1,5)),True)
    refs=[2,0,2,9,3,4,2,8,2,4,8,4,5,7]
    check('lru-s2-50',pages(refs,4,'lru')['victims'][-1],2)
    refs=[0,1,2,7,0,5,3,5,0,2,7,6]
    check('lru-s2-53',[pages(refs,4,'lru')['faults'],len(pages(refs,4,'lru')['victims'])],[9,5])
    refs=[0,1,2,0,5,1,4,3,0,2,3,2,0]
    check('lru-s2-59',pages(refs,3,'lru',[0,1,2])['faults'],6)
    refs=[4,3,2,1,4,3,5,4,3,2,1,5]
    check('replace-s32-04',[[pages(refs,n,p)['faults'] for n in [3,4]] for p in ['opt','fifo','lru']],[[7,6],[9,10],[10,8]])
    refs=[1,3,2,1,1,3,5,1,3,2,1,5]
    check('replace-s32-08',[pages(refs,n,'lru')['faults'] for n in [3,4]],[6,4])
    refs=[4,0,0,0,2,4,2,1,0,3,2]
    check('replace-s32-09',pages(refs,4,'lru',[1,2,0,3])['faults'],3)
    refs=[(j*128+i)*4//512 for i in range(128) for j in range(128)]
    check('array-s2-12',pages(refs,1,'lru')['faults'],16384)
    refs=[(i*64+j)//128 for j in range(64) for i in range(64)]
    a=[pages(refs,3,p)['faults'] for p in ['lru','fifo','opt']]
    check('array-s2-13',a,[2048,2048,1917])
    for size in [200,100]:
        row=[(i*100+j)//size for i in range(100) for j in range(100)]
        col=[(i*100+j)//size for j in range(100) for i in range(100)]
        result=[pages(row,2,'lru')['faults'],pages(col,2,'lru')['faults'],pages(col,2,'opt')['faults']]
        check('array-s32-12-'+str(size),result,[50,5000,4898] if size==200 else [100,10000,9900])
    return out


if __name__=='__main__':
    import json
    from pathlib import Path
    def encode(x):return str(x) if isinstance(x,F) else x
    checks=run_checks();dest=Path(__file__).resolve().parents[1]/'_work/ch3-review/calculations.json'
    dest.parent.mkdir(exist_ok=True,parents=True)
    dest.write_text(json.dumps(checks,ensure_ascii=False,indent=2,default=encode)+'\n',encoding='utf-8')
    print(len(checks),'组独立检查通过')
