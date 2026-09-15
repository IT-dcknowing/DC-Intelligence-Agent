import React, { useEffect, useState } from 'react';

interface WaveformVisualizerProps {
  analyserNode: AnalyserNode | null;
  isRecording: boolean;
}

export const WaveformVisualizer: React.FC<WaveformVisualizerProps> = ({
  analyserNode,
  isRecording,
}) => {
  // 16 bars for the waveform display
  const [barHeights, setBarHeights] = useState<number[]>(new Array(16).fill(4));

  useEffect(() => {
    if (!isRecording) {
      setBarHeights(new Array(16).fill(4));
      return;
    }

    let animationFrameId: number;

    if (analyserNode) {
      const dataArray = new Uint8Array(analyserNode.frequencyBinCount);

      const updateWaveform = () => {
        analyserNode.getByteFrequencyData(dataArray);

        // Sample down to 16 buckets
        const step = Math.floor(dataArray.length / 16);
        const newHeights = [];
        for (let i = 0; i < 16; i++) {
          const val = dataArray[i * step] || 0;
          // Scale to 4px - 22px
          const height = Math.max(4, Math.min(22, (val / 255) * 22));
          newHeights.push(height);
        }
        setBarHeights(newHeights);
        animationFrameId = requestAnimationFrame(updateWaveform);
      };

      animationFrameId = requestAnimationFrame(updateWaveform);
    } else {
      // Fallback pulse animation if no analyser node
      const interval = setInterval(() => {
        setBarHeights((prev) =>
          prev.map(() => Math.floor(4 + Math.random() * 16))
        );
      }, 100);

      return () => clearInterval(interval);
    }

    return () => {
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
    };
  }, [analyserNode, isRecording]);

  return (
    <div
      id="waveform-container"
      className="flex items-center gap-1 h-6 px-1.5 py-0.5 select-none"
      title="Microphone actif"
    >
      {barHeights.map((h, idx) => (
        <span
          key={idx}
          className="w-[2.5px] rounded-full bg-black transition-all duration-75"
          style={{ height: `${h}px` }}
        />
      ))}
    </div>
  );
};
