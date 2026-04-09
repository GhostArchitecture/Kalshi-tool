/**
 * WEATHER_EDGE_TERMINAL — engine/worker.js
 *
 * Background thread: METAR polling + edge computation.
 */

let state   = {};
let targets = {};

self.onmessage = (e) => {
    const { type } = e.data;

    if (type === 'INIT') {
        targets = e.data.targets;
        for (const [icao, targetF] of Object.entries(targets)) {
            state[icao] = { ask: null, temp: null };
            poll(icao, targetF);
        }
    }

    if (type === 'MARKET') {
        const { icao, ask } = e.data;
        if (state[icao]) state[icao].ask = ask;
    }
};

async function poll(icao, targetF) {
    try {
        const res  = await fetch(
            `https://aviationweather.gov/api/data/metar?ids=${icao}&format=json`
        );
        const json = await res.json();

        if (!json?.length) throw new Error('empty response');

        const raw = json[0].rawOb;
        if (!raw) throw new Error('no rawOb field');

        // T-group: T0256 = +25.6°C, T1012 = −01.2°C
        const tMatch = raw.match(/\bT([01]\d{3})\b/);

        let tempC;
        if (tMatch) {
            const digits = tMatch[1];
            const sign   = digits[0] === '1' ? -1 : 1;
            tempC = sign * parseInt(digits.substring(1), 10) / 10;
        } else {
            // Fallback: standard temp group (less precise)
            const stdMatch = raw.match(/\s(-?\d{2})\/(-?\d{2})\s/);
            tempC = stdMatch ? parseInt(stdMatch[1], 10) : 0;
        }
        const tempF = (tempC * 1.8) + 32;

        state[icao].temp = tempF;

        const ask         = state[icao].ask ?? 1.0;
        const impliedProb = tempF >= targetF ? 1.0 : 0.0;
        const FEE         = 0.07;
        const edge        = impliedProb > 0 ? impliedProb - ask - FEE : 0;

        const gap    = targetF - tempF;
        const status = gap <= 1.5 ? 'STRIKE' : 'IDLE';

        postMessage({ icao, currentF: tempF, ask, edge, isTriggered: edge > 0, status });

        const delay = gap <= 1.5 ? 3_000 : 30_000;
        setTimeout(() => poll(icao, targetF), delay);

    } catch (err) {
        console.error(`[worker] poll failed for ${icao}:`, err.message);
        postMessage({
            icao,
            currentF:    state[icao]?.temp ?? 0,
            ask:         state[icao]?.ask  ?? 1.0,
            edge:        0,
            isTriggered: false,
            status:      'OFFLINE',
        });
        setTimeout(() => poll(icao, targetF), 60_000);
    }
}
