import test from "node:test";
import assert from "node:assert/strict";
import results from "../src/data/mining-results.json";

test("mining report uses disjoint-sized splits and validation-selected model", () => {
  const c = results.classification;
  assert.equal(Object.values(c.splits).reduce((n, s) => n + s.count, 0), c.samples);
  const best = c.models.reduce((a, b) => b.validation.macroF1 > a.validation.macroF1 ? b : a);
  assert.equal(c.selected, best.name);
  for (const model of c.models) {
    assert.equal(model.test.confusion.flat().reduce((a, b) => a + b, 0), c.splits.test.count);
    assert.equal(model.test.confusion[0].reduce((a, b) => a + b, 0), c.splits.test.negative);
  }
});
test("mining clusters cover every provider and review without raw review data", () => {
  const c = results.clustering;
  assert.equal(c.clusters.length, c.selectedK);
  assert.equal(c.clusters.reduce((n, x) => n + x.size, 0), c.providers);
  assert.equal(c.clusters.reduce((n, x) => n + x.reviewCount, 0), c.reviews);
  assert.ok(!JSON.stringify(results).includes('user_key'));
});
