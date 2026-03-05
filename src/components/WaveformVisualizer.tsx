import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

interface WaveformVisualizerProps {
  analyserRef: RefObject<AnalyserNode | null>;
  isRecording: boolean;
}

export default function WaveformVisualizer({
  analyserRef,
  isRecording,
}: WaveformVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef(0);

  useEffect(() => {
    const analyser = analyserRef.current;
    const canvas = canvasRef.current;
    if (!isRecording || !analyser || !canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      animFrameRef.current = requestAnimationFrame(draw);
      analyser.getByteTimeDomainData(dataArray);

      // Fade-out trail
      ctx.fillStyle = 'rgba(10, 10, 26, 0.35)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Glow effect
      ctx.shadowBlur = 6;
      ctx.shadowColor = '#00d4ff';
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#00d4ff';
      ctx.beginPath();

      const sliceWidth = canvas.width / bufferLength;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0;
        const y = (v * canvas.height) / 2;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
        x += sliceWidth;
      }

      ctx.lineTo(canvas.width, canvas.height / 2);
      ctx.stroke();

      // Reset shadow for next frame
      ctx.shadowBlur = 0;
    };

    draw();

    return () => {
      cancelAnimationFrame(animFrameRef.current);
    };
  }, [isRecording, analyserRef]);

  return (
    <canvas
      ref={canvasRef}
      width={600}
      height={80}
      className="waveform-canvas"
    />
  );
}
