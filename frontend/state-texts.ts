// The texts of a datapoint's values, as ioBroker gives them in common.states.
/**
 * The texts of a datapoint's values (common.states as object, "0:auto;1:manual" or a list), at most `max` (a card's
 * mode chips: 20); null without.
 */
export function stateTexts(states: unknown, max = 20): Record<string, string> | null {
    let out: Record<string, string> = {};
    if (Array.isArray(states)) {
        states.forEach((label, i) => (out[String(i)] = String(label)));
    } else if (typeof states === 'string') {
        for (const part of states.split(';')) {
            const at = part.indexOf(':');
            if (at > 0) {
                out[part.slice(0, at).trim()] = part.slice(at + 1).trim();
            }
        }
    } else if (states && typeof states === 'object') {
        out = Object.fromEntries(Object.entries(states as Record<string, unknown>).map(([k, v]) => [k, String(v)]));
    }
    const n = Object.keys(out).length;
    return n && n <= max ? out : null;
}
