import fs from 'fs';
let code = fs.readFileSync('src/components/SenderView.tsx', 'utf8');

const searchStr = `<div className="w-full bg-slate-50 h-2 rounded-full overflow-hidden border border-slate-200">
                  <div
                    className="bg-indigo-600 h-full transition-all duration-100 shadow-[0_0_8px_rgba(16,185,129,0.3)]"
                    style={{ width: \`\${totalChunksCount > 0 ? Math.round((currentIndex / totalChunksCount) * 100) : 0}%\` }}
                  ></div>
                </div>`;

const replaceStr = `<div className="w-full bg-slate-50 h-2.5 rounded-full overflow-hidden border border-slate-200">
                  <div
                    className="h-full transition-all duration-300 bg-indigo-600"
                    style={{ width: \`\${totalChunksCount > 0 ? Math.round((currentIndex / totalChunksCount) * 100) : 0}%\` }}
                  ></div>
                </div>`;

if (code.includes(searchStr)) {
  code = code.replace(searchStr, replaceStr);
  fs.writeFileSync('src/components/SenderView.tsx', code);
  console.log("Patched SenderView progress successfully!");
} else {
  console.log("Could not find the exact string to replace in SenderView.");
}
