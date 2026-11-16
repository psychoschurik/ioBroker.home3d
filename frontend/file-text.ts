// Text of a file as `readFile64` of the web socket delivers it.

function fromBase64(base64: string): string {
    const raw = atob(base64);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) {
        bytes[i] = raw.charCodeAt(i);
    }
    return new TextDecoder().decode(bytes);
}

/**
 * `readFile64` of `@iobroker/socket-classes` sends JSON files (mime type `application/json`, `.json5`) as
 * base64 of `encodeURIComponent(content)`, other files as base64 of their bytes. Raw JSON never starts with
 * `%`, so only such text is decoded (older servers send JSON unencoded).
 */
export function fileText(base64: string, mimeType?: string | null): string {
    const text = fromBase64(base64);
    if (/json/i.test(mimeType || '') && text.startsWith('%')) {
        try {
            return decodeURIComponent(text);
        } catch {
            return text;
        }
    }
    return text;
}
