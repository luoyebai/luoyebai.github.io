"""Regression checks for page boundaries and Markdown presentation steps."""
import deck

result = deck.parse('# Title\n\n--\n\nFirst\n\n--\n\nSecond\n\n----\n\n## Next\n')
assert result['count'] == 2
assert result['slides'][0]['html'].count('class="deck-fragment"') == 2
assert '<p>First</p>' in result['slides'][0]['html']
assert 'deck-fragment' not in result['slides'][1]['html']
literal = deck.parse('# Code\n\n```text\n--\n---\n----\n```\n\n--\n\nAfter')
assert literal['count'] == 1
assert literal['slides'][0]['html'].count('class="deck-fragment"') == 1
assert '<pre' in literal['slides'][0]['html']
assert deck.parse('# No steps\n\nParagraph')['count'] == 1
print('Step boundaries, ordinary slides and fenced code passed.')
