import tarfile, io
from pathlib import Path
root = Path(__file__).parent
with tarfile.open(root/'site.tar.gz', 'w:gz') as archive:
    for file in (root/'dist').rglob('*'):
        if file.is_file():
            archive.add(file, arcname='dist/'+file.relative_to(root/'dist').as_posix())
    data = (root/'.openai/hosting.json').read_bytes()
    info = tarfile.TarInfo('dist/.openai/hosting.json')
    info.size = len(data)
    archive.addfile(info, io.BytesIO(data))
print('Static archive prepared')
