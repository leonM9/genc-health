/**
 * Client-side cryptography utilities for Gen C dApp.
 * - AES-256-GCM file encryption / decryption (Web Crypto)
 * - Simulated CP-ABE policy builder
 * - keccak256 Merkle root preview (ethers)
 */
import { ethers } from "ethers";

const enc = new TextEncoder();
const dec = new TextDecoder();

export async function generateAesKey() {
  return await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
}

export async function exportKeyB64(key) {
  const raw = await crypto.subtle.exportKey("raw", key);
  return arrayBufferToB64(raw);
}

export async function importKeyB64(b64) {
  const raw = b64ToArrayBuffer(b64);
  return await crypto.subtle.importKey("raw", raw, "AES-GCM", true, ["encrypt", "decrypt"]);
}

export async function aesEncryptFile(file, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const buf = await file.arrayBuffer();
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, buf);
  // packed: 12-byte IV || ciphertext
  const packed = new Uint8Array(iv.length + ct.byteLength);
  packed.set(iv, 0);
  packed.set(new Uint8Array(ct), iv.length);
  return new Blob([packed], { type: "application/octet-stream" });
}

export async function aesDecryptBlob(blob, key) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  const iv = buf.slice(0, 12);
  const ct = buf.slice(12);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new Blob([pt]);
}

export function arrayBufferToB64(buf) {
  let s = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

export function b64ToArrayBuffer(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out.buffer;
}

/** Build a CP-ABE-style policy string. */
export function buildPolicy({ patientAddress, doctorDepartment }) {
  const dept = (doctorDepartment || "general").trim();
  return `(Role:Doctor AND Department:${dept}) OR (Owner:${patientAddress})`;
}

/** Compute keccak256 Merkle root for preview (matches backend). */
export function merklePreview(leaves) {
  if (!leaves || leaves.length === 0) return { root: "0x" + "0".repeat(64), layers: [] };
  let layer = leaves.map((l) => ethers.keccak256(ethers.toUtf8Bytes(l)));
  const layers = [layer.slice()];
  while (layer.length > 1) {
    const nxt = [];
    for (let i = 0; i < layer.length; i += 2) {
      const a = layer[i];
      const b = layer[i + 1] || layer[i];
      const concat = ethers.concat([a, b]);
      nxt.push(ethers.keccak256(concat));
    }
    layer = nxt;
    layers.push(layer.slice());
  }
  return { root: layer[0], layers };
}

export function shortAddr(addr) {
  if (!addr) return "";
  return addr.slice(0, 6) + "…" + addr.slice(-4);
}
