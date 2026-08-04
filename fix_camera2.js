import fs from 'fs';

let code = fs.readFileSync('src/components/ReceiverView.tsx', 'utf8');

const searchStr = `
    async function initCameraList() {
      try {
        // Request initial permission to enumerate devices properly
        const devices = await navigator.mediaDevices.enumerateDevices();`;

const replaceStr = `
    async function initCameraList() {
      try {
        // Request initial permission to enumerate devices properly
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: true });
          stream.getTracks().forEach(track => track.stop());
        } catch (e) {
          console.warn("Could not get initial camera stream for permissions:", e);
        }
        const devices = await navigator.mediaDevices.enumerateDevices();`;

if (code.includes(searchStr)) {
  code = code.replace(searchStr, replaceStr);
  fs.writeFileSync('src/components/ReceiverView.tsx', code);
  console.log('Fixed camera error!');
} else {
  console.log('Not found');
}
