import { AttachmentError, type Attachment } from "shared";

interface UploadArgs {
  cardId: string;
  file: File;
  onProgress?: (percent: number) => void;
}

const STATUS_CODE: Record<number, string> = {
  401: AttachmentError.UNAUTHORIZED,
  403: AttachmentError.FORBIDDEN,
  413: AttachmentError.FILE_TOO_LARGE,
  415: AttachmentError.UNSUPPORTED_TYPE,
  503: AttachmentError.STORAGE_UNAVAILABLE,
};

const GENERIC = "UNKNOWN";

// Multipart upload via XHR (for progress). Rejects with an AttachmentError code
// string so callers map it with attachmentErrorMessage. The download/list mix is
// plain JSON, so createdAt comes back as an ISO string here, not a Date.
export function uploadAttachment({ cardId, file, onProgress }: UploadArgs): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/cards/${cardId}/attachments`);
    xhr.withCredentials = true;
    xhr.setRequestHeader("x-requested-with", "XMLHttpRequest");

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const raw = JSON.parse(xhr.responseText) as Attachment & { createdAt: string | Date };
          resolve({ ...raw, createdAt: new Date(raw.createdAt) });
        } catch {
          reject(GENERIC);
        }
        return;
      }
      let code = STATUS_CODE[xhr.status];
      if (!code) {
        try {
          code = (JSON.parse(xhr.responseText) as { error?: string }).error ?? GENERIC;
        } catch {
          code = GENERIC;
        }
      }
      reject(code);
    };

    xhr.onerror = () => reject(GENERIC);

    const form = new FormData();
    form.append("file", file);
    xhr.send(form);
  });
}
