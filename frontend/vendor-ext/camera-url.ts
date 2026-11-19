// The URL of a camera picture in an <img>: a still (latest.jpg, snapshot.jpg …) gets a counter so the browser fetches it
// again; an MJPEG stream (e.g. ../frigate.0/<camera>/stream.mjpeg, go2rtc's /api/stream.mjpeg) keeps its URL, else every
// tick closes the stream and opens it again (flicker, and the server encodes it once more for each client).

/** Whether a picture URL is an MJPEG stream: its path (before `?` and `#`) ends in `.mjpeg` or `.mjpg`. */
export function isStream(url: string): boolean {
    const path = url.split(/[?#]/, 1)[0];
    return /\.mjpe?g$/i.test(path);
}

/** The `src` of a camera's <img>: data URLs and streams as they are, a still with the counter `fp3d=<tick>`. */
export function cameraSrc(picture: string, tick: number | string): string {
    if (picture.startsWith('data:') || isStream(picture)) {
        return picture;
    }
    return `${picture}${picture.includes('?') ? '&' : '?'}fp3d=${tick}`;
}
