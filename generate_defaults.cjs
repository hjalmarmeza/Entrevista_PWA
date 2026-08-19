const fs = require('fs');
const data = JSON.parse(fs.readFileSync('extracted.json', 'utf8'));

const cv = data['PDF/Hjalmar Meza Cortez | Executive Profile.pdf'] || '';
const coverLetter = data['PDF/carta presentacion cv web.pdf'] || '';
const aptitudes = data['PDF/InfoJobs - Tu Currículum Vitae.pdf'] || '';

const code = `
export const defaultCV = \`${cv.replace(/`/g, '\\`').replace(/\$/g, '\\$')}\`;
export const defaultCoverLetter = \`${coverLetter.replace(/`/g, '\\`').replace(/\$/g, '\\$')}\`;
export const defaultAptitudes = \`${aptitudes.replace(/`/g, '\\`').replace(/\$/g, '\\$')}\`;
`;

fs.writeFileSync('src/defaults.ts', code);
