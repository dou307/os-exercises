import json
import copy
import sys
import unittest
from pathlib import Path
from functools import lru_cache
from itertools import product

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
from chapter_review import load_review,overlay
from review_ch3_checks import pages,run_checks,allocate,release


class ChapterThreeReview(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.questions=json.loads((ROOT/'data/questions.json').read_text(encoding='utf-8'))['questions']
        cls.topics=json.loads((ROOT/'data/topics.json').read_text(encoding='utf-8'))['topics']

    def test_full_coverage_and_scoring(self):
        d=load_review(self.questions,self.topics,'ch3');self.assertEqual(len(d['questions']),166)
        out={'byQuestion':{}};errata=overlay(out,d)
        disputed={i for i,m in out['byQuestion'].items() if m['reviewStatus']=='disputed'}
        self.assertEqual(disputed,{e['questionId'] for e in errata if e['scoring']=='excluded'})
        self.assertEqual(len(disputed),11)
        self.assertIn('c3-s1-0-q007',disputed);self.assertIn('c3-s3-2-q019',disputed)
        self.assertEqual(out['byQuestion']['c3-s2-0-q010']['primaryChapterId'],'2')
        self.assertEqual(out['byQuestion']['c3-s1-0-q072']['primaryChapterId'],'10')

    def test_stale_content_and_bad_topic_blocked(self):
        q=copy.deepcopy(self.questions)
        next(v for v in q if v['chapter']=='ch3')['source']['contentHash']='changed'
        with self.assertRaisesRegex(ValueError,'来源已变化'):load_review(q,self.topics,'ch3')
        with self.assertRaisesRegex(ValueError,'虚构知识点'):load_review(self.questions,[],'ch3')

    def test_numeric_review(self):
        checks=run_checks();self.assertTrue(all(v['ok'] for v in checks.values()))
        d=load_review(self.questions,self.topics,'ch3')
        referenced={c for r in d['questions'] for c in r['answerReview']['checkIds']}
        self.assertTrue(referenced<=set(checks))
        self.assertGreaterEqual(len(checks),56)

    def test_optimal_simulator_against_exhaustive_dynamic_programming(self):
        # 独立穷举每次可选牺牲页，和最远未来贪心模拟比较，不复用其选牺牲逻辑。
        for refs in product(range(3),repeat=6):
            for capacity in [1,2]:
                @lru_cache(None)
                def best(i,resident):
                    if i==len(refs):return 0
                    p=refs[i];s=set(resident)
                    if p in s:return best(i+1,resident)
                    if len(s)<capacity:return 1+best(i+1,tuple(sorted(s|{p})))
                    return 1+min(best(i+1,tuple(sorted((s-{v})|{p}))) for v in s)
                self.assertEqual(pages(refs,capacity,'opt')['faults'],best(0,()))

    def test_partition_conservation(self):
        holes=[(0,256)];a=allocate(holes,31,'best');b=allocate(holes,29,'best')
        self.assertEqual(sum(n for _,n in holes),196)
        holes=release(holes,a,31);holes=release(holes,b,29)
        self.assertEqual(holes,[(0,256)])


if __name__=='__main__':unittest.main()
