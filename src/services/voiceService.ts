/**
 * Voice service for recording audio, waveform analysis, and Groq Whisper transcription
 */

export interface TranscriptionResult {
  text: string;
  duration?: number;
  segments?: Array<{ id: number; text: string; start: number; end: number }>;
}

export async function transcribeAudioWithGroq(
  audioBlob: Blob,
  apiKey: string
): Promise<TranscriptionResult> {
  if (!apiKey || !apiKey.trim()) {
    throw new Error('MISSING_KEY');
  }

  const formData = new FormData();
  // Groq requires a filename with an audio extension
  const extension = audioBlob.type.includes('mp4') || audioBlob.type.includes('m4a') ? 'm4a' : 'webm';
  formData.append('file', audioBlob, `audio_recording.${extension}`);
  formData.append('model', 'whisper-large-v3-turbo');
  formData.append('temperature', '0');
  formData.append('response_format', 'verbose_json');

  const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey.trim()}`,
    },
    body: formData,
  });

  if (!response.ok) {
    let errorDetail = '';
    try {
      const errJson = await response.json();
      errorDetail = errJson?.error?.message || response.statusText;
    } catch {
      errorDetail = response.statusText;
    }
    throw new Error(`GROQ_API_ERROR: ${errorDetail}`);
  }

  const data = await response.json();
  return {
    text: data.text || '',
    duration: data.duration,
    segments: data.segments,
  };
}
