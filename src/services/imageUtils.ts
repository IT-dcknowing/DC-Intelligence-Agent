/**
 * Utilitaires pièces jointes du chat — basés sur le type MIME réel (file.type),
 * jamais sur la seule extension. Miniature compressée côté client (canvas)
 * pour un affichage immédiat même sur réseau lent.
 */

export function isImageMime(mime: string | undefined): boolean {
  return typeof mime === 'string' && mime.toLowerCase().startsWith('image/');
}

export function isPdfMime(mime: string | undefined): boolean {
  return typeof mime === 'string' && mime.toLowerCase() === 'application/pdf';
}

export function attachmentKind(mime: string | undefined): 'image' | 'pdf' | 'file' {
  if (isImageMime(mime)) return 'image';
  if (isPdfMime(mime)) return 'pdf';
  return 'file';
}

/**
 * Miniature compressée (max 320px, jpeg 0.72) pour un affichage rapide.
 * Retourne une dataURL. Échoue proprement (rejet) si le fichier n'est pas décodable.
 */
export function createImageThumbnail(file: File, maxDim = 320, quality = 0.72): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      const objectUrl = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        try {
          const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
          const w = Math.max(1, Math.round(img.width * scale));
          const h = Math.max(1, Math.round(img.height * scale));
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            URL.revokeObjectURL(objectUrl);
            reject(new Error('canvas indisponible'));
            return;
          }
          ctx.drawImage(img, 0, 0, w, h);
          const dataUrl = canvas.toDataURL('image/jpeg', quality);
          URL.revokeObjectURL(objectUrl);
          resolve(dataUrl);
        } catch (e) {
          URL.revokeObjectURL(objectUrl);
          reject(e);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('image illisible'));
      };
      img.src = objectUrl;
    } catch (e) {
      reject(e);
    }
  });
}

/** Libellé générique — jamais le nom brut du fichier dans la bulle. */
export function genericAttachmentLabel(mime: string | undefined): string {
  const kind = attachmentKind(mime);
  if (kind === 'image') return '🖼️ Image envoyée';
  if (kind === 'pdf') return '📄 Document PDF envoyé';
  return '📎 Fichier envoyé';
}
