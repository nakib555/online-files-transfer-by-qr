import fs from 'fs';
let code = fs.readFileSync('src/components/SenderView.tsx', 'utf8');
code = code.replace(
  '<div className="bg-white p-3 rounded-lg shadow-2xl relative">',
  '<div className="bg-white p-2 sm:p-3 w-full max-w-[280px] sm:max-w-[400px] md:max-w-[500px] rounded-lg shadow-2xl relative">'
);
code = code.replace(
  'className="!w-full !h-auto max-w-[320px] sm:max-w-[400px] md:max-w-[500px] aspect-square block"',
  'className="!w-full !h-auto aspect-square block mx-auto"'
);
fs.writeFileSync('src/components/SenderView.tsx', code);
