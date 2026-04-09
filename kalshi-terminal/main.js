/**
 * WEATHER_EDGE_TERMINAL — main.js
 *
 * Auth: Kalshi's trading WS requires a session token obtained via
 * POST /trade-api/v2/log_in (REST). Store the returned token in
 * sessionStorage and pass it below, or use a local signing proxy.
 * Never hard-code credentials in this file.
 *
 * To set token: sessionStorage.setItem('kalshi_token', 'your_token')
 */

const SESSION_TOKEN = sessionStorage.getItem('kalshi_token') || '';

const markets = {
    'KXCHITEMP-26APR-T85': 'KORD',
    'KXNYCTEMP-26APR-T90': 'KNYC',
    'KXMIATEMP-26APR-T92': 'KMIA',
    'KXAUSTEMP-26APR-T95': 'KAUS',
};

const targets = {
    KORD: 85.0,
    KNYC: 90.0,
    KMIA: 92.0,
    KAUS: 95.0,
};

// Build grid rows
const grid = document.getElementById('terminal-grid');
Object.values(markets).forEach(icao => {
    const row = document.createElement('div');
    row.id = `row-${icao}`;
    row.className = 'row';
    row.innerHTML = `
        <span>${icao}</span>
        <span id="${icao}-temp">--.--</span>
        <span id="${icao}-target">${targets[icao].toFixed(1)}</span>
        <span id="${icao}-ask">--.--</span>
        <span id="${icao}-edge">--.--</span>
        <span id="${icao}-status" class="status-offline">OFFLINE</span>
    `;
    grid.appendChild(row);
});

// Worker
const weatherWorker = new Worker('engine/worker.js');
weatherWorker.postMessage({ type: 'INIT', targets });

weatherWorker.onmessage = (e) => {
    const { icao, currentF, ask, edge, isTriggered, status } = e.data;
    const row = document.getElementById(`row-${icao}`);
    if (!row) return;

    document.getElementById(`${icao}-temp`).textContent  = currentF.toFixed(2);
    document.getElementById(`${icao}-ask`).textContent   = ask.toFixed(2);
    document.getElementById(`${icao}-edge`).textContent  = (edge * 100).toFixed(1) + '%';

    const statusEl = document.getElementById(`${icao}-status`);
    statusEl.textContent = status;
    statusEl.className   = `status-${status.toLowerCase()}`;

    if (isTriggered) row.classList.add('trigger');
    else             row.classList.remove('trigger');
};

// Kalshi WebSocket
function connectKalshi() {
    const ws = new WebSocket('wss://trading-api.kalshi.com/trade-api/v2/ws');

    ws.onopen = () => {
        ws.send(JSON.stringify({
            id:  1,
            cmd: 'subscribe',
            params: {
                channels: ['orderbook_delta'],
                market_tickers: Object.keys(markets),
            },
            ...(SESSION_TOKEN && { token: SESSION_TOKEN }),
        }));
        console.log('[WS] connected + subscribed');
    };

    ws.onmessage = (e) => {
        let data;
        try { data = JSON.parse(e.data); } catch { return; }

        if (data.type !== 'orderbook_delta') return;

        const msg    = data.msg;
        const ticker = msg?.market_ticker;
        const icao   = markets[ticker];
        if (!icao) return;

        const noBids = msg?.no;
        if (!noBids?.length) return;

        const bestNoBid = noBids[0][0];
        const yesAsk    = 1.0 - (bestNoBid / 100);

        weatherWorker.postMessage({ type: 'MARKET', icao, ask: yesAsk });
    };

    ws.onerror = (err) => console.error('[WS] error', err);
    ws.onclose = ()    => {
        console.warn('[WS] closed — reconnecting in 5s');
        setTimeout(connectKalshi, 5000);
    };
}

connectKalshi();
