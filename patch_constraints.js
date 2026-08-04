import fs from 'fs';
let code = fs.readFileSync('src/components/ReceiverView.tsx', 'utf8');
code = code.replace(
  "advanced: [{ focusMode: 'continuous' } as any]",
  "advanced: [{ focusMode: 'continuous' } as any]"
);
fs.writeFileSync('src/components/ReceiverView.tsx', code);
