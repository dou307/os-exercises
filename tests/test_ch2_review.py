import copy
import json
import sys
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
from chapter_review import load_review, overlay
from review_ch2_checks import run_checks, resource_schedule, cpu, safe_sequences, pv_endings


class ChapterTwoReview(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.questions=json.loads((ROOT/'data/questions.json').read_text(encoding='utf-8'))['questions']
        cls.topics=json.loads((ROOT/'data/topics.json').read_text(encoding='utf-8'))['topics']

    def test_full_review_and_exclusion_policy(self):
        doc=load_review(self.questions,self.topics)
        self.assertEqual(len(doc['questions']),276)
        out={'byQuestion':{}}
        errors=overlay(out,doc)
        excluded={e['questionId'] for e in errors if e['scoring']=='excluded'}
        disputed={qid for qid,m in out['byQuestion'].items() if m['reviewStatus']=='disputed'}
        self.assertEqual(excluded,disputed)
        self.assertEqual(len(disputed),23)
        self.assertTrue(all(m['mappingStatus']=='reviewed' for m in out['byQuestion'].values()))
        self.assertEqual(out['byQuestion']['c2-s5-0-q001']['primaryChapterId'],'3')
        self.assertEqual(out['byQuestion']['c2-s1-0-q070']['primaryChapterId'],'2')
        self.assertEqual(out['byQuestion']['c2-s2-0-q021']['readinessTier'],'supplement')

    def test_source_drift_blocks_reuse_of_review(self):
        changed=copy.deepcopy(self.questions)
        next(q for q in changed if q['chapter']=='ch2')['source']['contentHash']='changed'
        with self.assertRaisesRegex(ValueError,'来源已变化'):
            load_review(changed,self.topics)

    def test_calculations_and_counterexamples(self):
        checks=run_checks()
        self.assertEqual(len(checks),31)
        self.assertTrue(all(r['ok'] for r in checks.values()))

    def test_resource_simulator_preserves_bursts_and_exclusive_devices(self):
        programs=[[('CPU',2),('D1',3),('CPU',1)],[('D1',2),('CPU',4)]]
        finish,trace=resource_schedule(programs,True)
        for p in range(2):
            for resource in trace:
                self.assertEqual(trace[resource].count(p),sum(d for r,d in programs[p] if r==resource))
        self.assertTrue(all(t>0 for t in finish))
        self.assertEqual(cpu([3],[2],'srtf')[0],[5])

    def test_safety_is_not_just_requester_need(self):
        # 申请者不能先完成不等于系统不安全；另一进程可先释放。
        self.assertEqual(safe_sequences([[2],[1]],[[3],[1]],[0]),[[1,0]])
        # 资源总量不能满足单个最大需求时不应误判安全。
        self.assertEqual(safe_sequences([[0]],[[4]],[3]),[])
        # 一次通知不能广播给两个等待者。
        end,stuck=pv_endings([[('P','s')],[('P','s')],[('V','s')]],{'s':0})
        self.assertFalse(end)
        self.assertTrue(stuck)


if __name__=='__main__':unittest.main()
