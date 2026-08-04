import fs from 'fs';
let code = fs.readFileSync('src/components/SenderView.tsx', 'utf8');
code = code.replace(
  'gap-3 sm:p-4 sm:gap-3 sm:p-4 sm:p-6',
  'gap-4 sm:gap-6'
);
fs.writeFileSync('src/components/SenderView.tsx', code);
