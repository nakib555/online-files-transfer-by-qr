import fs from 'fs';
let code = fs.readFileSync('src/components/ReceiverView.tsx', 'utf8');

const searchStr = 'className="relative w-full aspect-square sm:aspect-video md:aspect-square bg-slate-50 border border-slate-200 rounded-xl overflow-hidden flex items-center justify-center"';
const replaceStr = 'className="relative w-full aspect-[4/3] sm:aspect-video lg:aspect-[4/3] bg-slate-50 border border-slate-200 rounded-xl overflow-hidden flex items-center justify-center"';

if (code.includes(searchStr)) {
  code = code.replace(searchStr, replaceStr);
  fs.writeFileSync('src/components/ReceiverView.tsx', code);
  console.log("Patched ReceiverView successfully!");
} else {
  console.log("Could not find the exact string to replace in ReceiverView.");
}
