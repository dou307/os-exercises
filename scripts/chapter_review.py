"""显式逐题审核输入的校验、映射叠加与可阅读报告。"""
import json
from collections import Counter
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
REVIEW=ROOT/'data/reviews/ch2.json'


def load_review(questions, topics):
    doc=json.loads(REVIEW.read_text(encoding='utf-8'))
    expected={q['id']:q for q in questions if q['chapter']=='ch2'}
    records=doc['questions']
    ids=[r['questionId'] for r in records]
    if len(ids)!=len(set(ids)) or set(ids)!=set(expected):
        raise ValueError('第二章审核表须恰好覆盖 276 个唯一 ID')
    topic_map={t['id']:t for t in topics}
    refs={s['id'] for s in doc['sources']}
    for r in records:
        q=expected[r['questionId']];m=r['mapping'];a=r['answerReview']
        if r['sourceContentHash']!=q['source']['contentHash']:
            raise ValueError(f"{q['id']} 来源已变化，必须重新审核")
        if a['status'] not in ('verified','qualified','disputed') or not a['conclusion'].strip():
            raise ValueError(f"{q['id']} 缺逐题答案复核结论")
        if not m['topicIds'] or not set(m['topicIds'])<=set(m['prerequisiteTopicIds']):
            raise ValueError(f"{q['id']} 前置知识缺少题目知识点")
        if any(t not in topic_map for t in m['prerequisiteTopicIds']):
            raise ValueError(f"{q['id']} 引用了虚构知识点")
        if topic_map[m['topicIds'][0]]['chapterId']!=m['primaryChapterId']:
            raise ValueError(f"{q['id']} 主归属章与首知识点不一致")
        if m['readinessTier'] not in ('later','supplement'):
            raise ValueError('不能由审核动作推断用户学完后续章')
        evidence={e['topicId']:e for e in r['noteEvidence']}
        for t in m['prerequisiteTopicIds']:
            if evidence.get(t)!={'topicId':t,'noteFile':topic_map[t]['noteFile'],'noteLine':topic_map[t]['noteLine']}:
                raise ValueError(f"{q['id']} 笔记定位与实际目录不一致")
        if not set(a['evidenceRefs'])<=refs:
            raise ValueError(f"{q['id']} 证据引用不存在")
        excluded=any(e['scoring']=='excluded' for e in r['errata'])
        if (a['status']=='disputed')!=excluded:
            raise ValueError(f"{q['id']} 争议状态与不计分勘误不一致")
        for e in r['errata']:
            if e['questionId']!=q['id'] or not set(e['evidenceRefs'])<=refs:
                raise ValueError(f"{q['id']} 勘误引用错题或未知证据")
    return doc


def overlay(mappings, doc):
    refs={s['id']:s for s in doc['sources']}
    errata=[]
    for r in doc['questions']:
        a=r['answerReview'];m=r['mapping']
        mappings['byQuestion'][r['questionId']]={
            **m, 'mappingStatus':'reviewed',
            'reviewStatus':'disputed' if a['status']=='disputed' else 'verified',
            'answerReview':{**a,'reviewedAt':doc['reviewedAt']},
            'reviewEvidence':{'noteFiles':list(dict.fromkeys(e['noteFile'] for e in r['noteEvidence'])),
                'noteLocations':r['noteEvidence'],'reviewedAt':doc['reviewedAt'],
                'sourceContentHash':r['sourceContentHash']},
        }
        for e in r['errata']:
            errata.append({**e,'evidenceLinks':[{'title':refs[k]['title'],'url':refs[k]['url']}
                for k in e['evidenceRefs'] if 'url' in refs[k]]})
    mappings['reviewedAt']=doc['reviewedAt']
    mappings['reviewerNote']='来源第一章 88 题与第二章 276 题已逐题复核；来源第三至五章 396 题仍为 systematic，不代表答案已审核。'
    return errata


def render_report(doc, questions, checks):
    byid={q['id']:q for q in questions}
    status=Counter(r['answerReview']['status'] for r in doc['questions'])
    chapter=Counter(r['mapping']['primaryChapterId'] for r in doc['questions'])
    errata=[e for r in doc['questions'] for e in r['errata']]
    rows=[]
    for r in doc['questions']:
        q=byid[r['questionId']];m=r['mapping'];a=r['answerReview']
        esc=lambda s:str(s).replace('|','／').replace('\n',' ')
        rows.append('| '+' | '.join(map(esc,[q['id'],q['source']['originalLabel'],q['originalAnswer'],a['status'],m['primaryChapterId'],', '.join(m['topicIds']),', '.join(m['prerequisiteTopicIds']),a['conclusion']]))+' |')
    lines=[
        '# 来源第二章逐题复核与课程适配', '',
        f"复核日期：{doc['reviewedAt']}。以锁定网页快照为题面依据。这里的来源第二章是进程管理 276 题，**不是课程笔记第 2 章**。",
        '',doc['policy'],'',
        f"- 覆盖 276/276；未发现问题 verified={status['verified']}，附前提或解析勘误 qualified={status['qualified']}，争议 disputed={status['disputed']}。",
        f"- 本章勘误 {len(errata)} 条；{sum(e['scoring']=='excluded' for e in errata)} 条对应题目不计分；其余备注不改原答案。",
        '- 课程归属：'+', '.join(f'第 {k} 章 {v} 题' for k,v in sorted(chapter.items(),key=lambda kv:int(kv[0])))+'。',
        '- 学习进度仍只确认课程第 1 章；没有自动解锁后续章。HRRN 缺笔记条目，5 题标补充；作业接纳术语缺口另列。',
        '- 全库累计 364 道已逐题复核；来源第三至五章的 396 道仍是系统映射，真题年份未权威核实。',
        '', '## 逐题记录', '',
        '答案列始终为原站答案；争议题的修正建议在后文，不以建议替换原始层。详细笔记文件、行号及来源内容哈希见 `data/reviews/ch2.json`。', '',
        '| ID | 来源题号 | 原答案 | 答案结论 | 主归课程章 | 知识点 | 前置知识 | 逐题判断 |',
        '|---|---|---|---|---|---|---|---|',*rows,'','## 勘误与前提','',
    ]
    refs={s['id']:s for s in doc['sources']}
    for r in doc['questions']:
        if not r['errata']:continue
        lines+=['### '+r['questionId'],'']
        for e in r['errata']:
            lines+=[f"**{e['issue']}**（{'不计分' if e['scoring']=='excluded' else '保留原答案'}；{e['kind']}）",'',e['detail'],'']
            if e['suggestedCorrection']:lines+=['修正建议：'+e['suggestedCorrection'],'']
            links=[f"[{refs[k]['title']}]({refs[k]['url']})" for k in e['evidenceRefs'] if 'url' in refs[k]]
            if links:lines+=['原始资料依据：'+'；'.join(links)+'。','']
            if e['checkIds']:lines+=['可复算检查：'+', '.join('`'+c+'`' for c in e['checkIds'])+'。','']
    lines+=['## 独立计算与有限模型检查','',
        '`python -X utf8 scripts/review_ch2_checks.py` 复算题面输入，调度器不读取原答案作为计算依据。',
        '包括单 CPU 调度、作业接纳/CPU 双层选择、每资源独占时间线、银行家全排列和有限 P/V 交错反例；只证明所列输入/模型，不将有限枚举当成任意并发程序的证明。','',
        '| 检查 | 结果（计算值与固定预期比较通过） |','|---|---|']
    for cid,result in checks.items():
        lines.append(f"| `{cid}` | `{json.dumps(result['actual'],ensure_ascii=False)}` |")
    lines+=['','## 练习方式与维护','',
        '按课程 3→4→5→6→7→8 章学习和标记进度后练习。每题先看知识点及未学前置；综合题先写自答，再对照原解析与本地勘误。跨第 9 章的存储布局/页表/换出题先补相关基础。',
        'HRRN 补充题须先掌握 R=1+等待/服务，再按每次调度时的等待重新比较，不把响应比误作静态优先数。',
        '正式审核输入为 `data/reviews/ch2.json`；重跑 `build_mappings.py --write-doc` 校验覆盖/哈希/笔记定位、叠加映射并生成本报告。修改来源后哈希不符会阻止复用旧结论。',
        '争议题仍保留旧作答的选项、首次时间及次数；旧的自动对错只作历史事实，不进入当前对错统计和自动错题清单。',
    ]
    (ROOT/'docs/第二章逐题复核.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
