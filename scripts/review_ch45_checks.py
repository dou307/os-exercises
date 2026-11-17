"""来源第四、五章的独立整数/有理数复算，不读取题库答案。"""
from fractions import Fraction as F
from math import ceil


def disk_schedule(requests, start, policy, direction=-1, maximum=999):
    pending = list(requests)
    path = [start]
    if policy == 'fcfs':
        path += pending
    elif policy == 'sstf':
        while pending:
            target = min(pending, key=lambda x: (abs(x-path[-1]), pending.index(x)))
            pending.remove(target); path.append(target)
    else:
        before = sorted((x for x in pending if x < start), reverse=True)
        after = sorted(x for x in pending if x >= start)
        near, far = (before, after) if direction < 0 else (after, before)
        path += near
        if far:
            if policy in ('scan', 'cscan'):
                endpoint = 0 if direction < 0 else maximum
                if path[-1] != endpoint: path.append(endpoint)
            if policy == 'cscan':
                path.append(maximum if direction < 0 else 0)
                path += list(reversed(far))
            elif policy == 'clook':
                path += list(reversed(far))
            else:
                path += far
    return {'path': path, 'distance': sum(abs(b-a) for a,b in zip(path,path[1:]))}


def buffered(n, read, copy, compute, slots):
    """设备单通路，CPU复制/计算串行，单用户工作区；系统缓冲在复制结束释放。"""
    buffers = [0] * slots
    disk = cpu = 0
    timeline = []
    for i in range(n):
        slot = i % slots
        rs = max(disk, buffers[slot]); re = rs + read
        cs = max(re, cpu); ce = cs + copy
        pe = ce + compute
        disk = re; cpu = pe; buffers[slot] = ce
        timeline.append([rs,re,cs,ce,pe])
    return {'total': cpu, 'timeline': timeline}


def rotational(layout, read_time, cpu_time, initial=0):
    current = F(initial)
    turn = read_time * len(layout)
    for logical in range(len(layout)):
        phase = layout.index(logical) * read_time + initial
        while phase < current: phase += turn
        current = phase + read_time + cpu_time
    return current


def run_checks(chapter):
    checks = {}
    def put(key, actual, expected):
        assert actual == expected, (key, actual, expected)
        checks[key] = {'ok': True, 'actual': actual}
    if chapter == 'ch4':
        put('index-search', [10000//100//2+100//2, F(100+1,2)*2], [100,101])
        put('directory-means', [F(201,2),F(51,2)+1], [F(201,2),F(53,2)])
        put('linked-record', [(22+4)//5+1,1569//512,5+2], [6,3,7])
        put('fat-underdetermined', [65536*2,131072*3], [131072,393216])
        put('index-data-blocks', 10+4096//4, 1034)
        put('double-index', (1024//4)**2*1024, 64*1024**2)
        put('triple-index', (1024//4)**3*1024,16*1024**3)
        put('mixed-2010', (4+2*64+64**2)*256,1057*1024)
        put('mixed-offsets', [1234//1024,307400//1024], [1,300])
        put('permission-bits', 4*5,20)
        put('cluster-rounding', ceil(1026/1024)*1024,2048)
        put('bitmap-volume', ceil((10*1024**3//4096)/8/4096),80)
        put('bitmap-location', [32+409612//8192,409612%8192//8,409612%8], [82,1,4])
        put('bitmap-frames', 16*1024**3//4096//8,512*1024)
        put('directory-split', [F(8*sum(range(1,32))+6*32,254), F(51*sum(range(2,6))+50*6,254)], [F(4160,254),F(1014,254)])
        put('address-width-vs-slots', [10+256+256**2+256**3,2**16], [16843018,65536])
        put('file-path', [5+598//2,5+1], [304,6])
        put('fat-packed', [540*1024*20//8,540*1024*3], [1350*1024,1620*1024])
        put('mixed-capacity', (10+1024+1024**2+1024**3)*4096, 40*1024+4*1024**2+4*1024**3+4*1024**4)
        remaining = 2*1024**3//4096-10-1024
        put('two-gib-index-blocks', 1+1+ceil(remaining/1024),513)
        put('insertion', [2*29+1,29+2], [59,31])
        put('fat-16bit', [2**16*2,2**16*4096], [128*1024,256*1024**2])
        put('extent-count-boundary', [(2**16-1)*1024+84*1024,2**16*1024+84*1024], [67193856,67194880])
        put('image-inode-bound', min(2**20*4096//64,512*2**20//ceil(5600/4096)),64*2**20)
        put('six-mib-blocks', 6*1024**2//4096,1536)
        put('bitmap-geometry', [100*20*8,100*16*4//32,(18-1)*32+16,(18-1)*32+15], [16000,200,560,559])
    elif chapter == 'ch5':
        put('printer-interrupt', F(50*80*6,60)*F(50,10**6),F(1,50))
        put('single-steady',max(80,30)+40,120)
        put('double-steady',max(80,20+50),80)
        put('ten-single',buffered(10,100,50,50,1)['total'],1550)
        put('ten-double',buffered(10,100,50,50,2)['total'],1100)
        put('two-single',buffered(2,100,5,90,1)['total'],300)
        put('four-double',buffered(4,80,20,50,2)['total'],390)
        put('chs-linear',78*64+6*8+6,5046)
        put('sector-ms',F(60000,3000*10),2)
        put('rate-kib',F(7200*160*512,60*1024),9600)
        put('sstf-248',disk_schedule([55,58,39,18,90,160,150,38,184],100,'sstf')['distance'],248)
        req=[164,845,911,165,788,432,396,700,25]
        put('scan-1239',disk_schedule(req,734,'scan',1,999)['distance'],1239)
        put('sstf-1131',disk_schedule(req,734,'sstf')['distance'],1131)
        put('tape', [F(80,400)*3000+F(4,10)*3000,F(80,400)/(F(80,400)+F(4,10))],[1800,F(1,3)])
        put('scan-325',disk_schedule([130,42,180,15,199],58,'scan',1,199)['distance'],325)
        put('sstf-41',disk_schedule([184,187,176,182,199],184,'sstf')['distance'],41)
        put('cscan-788',disk_schedule([300,120,110,0,160,210,399],200,'cscan',-1,399)['distance'],788)
        put('clock-interrupt',F(60*2,1000),F(12,100))
        put('modem-interrupt',F(56000,10)*F(1,10000),F(56,100))
        put('logical-chs',[3468//64,3468%64//8,3468%8],[54,1,4])
        put('sequential-rotation',rotational(list(range(9)),F(3),F(2)),245)
        put('interleaved-rotation',rotational([0,5,1,6,2,7,3,8,4],F(3),F(2)),53)
        req=[123,874,692,475,105,376]
        expected=[2013,1298,1219,1009,1967,1507]
        for policy,exp in zip(['fcfs','sstf','scan','look','cscan','clook'],expected):
            put('six-'+policy,disk_schedule(req,345,policy)['distance'],exp)
        put('defrag',[100*(13*6+100+25),100*(2*6+100+25)],[20300,13700])
        t=rotational([0,3,6,1,4,7,2,5],F(5,2),F(5),F(10))
        put('serial-controller',t,70)
        put('throughput-unit',[F(4096*1000,70*1024),F(4096,70)],[F(400,7),F(2048,35)])
        put('clook-2010',disk_schedule([50,90,30,120],100,'clook',1)['distance'],170)
        put('cscan-needs-endpoint',disk_schedule([50,90,30,120],100,'cscan',1,199)['distance'],388)
        put('geometry-2019',[300*10*200*512,100530//1000,100530%1000//100,(100530%100)*2],[307200000,100,5,60])
        put('geometry-sstf',disk_schedule([100,60,101,110],85,'sstf')['path'][1:],[100,101,110,60])
    else:
        raise ValueError(chapter)
    return checks


if __name__ == '__main__':
    import json
    from pathlib import Path
    report={ch:run_checks(ch) for ch in ['ch4','ch5']}
    p=Path(__file__).resolve().parents[1]/'_work/finalization/calculations.json'
    p.parent.mkdir(parents=True,exist_ok=True)
    p.write_text(json.dumps(report,ensure_ascii=False,indent=1,default=str),encoding='utf-8')
    print({ch:len(v) for ch,v in report.items()})
