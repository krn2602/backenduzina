import { httpError } from "./errors.js";

export const zileValide = [
  "4 martie (CSIE, REI, FABBV)",
  "5 martie (Management, Marketing, FABIZ, BTS)",
  "6 martie (Drept, ETA, EAM, AMP)"
];
export const facultatiValide = ["CSIE", "Drept", "CIG", "FABIZ", "REI", "FABBV", "Management", "Marketing", "BTS", "AMP", "ETA", "EAM"];

export function object(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw httpError(400, "Date invalide.");
  return value;
}

export function text(value, name, maxLength, required = false) {
  if (value == null && !required) return "";
  if (typeof value !== "string" || value.length > maxLength || (required && !value.trim())) throw httpError(400, `${name}: valoare invalidă.`);
  return value.trim();
}

export function email(value, required = false) {
  const normalized = text(value, "E-mail", 254, required).toLowerCase();
  if (normalized && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw httpError(400, "E-mail invalid.");
  return normalized;
}

export function days(value) {
  if (!Array.isArray(value) || !value.length || value.length > zileValide.length || !value.every(day => zileValide.includes(day)) || new Set(value).size !== value.length) throw httpError(400, "Zile de participare invalide.");
  return value;
}

export function faculties(value, required = false) {
  if (value == null && !required) return [];
  if (!Array.isArray(value) || (required && !value.length) || value.length > facultatiValide.length + 1 || new Set(value).size !== value.length) throw httpError(400, "Facultate invalidă.");
  let alternatives = 0;
  for (const faculty of value) {
    if (typeof faculty !== "string") throw httpError(400, "Facultate invalidă.");
    if (facultatiValide.includes(faculty)) continue;
    if (!faculty.startsWith("Altă: ") || !faculty.slice(6).trim() || faculty.length > 106 || ++alternatives > 1) throw httpError(400, "Facultate invalidă.");
  }
  return value;
}

export function rating(value, name, required = false) {
  if (value == null && !required) return null;
  if (!Number.isInteger(value) || value < 1 || value > 5) throw httpError(400, `${name}: alege o notă între 1 și 5.`);
  return value;
}
