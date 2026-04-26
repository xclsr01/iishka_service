function fallbackFilename(filename: string, fallback: string) {
  const safe = filename
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '_')
    .replace(/["\\\r\n;]/g, '_')
    .trim();

  return safe || fallback;
}

function encodeRFC5987Value(value: string) {
  return encodeURIComponent(value)
    .replace(/['()]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/\*/g, '%2A');
}

export function contentDisposition(
  disposition: 'inline' | 'attachment',
  filename: string,
  fallback = 'iishka-file',
) {
  return `${disposition}; filename="${fallbackFilename(filename, fallback)}"; filename*=UTF-8''${encodeRFC5987Value(filename || fallback)}`;
}
