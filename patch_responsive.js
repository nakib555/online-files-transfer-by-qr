import fs from 'fs';
// Check header
let header = fs.readFileSync('src/components/Header.tsx', 'utf8');
header = header.replace('px-6 py-4', 'px-4 sm:px-6 py-3 sm:py-4');
header = header.replace('max-w-7xl mx-auto flex items-center justify-between', 'max-w-7xl mx-auto flex items-center justify-between gap-2 sm:gap-4');
header = header.replace('<div className="flex items-center gap-3">', '<div className="flex items-center gap-2 sm:gap-3 shrink-0">');
fs.writeFileSync('src/components/Header.tsx', header);

// Check App.tsx
let app = fs.readFileSync('src/App.tsx', 'utf8');
app = app.replace('p-4 sm:p-6 lg:p-8', 'p-3 sm:p-6 lg:p-8');
app = app.replace('px-6', 'px-4 sm:px-6');
fs.writeFileSync('src/App.tsx', app);
