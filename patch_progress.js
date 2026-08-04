import fs from 'fs';
let code = fs.readFileSync('src/components/SenderView.tsx', 'utf8');

const searchStr = `style={{ width: \`\${totalChunksCount > 0 ? (currentIndex / totalChunksCount) * 100 : 0}%\` }}`;
const replaceStr = `style={{ width: \`\${totalChunksCount > 0 ? Math.round((currentIndex / totalChunksCount) * 100) : 0}%\` }}`;

if (code.includes(searchStr)) {
  code = code.replace(searchStr, replaceStr);
  fs.writeFileSync('src/components/SenderView.tsx', code);
  console.log("Patched progress bar style successfully!");
} else {
  console.log("Could not find the exact string to replace.");
}
