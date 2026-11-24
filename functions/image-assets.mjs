import { fail, nowIso, uuid } from './model.mjs';

const TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const MAX_BYTES = 4 * 1024 * 1024;
const TTL_MS = 30 * 60 * 1000;

export function normalizeImageAsset(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('invalid_input');
  const mimeType = String(input.mime_type || '');
  const dataUrl = String(input.data_url || '');
  if (!TYPES.has(mimeType)) fail('invalid_input');
  const match = dataUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match || match[1] !== mimeType) fail('invalid_input');
  const padding = match[2].endsWith('==') ? 2 : match[2].endsWith('=') ? 1 : 0;
  const bytes = Math.floor(match[2].length * 3 / 4) - padding;
  if (bytes > MAX_BYTES) fail('payload_too_large', 413);
  return { mime_type: mimeType, data_url: dataUrl, bytes };
}

function prune(runtime) {
  const now = Date.now();
  for (const [id, asset] of runtime.imageAssets.entries()) {
    if (now - Date.parse(asset.created_at) > TTL_MS) runtime.imageAssets.delete(id);
  }
}

export function createImageAsset(runtime, deviceId, input) {
  runtime.imageAssets ||= new Map();
  prune(runtime);
  const image = normalizeImageAsset(input);
  const id = uuid();
  runtime.imageAssets.set(id, {
    id, device_id: deviceId, mime_type: image.mime_type, data_url: image.data_url,
    bytes: image.bytes, created_at: nowIso(),
  });
  return { image_asset_id: id, bytes: image.bytes };
}

export function takeImageAsset(runtime, deviceId, imageAssetId) {
  runtime.imageAssets ||= new Map();
  prune(runtime);
  const asset = runtime.imageAssets.get(String(imageAssetId || '').toLowerCase());
  if (!asset || asset.device_id !== deviceId) fail('not_found', 404);
  runtime.imageAssets.delete(asset.id);
  return asset;
}
