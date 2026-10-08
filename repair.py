from pathlib import Path
p = Path('dist/index.html')
s = bytes(ord(c) if ord(c) < 256 else c.encode('cp1252')[0] for c in p.read_text(encoding='utf-8')).decode('utf-8')
s = s.replace('<option value="all">Tüm ırklar</option>Golden Retriever</option>', '<option value="all">Tüm ırklar</option><option>Golden Retriever</option>')
p.write_text(s, encoding='utf-8')
assert 'Çiftliği' in s
assert '<option>Golden Retriever</option>' in s
print('UTF-8 and select markup verified')
