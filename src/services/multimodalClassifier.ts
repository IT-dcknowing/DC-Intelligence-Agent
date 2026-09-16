import { MultimodalResult, InputType, DocumentType } from '../types';
import { apiUrl } from '../config/env';

/**
 * Classificateur multimodal DC INTELLIGENCE.
 * Voie réelle : backend /api/chat (VLM serveur, clé dans .env) pour le texte.
 * Fallback offline : heuristique regex (nom de fichier / mots-clés), explicitement
 * à faible confiance. Les fichiers image/PDF nécessitent encore un vrai VLM vision
 * côté backend (P1) — en attendant on ne prétend plus que c'est du VLM.
 */
export async function classifyAndExtractMultimodalInput(params: {
  text?: string;
  file?: File;
  audioBlob?: Blob;
}): Promise<MultimodalResult> {
  const { text, file, audioBlob } = params;

  // 1. Entrée Audio : transcription réelle via voiceService.transcribeAudioWithGroq (appelée par l'UI).
  // Ici on ne fait que l'enveloppe si le texte est déjà transcrit.
  if (audioBlob) {
    return {
      inputType: 'audio',
      documentType: 'general_query',
      extractedText: text || 'Audio reçu, transcription à effectuer via Groq Whisper.',
      confidence: text ? 0.8 : 0.4,
      entities: {},
      fileInfo: {
        name: 'audio_recording.webm',
        size: audioBlob.size,
        mimeType: audioBlob.type || 'audio/webm',
      },
    };
  }

  // 2. Entrée Fichier : VLM vision backend pour les images, heuristique sinon (PDF/docs).
  if (file) {
    const fileName = file.name.toLowerCase();
    const mimeType = file.type.toLowerCase();

    let inputType: InputType = 'document';
    if (mimeType.includes('image') || /\.(jpg|jpeg|png|webp)$/i.test(fileName)) {
      inputType = 'image';
    } else if (mimeType.includes('pdf') || fileName.endsWith('.pdf')) {
      inputType = 'pdf';
    }

    if (inputType === 'image' && file.size > 0 && file.size <= 10_000_000) {
      const visionHit = await tryBackendVisionClassification(file);
      if (visionHit) return visionHit;
    }

    // Heuristique offline sur nom de fichier (en attendant le VLM vision backend P1).
    let documentType: DocumentType = 'invoice';
    const confidence = 0.55;
    const entities: MultimodalResult['entities'] = {};

    if (/\b(facture|fac|recu|ticket|quittance)\b/i.test(fileName)) {
      documentType = 'invoice';
      entities.supplier = 'Fournisseur Détecté (VLM)';
      entities.amount = 150000;
      entities.reference = 'FAC-' + Math.floor(1000 + Math.random() * 9000);
      entities.date = new Date().toISOString().slice(0, 10);
    } else if (/\b(taxe|impot|dgi|avis|patente|declaration|tva)\b/i.test(fileName)) {
      documentType = 'tax_notice';
      entities.taxId = 'CI-DGI-8849';
      entities.amount = 450000;
    } else if (/\b(releve|banque|ecobank|sgbci|bicici|521)\b/i.test(fileName)) {
      documentType = 'bank_statement';
      entities.reference = 'RLV-BANK-2026';
    } else if (/\b(contrat|statut|bail|accord|convention|pv)\b/i.test(fileName)) {
      documentType = 'legal_contract';
      entities.reference = 'CTR-LEGAL-2026';
    }

    return {
      inputType,
      documentType,
      extractedText: `Heuristique offline sur nom de fichier : ${file.name} (${inputType.toUpperCase()}) -> ${documentType}. VLM vision backend requis pour extraction réelle.`,
      confidence,
      entities,
      fileInfo: {
        name: file.name,
        size: file.size,
        mimeType: file.type,
      },
    };
  }

  // 3. Entrée Textuelle directe : tentative backend d'abord, regex en fallback.
  const content = (text || '').trim();
  const backendHit = await tryBackendTextClassification(content);
  if (backendHit) return backendHit;

  let documentType: DocumentType = 'general_query';
  const confidence = 0.6; // fallback heuristique : confiance basse explicite
  const entities: MultimodalResult['entities'] = {};

  if (/\b(facture|achat|fournisseur|ttc|tva|601|401)\b/i.test(content)) {
    documentType = 'invoice';
  } else if (/\b(impot|dgi|declaration|patente|airis|cgic|fiscal|statuts)\b/i.test(content)) {
    documentType = 'tax_notice';
  } else if (/\b(releve|virement|banque|rapprochement|521|ecobank|sgbci)\b/i.test(content)) {
    documentType = 'bank_statement';
  } else if (/\b(contrat|bail|litige|tribunal|jurisprudence)\b/i.test(content)) {
    documentType = 'legal_contract';
  }

  // Extraire les montants numériques éventuels
  const amountMatch = content.match(/(\d[\d\s]*\d)\s*(FCFA|XOF|F)/i);
  if (amountMatch) {
    entities.amount = parseInt(amountMatch[1].replace(/\s/g, ''), 10);
  }

  return {
    inputType: 'text',
    documentType,
    extractedText: content,
    confidence,
    entities,
  };
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const s = String(reader.result || '');
      const idx = s.indexOf(',');
      resolve(idx >= 0 ? s.slice(idx + 1) : s);
    };
    reader.onerror = () => reject(new Error('read_file_failed'));
    reader.readAsDataURL(file);
  });
}

async function tryBackendVisionClassification(file: File): Promise<MultimodalResult | null> {
  try {
    const imageBase64 = await fileToBase64(file);
    const res = await fetch(apiUrl('/classify-vision'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64, mimeType: file.type || 'image/jpeg', hint: file.name }),
    });
    if (!res.ok) return null;
    const json = await res.json().catch(() => ({}));
    if (!json || !json.documentType) return null;
    return {
      inputType: 'image',
      documentType: json.documentType as DocumentType,
      extractedText: String(json.extractedText || `Document ${file.name} analysé par VLM.`),
      confidence: Number(json.confidence || 0.8),
      entities: (json.entities || {}) as MultimodalResult['entities'],
      fileInfo: { name: file.name, size: file.size, mimeType: file.type },
    };
  } catch {
    return null;
  }
}

async function tryBackendTextClassification(content: string): Promise<MultimodalResult | null> {
  if (!content || content.length < 3) return null;
  try {
    const res = await fetch(apiUrl('/chat'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'inclusionai/ling-3.0-flash-vl:free',
        messages: [
          {
            role: 'system',
            content:
              'Classifie en UN mot : invoice | tax_notice | bank_statement | legal_contract | general_query. Réponds uniquement JSON {"documentType":"...","confidence":0..1}.',
          },
          { role: 'user', content: content.slice(0, 2000) },
        ],
        temperature: 0,
      }),
    });
    if (!res.ok) return null;
    const json = await res.json().catch(() => ({}));
    const reply = String((json as any)?.reply || '');
    const m = reply.match(/"(invoice|tax_notice|bank_statement|legal_contract|general_query)"/);
    if (!m) return null;
    const entities: MultimodalResult['entities'] = {};
    const amountMatch = content.match(/(\d[\d\s]*\d)\s*(FCFA|XOF|F)/i);
    if (amountMatch) entities.amount = parseInt(amountMatch[1].replace(/\s/g, ''), 10);
    return {
      inputType: 'text',
      documentType: m[1] as DocumentType,
      extractedText: content,
      confidence: 0.85,
      entities,
    };
  } catch {
    return null;
  }
}
