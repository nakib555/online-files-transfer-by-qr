import fs from 'fs';

let code = fs.readFileSync('src/components/ReceiverView.tsx', 'utf8');
code = code.replace(
  /await navigator\.mediaDevices\.getUserMedia\(\{ video: true \}\);\n\s*const devices = await navigator\.mediaDevices\.enumerateDevices\(\);/,
  `const devices = await navigator.mediaDevices.enumerateDevices();`
);

fs.writeFileSync('src/components/ReceiverView.tsx', code);
console.log('Fixed camera error!');
