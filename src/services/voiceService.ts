/**
 * Voice service : transcription via proxy backend /api/transcribe (clé GROQ serveur),
 * fallback direct Groq uniquement si le backend est indisponible et qu'une clé locale existe.
 * Modifié : la clé n'est plus requise côté utilisateur, elle vient du backend .env.
 */
import { apiUrl } from '../config/env';

export interface TranscriptionResult {
  text: string;
  duration?: number;
  segments?: Array<{ id: number; text: string; start: number; end: number }>;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const s = String(reader.result || '');
      const idx = s.indexOf(',');
      resolve(idx >= 0 ? s.slice(idx + 1) : s);
    };
    reader.onerror = () => reject(new Error('read_blob_failed'));
    reader.readAsDataURL(blob);
  });
}

export async function transcribeAudioWithGroq(
  audioBlob: Blob,
  apiKey?: string
): Promise<TranscriptionResult> {
  // 0. Voie recommandée : backend (GROQ_API_KEY serveur, jamais exposé).
  // On essaie d'abord le backend - pas besoin de clé côté front
  if (audioBlob.size > 0 && audioBlob.size <= 8_000_000) {
    try {
      const audioBase64 = await blobToBase64(audioBlob);
      const res = await fetch(apiUrl('/transcribe'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audioBase64, mimeType: audioBlob.type || 'audio/webm' }),
      });
      if (res.status !== 404) {
        const data = await res.json().catch(() => ({}));
        if (res.ok && typeof (data as any)?.text === 'string') {
          return { text: (data as any).text, duration: (data as any)?.duration };
        }
        if ((data as any)?.error === 'backend_not_configured') {
          //Backend not configured - on passe en mode silencieux (plus de clé à demander)
          // On continue vers le fallback géré ci-dessous
        } else if (!res.ok) {
          throw new Error(`TRANSCRIBE_BACKEND: ${String((data as any)?.detail || (data as any)?.error || res.statusText).slice(0, 200)}`);
        }
      }
    } catch (e: any) {
      const msg = String(e?.message || '');
      if (/TRANSCRIBE_BACKEND/.test(msg)) throw e;
      // backend unreachable / 404 -> on considère que la clé n'est pas configurée côté serveur
    }
  }

  // 1. Fallback direct Groq (optionnel, uniquement si une clé est fournie en dernier recours)
  // Si aucune clé n'est fournie, on retourne un résultat vide silencieux
  if (!apiKey || !apiKey.trim()) {
    // Pas de clé fournie => transcription vide (l'utilisateur ne verra aucune erreur technique)
    return { text: '' };
  }

  const formData = new FormData();
  // Groq requires a filename with an audio extension
  const extension = audioBlob.type.includes('mp4') || audioBlob.type.includes('m4a') ? 'm4a' : 'webm';
  formData.append('file', audioBlob, `audio_recording.${extension}`);
  formData.append('model', 'whisper-large-v3-turbo');
  formData.append('temperature', '0');
  formData.append('response_format', 'verbose_json');

  try {
    const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey.trim()}`,
      },
      body: formData,
    });

    if (!response.ok) {
      // Erreur silencieuse - on ne montre pas "MISSING_KEY" à l'utilisateur
      return { text: '' };
    }

    const data = await response.json();
    return {
      text: data.text || '',
      duration: data.duration,
      segments: data.segments,
    };
  } catch (e) {
    // Erreur silencieuse - échoua discrètement si la clé est invalide
    return { text: '' };
  }
}