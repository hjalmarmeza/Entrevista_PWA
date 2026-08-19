import json
from pypdf import PdfReader

files = [
    'PDF/Hjalmar Meza Cortez | Executive Profile.pdf',
    'PDF/carta presentacion cv web.pdf',
    'PDF/InfoJobs - Tu Currículum Vitae.pdf'
]

results = {}
for file in files:
    try:
        reader = PdfReader(file)
        text = "\n".join(page.extract_text() for page in reader.pages)
        results[file] = text
    except Exception as e:
        print(f"Error reading {file}: {e}")

with open('extracted.json', 'w') as f:
    json.dump(results, f, indent=2)
