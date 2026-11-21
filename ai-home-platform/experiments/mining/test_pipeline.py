import unittest
from pipeline import text_groups, split_indices
class IntegrityTests(unittest.TestCase):
 def test_variants_stay_together(self):
  groups=text_groups(['安装 很好！','安装很好','售后很差','售后很差。'])
  self.assertEqual(groups[0],groups[1]);self.assertEqual(groups[2],groups[3]);self.assertNotEqual(groups[0],groups[2])
 def test_split_disjoint_complete_reproducible(self):
  y=[0,1]*30;g=list(range(60));a=split_indices(y,g);b=split_indices(y,g)
  self.assertEqual(a,b)
  sets=[set(s) for s in a.values()]
  self.assertEqual(set.union(*sets),set(range(60)))
  self.assertTrue(all(not sets[i]&sets[j] for i in range(3) for j in range(i)))
if __name__=='__main__':unittest.main()
