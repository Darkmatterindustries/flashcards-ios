from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import sys
root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('artifacts/Flashcards-Windows')
with ZipFile('artifacts/Flashcards-Windows-4.0.zip', 'w', ZIP_DEFLATED) as archive:
    for path in root.rglob('*'):
        if path.is_file() and not any(part.startswith('smoke-') for part in path.relative_to(root).parts):
            archive.write(path, 'Flashcards/' + path.relative_to(root).as_posix())
print('Prepared artifacts/Flashcards-Windows-4.0.zip')
