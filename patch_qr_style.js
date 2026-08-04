import fs from 'fs';
let code = fs.readFileSync('src/components/SenderView.tsx', 'utf8');

// replace the QR canvas div structure
const searchStr = `<div className="bg-white p-2 sm:p-3 w-full max-w-[280px] sm:max-w-[400px] md:max-w-[500px] rounded-lg shadow-2xl relative">
                {totalChunksCount === 0 && (
                  <div className="absolute inset-0 flex items-center justify-center bg-white/80">
                    <RefreshCw className="w-8 h-8 text-indigo-500 animate-spin" />
                  </div>
                )}
                <canvas
                  id="qr-transmitter-canvas"
                  ref={canvasRef}
                  className="!w-full !h-auto aspect-square block mx-auto"
                  style={{ imageRendering: 'pixelated' }}
                />
              </div>`;

const replaceStr = `<div className="bg-white p-2 sm:p-3 w-full max-w-full sm:max-w-[400px] md:max-w-[500px] rounded-lg shadow-2xl relative flex justify-center items-center">
                {totalChunksCount === 0 && (
                  <div className="absolute inset-0 flex items-center justify-center bg-white/80">
                    <RefreshCw className="w-8 h-8 text-indigo-500 animate-spin" />
                  </div>
                )}
                <div className="w-full aspect-square relative flex items-center justify-center">
                  <canvas
                    id="qr-transmitter-canvas"
                    ref={canvasRef}
                    className="w-full h-full object-contain mx-auto"
                    style={{ imageRendering: 'pixelated', maxWidth: '100%', maxHeight: '100%' }}
                  />
                </div>
              </div>`;

if (code.includes(searchStr)) {
  code = code.replace(searchStr, replaceStr);
  fs.writeFileSync('src/components/SenderView.tsx', code);
  console.log("Patched successfully!");
} else {
  console.log("Could not find the exact string to replace.");
}
