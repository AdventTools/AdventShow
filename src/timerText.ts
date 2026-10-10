/**
 * Mărimea mesajului de la finalul numărătorii, aceeași pe proiecție și în
 * previzualizare. Mesajul nu mai primește mărimea cifrelor ceasului (22vw): un
 * „Bine ați venit la serviciul de închinare" ieșea din ecran. Rezultatul e în
 * procente din lățimea ecranului; unitatea o pune fiecare (vw sau cqi).
 */
export function zeroMessageSize(message: string, withTitle: boolean): number {
    const lines = message.split('\n');
    const longest = Math.max(1, ...lines.map(l => l.trim().length));
    // pe lățime: rândul cel mai lung încape (litere groase ≈ 0,6 din înălțime)
    const byWidth = 170 / longest;
    // pe înălțime, în procente din lățime la 16:9: 56,25 = toată înălțimea
    const usable = withTitle ? 40 : 48;
    const byHeight = usable / (lines.length * 1.2);
    return Math.max(3, Math.min(16, byWidth, byHeight));
}
