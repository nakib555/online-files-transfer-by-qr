import fs from 'fs';
let code = fs.readFileSync('src/components/ReceiverView.tsx', 'utf8');

// Replace the startCamera function to include a fallback
const oldStartCamera = `
  const startCamera = async () => {
    stopCamera();
    setCameraError('');
    try {
      const constraints: MediaStreamConstraints = {
        video: selectedCameraId 
          ? { deviceId: { exact: selectedCameraId }, width: { ideal: 4096 }, height: { ideal: 2160 }, advanced: [{ focusMode: 'continuous' } as any] } 
          : { facingMode: 'environment', width: { ideal: 4096 }, height: { ideal: 2160 }, advanced: [{ focusMode: 'continuous' } as any] }
      };
      
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
`;

const newStartCamera = `
  const startCamera = async () => {
    stopCamera();
    setCameraError('');
    try {
      let stream;
      try {
        const constraintsWithAdvanced: MediaStreamConstraints = {
          video: selectedCameraId 
            ? { deviceId: { exact: selectedCameraId }, width: { ideal: 4096 }, height: { ideal: 2160 }, advanced: [{ focusMode: 'continuous' } as any] } 
            : { facingMode: 'environment', width: { ideal: 4096 }, height: { ideal: 2160 }, advanced: [{ focusMode: 'continuous' } as any] }
        };
        stream = await navigator.mediaDevices.getUserMedia(constraintsWithAdvanced);
      } catch (err) {
        // Fallback without advanced constraints for Safari/iOS
        const fallbackConstraints: MediaStreamConstraints = {
          video: selectedCameraId 
            ? { deviceId: { exact: selectedCameraId }, width: { ideal: 4096 }, height: { ideal: 2160 } } 
            : { facingMode: 'environment', width: { ideal: 4096 }, height: { ideal: 2160 } }
        };
        stream = await navigator.mediaDevices.getUserMedia(fallbackConstraints);
      }
`;

code = code.replace(oldStartCamera.trim(), newStartCamera.trim());
fs.writeFileSync('src/components/ReceiverView.tsx', code);
