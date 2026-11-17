import sys
import unittest
from pathlib import Path

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
from audit_assets import validate


class AuditEvidence(unittest.TestCase):
    def test_evidence_covers_frozen_sources(self):
        years, images = validate()
        self.assertEqual(len(images),135)
        differences={r["questionId"]:r for r in years["questions"] if r.get("displayNotice")}
        self.assertEqual(set(differences),{"c4-s2-0-q051","c2-s2-0-q045"})
        self.assertEqual(differences["c4-s2-0-q051"]["correspondingYear"],2009)
        self.assertTrue(all(not r["authorityVerified"] for r in years["questions"]))
