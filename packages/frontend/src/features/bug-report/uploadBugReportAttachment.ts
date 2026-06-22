import { AttachmentError, type BugReportAttachment } from "shared";

interface UploadArgs {
  bugReportId: string;
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
// string. The JSON response returns createdAt as an ISO string, not a Date.
export function uploadBugReportAttachment({
  bugReportId,
  file,
  onProgress,
}: UploadArgs): Promise<BugReportAttachment> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/bug-reports/${bugReportId}/attachments`);
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
          const raw = JSON.parse(xhr.responseText) as BugReportAttachment & { createdAt: string | Date };
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
