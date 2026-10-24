/**
 * Tastele din timpul proiecției, aceleași în toate ferestrele (principală, bara de
 * jos, ecranul de proiecție). Telecomenzile de prezentare trimit fie săgeți, fie
 * PageUp/PageDown, așa că toate schimbă strofa sau versetul; mărimea textului e pe
 * + și − (și de pe tastatura numerică). Cu Ctrl/Cmd/Alt nu răspundem: sunt ale
 * sistemului.
 */
export type ProjectionKey = 'next' | 'prev' | 'zoom-in' | 'zoom-out';

export function keyAction(e: KeyboardEvent): ProjectionKey | null {
    if (e.ctrlKey || e.metaKey || e.altKey) return null;
    switch (e.key) {
        case 'ArrowRight': case 'ArrowDown': case 'PageDown': case ' ':
            return 'next';
        case 'ArrowLeft': case 'ArrowUp': case 'PageUp':
            return 'prev';
        case '+': case '=':
            return 'zoom-in';
        case '-': case '_':
            return 'zoom-out';
        default:
            return null;
    }
}
