const fs = require('fs');
const pdf = require('pdf-parse');

async function extract() {
  const files = [
    'PDF/Hjalmar Meza Cortez | Executive Profile.pdf',
    'PDF/carta presentacion cv web.pdf',
    'PDF/InfoJobs - Tu Currículum Vitae.pdf'
  ];
  const results = {};
  for (const file of files) {
    const dataBuffer = fs.readFileSync(file);
    const data = await pdf(dataBuffer);
    results[file] = data.text;
  }
  fs.writeFileSync('extracted.json', JSON.stringify(results, null, 2));
}
extract().catch(console.error);
