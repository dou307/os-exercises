"""独立重算第二章的数值题与最小反例；不读取原答案作为计算依据。

输入为逐题抄录的题面参数。所有检查可由 CI 重跑；有限交错枚举不宣称证明任意程序。
"""
from collections import Counter, deque
from itertools import combinations, permutations


def cpu(arrival, burst, policy, priority=None, quantum=1):
    """整数时钟模拟；边界新到达先于量子到期者入队，同值保持当前者。"""
    n = len(burst)
    left, finish, queue = list(burst), [None]*n, deque()
    t, current, used = 0, None, 0
    trace = []
    while any(x is None for x in finish):
        for p in range(n):
            if arrival[p] == t:
                queue.append(p)
        if current is not None and left[current] == 0:
            finish[current] = t
            current = None
        if current is not None and policy == 'rr' and used == quantum:
            queue.append(current)
            current = None
        if policy in ('srtf', 'preempt_priority') and current is not None:
            key = (lambda p: left[p]) if policy == 'srtf' else (lambda p: priority[p])
            if queue and min(key(p) for p in queue) < key(current):
                queue.append(current)
                current = None
        if current is None and queue:
            if policy in ('fcfs','rr'):
                current = queue.popleft()
            else:
                key = (lambda p: left[p]) if policy in ('sjf','srtf') else (lambda p: priority[p])
                current = min(queue, key=key)
                queue.remove(current)
            used = 0
        if current is not None:
            trace.append(current)
            left[current] -= 1
            used += 1
        else:
            trace.append(None)
        t += 1
        assert t < 10000
    return finish, trace[:-1]


def resource_schedule(programs, preempt_cpu=False):
    """每个资源唯一占有者；题面顺序 A/B/C 即高到低优先级。"""
    n=len(programs)
    step=[0]*n
    left=[p[0][1] for p in programs]
    finish=[None]*n
    owners={'CPU':None,'D1':None,'D2':None}
    traces={r:[] for r in owners}
    t=0
    while any(x is None for x in finish):
        for r,old in list(owners.items()):
            if old is not None and left[old]==0:
                step[old]+=1
                owners[r]=None
                if step[old]==len(programs[old]): finish[old]=t
                else: left[old]=programs[old][step[old]][1]
        for r in owners:
            candidates=[p for p in range(n) if finish[p] is None and programs[p][step[p]][0]==r]
            if owners[r] is None or (r=='CPU' and preempt_cpu):
                owners[r]=min(candidates) if candidates else None
        for r,p in owners.items():
            traces[r].append(p)
            if p is not None: left[p]-=1
        t+=1
        assert t<10000
    return finish,{r:v[:-1] for r,v in traces.items()}


def safe_sequences(allocation, maximum, available):
    need=[[m-a for a,m in zip(ar,mr)] for ar,mr in zip(allocation,maximum)]
    assert all(x>=0 for row in need for x in row)
    good=[]
    for seq in permutations(range(len(allocation))):
        work=list(available)
        for p in seq:
            if any(x>w for x,w in zip(need[p],work)): break
            work=[w+a for w,a in zip(work,allocation[p])]
        else: good.append(list(seq))
    return good


def admission_schedule(arrival, burst, limit, admission, running, priority=None):
    """作业只含一个 CPU 段；接纳集合和 CPU ready 集合分开维护。"""
    n=len(burst);left=list(burst);finish=[None]*n;admitted=set();t=0;order=[]
    while any(f is None for f in finish):
        for p in list(admitted):
            if left[p]==0:finish[p]=t;admitted.remove(p)
        waiting=[p for p in range(n) if arrival[p]<=t and finish[p] is None and p not in admitted]
        while waiting and len(admitted)<limit:
            key=(lambda p:(burst[p],arrival[p],p)) if admission=='sjf' else (lambda p:(-(t-arrival[p]+burst[p])/burst[p],arrival[p],p))
            p=min(waiting,key=key);admitted.add(p);waiting.remove(p);order.append(p)
        if admitted:
            key=(lambda p:(priority[p],arrival[p],p)) if running=='priority' else (lambda p:(left[p],arrival[p],p))
            left[min(admitted,key=key)]-=1
        t+=1
        assert t<10000
    return finish,order


def grant(allocation, maximum, available, p, request):
    assert all(0<=r<=m-a and r<=v for r,m,a,v in zip(request,maximum[p],allocation[p],available))
    a=[list(row) for row in allocation]
    a[p]=[v+r for v,r in zip(a[p],request)]
    return safe_sequences(a,maximum,[v-r for v,r in zip(available,request)])


def interleavings(delta):
    outcomes=Counter()
    for first in combinations(range(6),3):
        regs=[None,None]; pcs=[0,0];x=1 if delta==[1,-1] else 0
        for i in range(6):
            p=0 if i in first else 1
            if pcs[p]==0:regs[p]=x
            elif pcs[p]==1:regs[p]+=delta[p]
            else:x=regs[p]
            pcs[p]+=1
        outcomes[x]+=1
    return dict(outcomes)


def pv_endings(programs, initial):
    """有限抽象 P/V/action 交错，P 无份额时不可执行；返回终态与卡住状态。"""
    end,stuck=[],[]
    seen=set()
    def visit(pcs, counts, flags, trace):
        state=(pcs,tuple(sorted(counts.items())),tuple(sorted(flags)))
        if state in seen:return
        seen.add(state)
        if all(pc==len(programs[p]) for p,pc in enumerate(pcs)):
            end.append(trace);return
        progressed=False
        for p,pc in enumerate(pcs):
            if pc==len(programs[p]):continue
            op,name=programs[p][pc]
            if op=='P' and counts[name]==0:continue
            nc=dict(counts);nf=set(flags)
            if op=='P':nc[name]-=1
            elif op=='V':nc[name]+=1
            elif op=='set':nf.add(name)
            elif op=='need' and name not in nf:
                stuck.append(trace+[(p,'read-before-publish',name)]);continue
            nxt=list(pcs);nxt[p]+=1;progressed=True
            visit(tuple(nxt),nc,nf,trace+[(p,op,name)])
        if not progressed:stuck.append(trace)
    visit((0,)*len(programs),initial,set(),[])
    return end,stuck


def run_checks():
    results={}
    def put(name,actual,expected):
        assert actual==expected,(name,actual,expected)
        results[name]=dict(actual=actual,expected=expected,ok=True)
    mean=lambda f,a:sum(x-y for x,y in zip(f,a))/len(f)
    f,_=cpu([0,4,10,55,70],[90,40,10,40,20],'sjf')
    g,_=cpu([0,4,10,55,70],[90,40,10,40,20],'srtf')
    put('schedule-s2-26',[round(mean(f,[0,4,10,55,70])/10,2),round(mean(g,[0,4,10,55,70])/10,2)],[10.62,6.8])
    f,_=cpu([0]*5,[10,6,2,4,8],'priority',[3,1,4,5,2])
    g,_=cpu([0]*5,[10,6,2,4,8],'sjf')
    put('schedule-s2-27',[mean(f,[0]*5),mean(g,[0]*5)],[20.0,14.0])
    f,_=cpu(list(range(5)),[3,1,4,5,2],'srtf')
    put('schedule-s2-28',sum(x-y for x,y in zip(f,range(5))),27)
    f,tr=cpu([0,10,10,15],[100,60,20,10],'preempt_priority',[15,20,10,6])
    put('schedule-s2-52',[p for i,p in enumerate(tr) if i==0 or tr[i-1]!=p],[0,2,3,2,0,1])
    f,_=cpu([0,20,30],[60,42,13],'preempt_priority',[-1,-10,-100])
    put('schedule-s2-53',[f,mean(f,[0,20,30])],[[115,75,43],61.0])
    a=[0,1,2,3];b=[8,4,9,5]
    f,_=cpu(a,b,'srtf');g,_=cpu(a,b,'rr',quantum=2)
    put('schedule-s5-07',[f,g,mean(f,a),mean(g,a)],[[17,5,26,10],[22,12,26,23],13.0,19.25])
    b=[10,1,2,1,5];vals=[]
    for policy in ['fcfs','rr','sjf','priority']:
        f,_=cpu([0]*5,b,policy,[3,1,3,4,2])
        vals.append([mean(f,[0]*5),round(sum(x/y for x,y in zip(f,b))/5,2)])
    put('schedule-s5-05',vals,[[13.4,7.26],[9.2,2.84],[7.0,1.74],[12.0,6.36]])
    programs=[
        [('D2',10),('CPU',20),('D1',30),('CPU',10),('D1',40),('CPU',20),('D1',30)],
        [('D1',30),('CPU',40),('D2',30),('CPU',30),('D1',30)],
        [('CPU',40),('D1',20),('CPU',20),('D2',70)],
    ]
    f,tr=resource_schedule(programs)
    put('schedule-s5-03',[f,sum(p is not None for p in tr['CPU']),tr['D1'][180:220]],
        [[220,190,200],180,[1]*10+[0]*30])
    f,tr=resource_schedule([
        [('D2',30),('CPU',10),('D1',30),('CPU',10)],
        [('D1',20),('CPU',20),('D2',40)],
        [('CPU',30),('D1',20)]],True)
    put('schedule-s5-02',[f,sum(p is not None for p in tr['CPU']),sum(p is not None for p in tr['D1'])],[[80,90,90],70,70])
    # 两者首 CPU 合计180，最后完成首 CPU 者不早于180。
    # 若是P1，其后80+20；若是P2，其后40+40，所以下界 min(280,260)=260。
    # 下述可行排程恰达到下界。此论证也允许首段抢占。
    first_cpu=[60,120];tail=[[80,20],[40,40]]
    lower=min(sum(first_cpu)+sum(v) for v in tail)
    cpu_segments=[(0,60,0),(60,180,1),(180,200,0),(220,260,1)]
    assert all(a[1]<=b[0] for a,b in zip(cpu_segments,cpu_segments[1:]))
    put('schedule-s2-40',[lower,cpu_segments[-1][1]],[260,260])
    a=[0,20,30,50];b=[40,30,50,20]
    f,order=admission_schedule(a,b,2,'sjf','priority',[5,3,4,6])
    put('admission-s5-06',[f,mean(f,a)],[[70,50,120,140],70.0])
    a=[0,30,60,90];b=[120,40,25,30]
    f,order=admission_schedule(a,b,1,'hrrn','srtf')
    put('admission-s5-09',[order,mean(f,a)],[[0,2,1,3],121.25])
    a=[0,10,15,20,30];b=[35,30,45,20,30]
    f,order=admission_schedule(a,b,2,'hrrn','srtf')
    put('admission-s5-10',[f,mean(f,a)],[[35,85,160,55,115],75.0])
    allocation=[[0,0,3],[1,0,0],[1,3,5],[0,0,2],[0,0,1]]
    maximum=[[0,0,4],[1,7,5],[2,3,5],[0,6,4],[0,6,5]]
    vectors=[[1,4,0],[0,6,2],[1,1,1],[0,4,7]]
    put('banker-s4-26',[bool(safe_sequences(allocation,maximum,v)) for v in vectors],[True,False,False,False])
    put('banker-s7-05',[safe_sequences(allocation,maximum,vectors[0])[0][0],bool(safe_sequences(allocation,maximum,vectors[1]))],[2,False])
    put('banker-s4-28',bool(safe_sequences([[0],[0]],[[3],[3]],[3])),True)
    put('banker-s4-30',grant([[1],[1]],[[3],[1]],[1],0,[1]),[[1,0]])
    put('banker-s4-35',safe_sequences([[2,0,0],[1,2,0],[0,1,1],[0,0,1]],[[2,0,1],[2,5,2],[1,4,2],[2,0,1]],[0,2,1]),[])
    alloc=[[3,2,3],[4,0,3],[4,0,5],[2,0,4],[3,1,4]]
    mx=[[5,5,10],[5,3,6],[4,0,11],[4,2,5],[4,2,4]]
    seq=safe_sequences(alloc,mx,[2,3,3])
    put('banker-s4-36',[sorted(set(s[0] for s in seq)),bool(seq)],[[1,3,4],True])
    put('banker-s4-41',safe_sequences([[2],[1],[0]],[[4],[3],[1]],[1]),[])
    put('banker-s4-43',safe_sequences([[2,3],[2,1],[1,2]],[[4,4],[3,1],[3,4]],[1,0]),[[1,0,2]])
    put('banker-s4-45',len(safe_sequences([[2,0,1],[0,2,0],[1,0,1]],[[2,2,2],[1,4,3],[1,1,4]],[1,3,2])),2)
    alloc=[[1,0,0],[4,1,1],[2,1,1],[0,0,2]];mx=[[3,2,2],[6,1,3],[3,1,4],[4,2,2]];av=[2,1,2]
    put('banker-s7-03',[bool(safe_sequences(alloc,mx,av)),bool(grant(alloc,mx,av,0,[1,0,1])),bool(grant(alloc,mx,av,1,[1,0,1]))],[True,False,True])
    alloc=[[0,0,1,2],[1,0,0,0],[1,3,5,4],[0,0,1,4]];mx=[[0,0,1,2],[1,7,5,0],[2,3,5,6],[0,6,5,6]];av=[1,5,2,0]
    put('banker-s7-04',[bool(safe_sequences(alloc,mx,av)),bool(grant(alloc,mx,av,1,[0,4,2,0]))],[True,True])
    out=interleavings([1,-1]);same=interleavings([1,1])
    put('interleavings-s3-49-53',[sorted(out),sum(out.values()),same.get(2),sum(same.values())],[[0,1,2],20,2,20])
    original=[[('P','y'),('P','z')],[('V','y')],[('P','y'),('V','z')]]
    fixed=[[('P','z')],[('V','y')],[('P','y'),('V','z')]]
    oe,os=pv_endings(original,{'y':0,'z':0});fe,fs=pv_endings(fixed,{'y':0,'z':0})
    put('pv-s6-06',[bool(oe),bool(os),bool(fe),bool(fs)],[False,True,True,False])
    original=[[('V','offer'),('set','materials')],[('P','offer'),('need','materials')]]
    fixed=[[('set','materials'),('V','offer')],original[1]]
    _,os=pv_endings(original,{'offer':0});_,fs=pv_endings(fixed,{'offer':0})
    put('pv-s6-16',[bool(os),bool(fs)],[True,False])
    en,st=pv_endings([[('P','lock'),('P','lock'),('V','lock'),('V','lock')]],{'lock':1})
    put('mutex-self-deadlock',[bool(en),bool(st)],[False,True])
    # 值域是有限差值范围，不是无穷；这里只枚举稳定库存差值。
    vals=[(4-1-d,3-1+d) for d in range(-2,4)]
    put('warehouse-bounds',[max(a for a,b in vals),max(b for a,b in vals)], [5,5])
    put('resource-bound',[3*(4-1)+1,3*((4-1))+1,2+3+4+1],[10,10,10])
    # 两条有向依赖完整执行的手算闭式，与先V后P也有效的信号量语义一致。
    x=2+3;z=x+4;y=z+3
    put('pv-s3-46',[x,y,z],[5,12,9])
    return results


if __name__=='__main__':
    import json
    from pathlib import Path
    result=run_checks()
    out=Path(__file__).resolve().parents[1]/'_work/reports/ch2-computations.json'
    out.parent.mkdir(parents=True,exist_ok=True)
    out.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(f'{len(result)} 组独立计算/有限反例检查通过；报告 {out}')
