import multer from "multer";
import path from "node:path";
import { httpError } from "../errors.js";

export const maxCvSize = 5 * 1024 * 1024;

export const uploadCv = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxCvSize, files: 1, fields: 1, parts: 3, fieldSize: 16384 },
  fileFilter(_request, file, callback) {
    if (file.mimetype !== "application/pdf" || path.extname(file.originalname).toLowerCase() !== ".pdf") return callback(httpError(400, "CV-ul trebuie să fie un fișier PDF."));
    callback(null, true);
  }
}).single("cv");

export function validateCv(file) {
  if (!file || !Buffer.isBuffer(file.buffer) || !file.size) throw httpError(400, "Încărcarea unui CV în format PDF este obligatorie.");
  if (file.size > maxCvSize) throw httpError(413, "CV-ul poate avea maximum 5 MB.");
  const header = file.buffer.subarray(0, 8).toString("ascii");
  const end = file.buffer.subarray(-1024).toString("ascii");
  if (!/^%PDF-\d\.\d/.test(header) || !end.includes("%%EOF")) throw httpError(400, "Fișierul încărcat nu este un PDF valid.");
  const filename = path.basename(file.originalname.replace(/\\/g, "/")).replace(/[\x00-\x1f\x7f]/g, "").slice(0, 200);
  return { name: filename || "cv.pdf", type: "application/pdf", content: file.buffer };
}
