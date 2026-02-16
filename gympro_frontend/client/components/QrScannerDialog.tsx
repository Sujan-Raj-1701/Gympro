import React from 'react';

interface QrScannerDialogProps {
  open: boolean;
  onClose: () => void;
  onDetected: (code: string) => void;
  title?: string;
}

// Lightweight QR scanner using the native BarcodeDetector API where available.
// Falls back to showing a helpful message if not supported.
const QrScannerDialog: React.FC<QrScannerDialogProps> = ({ open, onClose, onDetected, title }) => {
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const rafRef = React.useRef<number | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [supported, setSupported] = React.useState<boolean>(false);
  const [permissionDenied, setPermissionDenied] = React.useState<boolean>(false);
  const zxingReaderRef = React.useRef<any>(null);
  const [facing, setFacing] = React.useState<'environment' | 'user'>(() => {
    const saved = typeof window !== 'undefined' ? (localStorage.getItem('qrFacing') as 'environment' | 'user' | null) : null;
    return saved === 'user' ? 'user' : 'environment';
  });

  // Start camera and scanning loop when opened
  React.useEffect(() => {
    let cancelled = false;

    const stop = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }
      try {
        if (zxingReaderRef.current) {
          zxingReaderRef.current.reset?.();
          zxingReaderRef.current = null;
        }
      } catch {}
      try {
        if (videoRef.current) {
          // Detach stream to ensure camera fully releases
          (videoRef.current as any).srcObject = null;
        }
      } catch {}
    };

    async function start() {
      if (!open) return;
      // Check support for native BarcodeDetector
      const hasDetector = typeof (window as any).BarcodeDetector !== 'undefined';
      setSupported(hasDetector);

      // First: explicitly request camera permission to trigger browser prompt
      const ensurePermission = async (): Promise<MediaStream> => {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          throw new Error('Camera API unavailable in this context');
        }
        try {
          const constraints: MediaStreamConstraints = { video: { facingMode: { ideal: facing } } };
          const s = await navigator.mediaDevices.getUserMedia(constraints);
          return s;
        } catch (e: any) {
          setPermissionDenied(true);
          // Provide actionable hint for insecure origins
          const insecure = !window.isSecureContext && location.hostname !== 'localhost';
          const hint = insecure
            ? 'Camera access requires HTTPS (or localhost). Please use a secure origin.'
            : 'Please allow camera permission in your browser and ensure no other app is using the camera.';
          throw new Error(hint);
        }
      };

      if (hasDetector) {
        // Start camera and run native BarcodeDetector loop
        try {
          const stream = await ensurePermission();
          if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
          streamRef.current = stream;
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            await videoRef.current.play().catch(() => {});
          }
        } catch (e: any) {
          setError(e?.message || 'Unable to access camera');
          return;
        }
        const Detector = (window as any).BarcodeDetector as any;
        let detector: any;
        try {
          // Ensure QR support
          const formats = ['qr_code'];
          detector = new Detector({ formats });
        } catch (e: any) {
          setError('QR scanner not supported in this browser');
          return;
        }

        const loop = async () => {
          if (!videoRef.current) return;
          try {
            const result = await detector.detect(videoRef.current);
            if (Array.isArray(result) && result.length > 0) {
              const code = (result[0]?.rawValue ?? result[0]?.raw ?? '').toString();
              if (code) {
                stop();
                onDetected(code);
                return;
              }
            }
          } catch (e: any) {
            // keep scanning; some frames may throw
          }
          rafRef.current = requestAnimationFrame(loop);
        };
        rafRef.current = requestAnimationFrame(loop);
        return;
      }

      // Fallback: use ZXing if BarcodeDetector is unavailable
      try {
        // Ensure permission first to trigger prompt
        await ensurePermission();

        const { BrowserMultiFormatReader } = await import('@zxing/browser');
        const reader = new BrowserMultiFormatReader();
        zxingReaderRef.current = reader;

        // Prefer decodeFromConstraints to trigger permission prompt reliably
        const constraints: MediaStreamConstraints = { video: { facingMode: { ideal: facing } } };
        await reader.decodeFromConstraints(
          constraints,
          (videoRef.current as HTMLVideoElement),
          (result: any, err: any) => {
            if (result) {
              const text = String(result.getText ? result.getText() : result.text || result).trim();
              if (text) {
                stop();
                onDetected(text);
              }
            }
          }
        );
      } catch (e: any) {
        // Attempt a one-time explicit permission request, then retry
        try {
          const temp = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing } } });
          temp.getTracks().forEach(t => t.stop());
          const { BrowserMultiFormatReader } = await import('@zxing/browser');
          const reader = new BrowserMultiFormatReader();
          zxingReaderRef.current = reader;
          await reader.decodeFromConstraints(
            { video: { facingMode: { ideal: facing } } },
            (videoRef.current as HTMLVideoElement),
            (result: any, err: any) => {
              if (result) {
                const text = String(result.getText ? result.getText() : result.text || result).trim();
                if (text) {
                  stop();
                  onDetected(text);
                }
              }
            }
          );
        } catch (e2: any) {
          const insecure = !window.isSecureContext && location.hostname !== 'localhost';
          const hint = insecure
            ? 'Camera access requires HTTPS (or localhost). Please use a secure origin.'
            : 'Please allow camera permission in the browser (not blocked), or ensure a camera device is available.';
          setError(`QR scanning not supported in this browser, and fallback failed. ${hint}`);
        }
      }
    }

    if (open) start();

    return () => {
      cancelled = true;
      stop();
    };
  }, [open, onDetected, facing]);

  if (!open) return null;

  const handleClose = () => {
    // Parent will set open=false, but stop immediately too (ZXing can keep decoding otherwise).
    try {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }
      if (zxingReaderRef.current) {
        zxingReaderRef.current.reset?.();
        zxingReaderRef.current = null;
      }
      if (videoRef.current) {
        (videoRef.current as any).srcObject = null;
      }
    } catch {}
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4" onClick={handleClose}>
      <div className="bg-white rounded-xl w-full max-w-md shadow-xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-slate-200 bg-gradient-to-r from-indigo-50 to-blue-50">
          <div className="flex items-center justify-between gap-3">
            <div className="text-slate-800 font-semibold text-base">{title || 'Scan QR Code'}</div>
            <button
              type="button"
              title="Flip camera"
              className="h-8 px-3 rounded-md bg-slate-800 text-white text-xs hover:bg-slate-700"
              onClick={() => {
                const next = facing === 'environment' ? 'user' : 'environment';
                setFacing(next);
                try { localStorage.setItem('qrFacing', next); } catch {}
              }}
            >
              {facing === 'environment' ? 'Front Cam' : 'Back Cam'}
            </button>
          </div>
        </div>
        <div className="p-4 space-y-3">
          <div className="relative w-full rounded-lg overflow-hidden bg-black">
            {/* Video feed */}
            <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
            {/* Removed overlay placeholder text for cleaner view */}
          </div>
          {!supported && (
            <div className="text-xs text-slate-500">Using compatibility scanner. Align the QR within the frame.</div>
          )}
          {permissionDenied && (
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs text-slate-500">Click Allow when your browser asks for camera access.</div>
              <button
                type="button"
                className="h-8 px-3 rounded-md bg-blue-600 text-white text-xs hover:bg-blue-700"
                onClick={async () => {
                  setError(null);
                  setPermissionDenied(false);
                  // Re-open permission prompt on user gesture
                  try {
                    const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing } } });
                    s.getTracks().forEach(t => t.stop());
                    // Close and reopen to restart scanner with granted permission
                    handleClose();
                    setTimeout(() => {
                      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                      // @ts-ignore - reopen via synthetic event handled by parent template
                    }, 0);
                  } catch (e) {
                    setError('Permission was not granted. Please enable the camera for this site.');
                    setPermissionDenied(true);
                  }
                }}
              >
                Enable Camera
              </button>
            </div>
          )}
        </div>
        <div className="px-4 py-3 border-t border-slate-200 flex justify-end">
          <button
            className="h-9 px-4 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800"
            onClick={handleClose}
            type="button"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default QrScannerDialog;
