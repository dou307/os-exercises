import copy
import json
import sys
import unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
from chapter_review import load_review, overlay
from review_ch45_checks import run_checks, buffered, disk_schedule, rotational


class RemainingReview(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.questions=json.loads((ROOT/'data/questions.json').read_text(encoding='utf-8'))['questions']
        cls.topics=json.loads((ROOT/'data/topics.json').read_text(encoding='utf-8'))['topics']

    def test_all_remaining_questions_reviewed_and_excluded(self):
        for chapter,count,excluded in [('ch4',110,9),('ch5',120,6)]:
            doc=load_review(self.questions,self.topics,chapter)
            self.assertEqual(len(doc['questions']),count)
            out={'byQuestion':{}}
            errata=overlay(out,doc)
            self.assertEqual(sum(m['reviewStatus']=='disputed' for m in out['byQuestion'].values()),excluded)
            self.assertEqual({e['questionId'] for e in errata if e['scoring']=='excluded'},
                {i for i,m in out['byQuestion'].items() if m['reviewStatus']=='disputed'})
            checks=run_checks(chapter)
            self.assertTrue({c for r in doc['questions'] for c in r['answerReview']['checkIds']}<=set(checks))

    def test_new_source_content_invalidates_review(self):
        for chapter in ['ch4','ch5']:
            changed=copy.deepcopy(self.questions)
            next(q for q in changed if q['chapter']==chapter)['source']['contentHash']='changed'
            with self.assertRaisesRegex(ValueError,'来源已变化'):load_review(changed,self.topics,chapter)

    def test_buffer_timelines_respect_resource_constraints(self):
        for slots in [1,2]:
            result=buffered(8,80,20,50,slots)
            previous_read=previous_cpu=0
            for i,(rs,re,cs,ce,pe) in enumerate(result['timeline']):
                self.assertGreaterEqual(rs,previous_read)
                self.assertGreaterEqual(cs,re)
                self.assertGreaterEqual(cs,previous_cpu)
                if i>=slots:self.assertGreaterEqual(rs,result['timeline'][i-slots][3])
                previous_read=re;previous_cpu=pe
        self.assertEqual(buffered(1,80,20,50,1)['total'],150)
        self.assertEqual(buffered(4,80,20,50,2)['total'],390)

    def test_cscan_is_not_clook(self):
        requests=[50,90,30,120]
        strict=disk_schedule(requests,100,'cscan',1,199)
        look=disk_schedule(requests,100,'clook',1,199)
        self.assertEqual(strict['distance'],388)
        self.assertEqual(look['distance'],170)
        self.assertIn(199,strict['path'])
        self.assertNotIn(199,look['path'])

    def test_dispute_followup_has_exact_coverage_and_hashes(self):
        doc=json.loads((ROOT/'data/reviews/dispute-followup.json').read_text(encoding='utf-8'))
        q={q['id']:q for q in self.questions}
        self.assertEqual(len(doc['questions']),37)
        self.assertEqual(len({r['questionId'] for r in doc['questions']}),37)
        for row in doc['questions']:
            self.assertEqual(row['sourceContentHash'],q[row['questionId']]['source']['contentHash'])
            self.assertEqual(row['scoring'],'excluded')


if __name__=='__main__':unittest.main()
