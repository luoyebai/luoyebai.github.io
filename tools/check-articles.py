"""Run the independent Python examples printed in the published articles.

注意：这里**只测站点上真的还有的示例**。原先还有一条 `test_joint_limits`，
测的是 `humanoid-rl-sim2real` 那篇里的 `limited_target` —— 那篇文章在 2026-09-24
的内容改版里被删掉了（`docs/review-baseline/posts/` 里还留着改版前的样子），
示例本身也不在任何一篇文章里了。留着它只会让这个脚本每次都红，而且红得没法处理：
要么删掉这篇测试，要么把文章加回来，没有第三条路。
"""
import ast
import contextlib
import io
import math
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]

def example(slug):
    text = (ROOT / 'content/posts' / (slug + '.md')).read_text(encoding='utf-8')
    blocks = re.findall(r'^```python\n(.*?)^```\s*$', text, re.M | re.S)
    assert blocks, slug
    scope = {}
    for block in blocks:
        ast.parse(block)
        with contextlib.redirect_stdout(io.StringIO()):
            exec(compile(block, slug, 'exec'), scope)
    return scope

class ArticleExamples(unittest.TestCase):
    def test_latency(self):
        f = example('dds-qos-tuning')['summarize_us']
        self.assertEqual(f([80, 90, 100, 110, 1400], 1000),
                         dict(count=5, p99_us=1400, max_us=1400, late_ratio=.2))
        self.assertEqual(f(range(1, 101), 99)['p99_us'], 99)
        for samples, limit in [([], 1), ([1], float('nan')), ([-1], 1), ([float('inf')], 1)]:
            with self.assertRaises(ValueError): f(samples, limit)

    def test_impedance(self):
        f = example('arm-impedance-control')['spring_damper']
        force, damping = f(.01, .02, 400, 2)
        self.assertAlmostEqual(damping, 2 * math.sqrt(800))
        self.assertLess(force, -4)
        self.assertEqual(f(1, 1, 0, 2), (0, 0))
        for mass in (0, -1, float('nan')):
            with self.assertRaises(ValueError): f(0, 0, 400, mass)

    def test_gait_continuity(self):
        f = example('legacy-gait-tuning')['trot_trajectory']
        self.assertEqual(f(0), f(1))
        self.assertAlmostEqual(f(.775)[1], .06)
        for boundary in (0, .55, 1):
            left, right = f(boundary - 1e-9), f(boundary + 1e-9)
            for a, b in zip(left, right): self.assertAlmostEqual(a, b, places=7)
        with self.assertRaises(ValueError): f(0, duty=1)

if __name__ == '__main__':
    unittest.main()
