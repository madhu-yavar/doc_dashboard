const { PDFParse } = require('pdf-parse');
const fs = require('fs');

const pdfPath = process.argv[2] || './server/storage/uploads/b8cf77b0-ada9-43f4-a3d5-8be65ae6fc8a.pdf';

fs.readFile(pdfPath, (err, buffer) => {
  if (err) {
    console.error('Error reading file:', err);
    process.exit(1);
  }

  const parser = new PDFParse({ data: buffer });
  parser.getText().then(result => {
    const text = result.text || '';
    console.log('=== FULL PDF TEXT ===');
    console.log(text);
    console.log('\n=== METADATA ===');
    console.log('Pages:', result.numpages);
    console.log('Total characters:', text.length);
  }).catch(err => {
    console.error('Error parsing PDF:', err);
    process.exit(1);
  });
});
