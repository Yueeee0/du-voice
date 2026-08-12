// du-voice · 渡的声音
// 基于微软 Edge TTS 的免费语音合成 Worker
// POST {input, voice, speed, pitch} 或 GET ?input=...&voice=...
// 返回 audio/mpeg 音频

const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const GEC_VERSION = '1-130.0.2849.68';
const WSS_URL = 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1';
const DEFAULT_VOICE = 'zh-CN-YunyangNeural';

const VOICES = [
  { id: 'zh-CN-XiaoxiaoNeural', name: '晓晓（女·温柔）' },
  { id: 'zh-CN-XiaoyiNeural', name: '晓伊（女·甜美）' },
  { id: 'zh-CN-YunxiNeural', name: '云希（男·年轻）' },
  { id: 'zh-CN-YunyangNeural', name: '云扬（男·沉稳）' },
  { id: 'zh-CN-YunjianNeural', name: '云健（男·浑厚）' }
];

function generateSecMsGec() {
  const ticks = (BigInt(Date.now()) + 11644473600000n) * 10000n;
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setBigUint64(0, ticks, false);
  let s = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function generateUuid() {
  if (crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function xmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildSpeechConfig() {
  const ts = new Date().toISOString();
  const payload = {
    context: {
      synthesis: {
        audio: {
          metadataoptions: { sentenceBoundaryEnabled: 'false', wordBoundaryEnabled: 'true' },
          outputFormat: 'audio-24khz-48kbitrate-mono-mp3'
        }
      }
    }
  };
  return 'X-Timestamp:' + ts + '\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n' + JSON.stringify(payload);
}

function buildSsml(text, voice, rate, pitch) {
  const ts = new Date().toISOString();
  const ssml =
    "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='zh-CN'>" +
    "<voice name='" + voice + "'><prosody pitch='" + pitch + "' rate='" + rate + "' volume='+0%'>" +
    xmlEscape(text) + '</prosody></voice></speak>';
  return 'X-Timestamp:' + ts + '\r\nContent-Type:application/ssml+xml\r\nPath:ssml\r\n\r\n' + ssml;
}

function findHeaderEnd(buf) {
  for (let i = 0; i < buf.length - 3; i++) {
    if (buf[i] === 13 && buf[i + 1] === 10 && buf[i + 2] === 13 && buf[i + 3] === 10) {
      return i + 4;
    }
  }
  return buf.length;
}

function concatChunks(chunks) {
  let total = 0;
  for (const c of chunks) total += c.byteLength;
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out.buffer;
}

function synthesize(text, voice, rate, pitch) {
  return new Promise((resolve, reject) => {
    const secMsGec = generateSecMsGec();
    const url =
      WSS_URL +
      '?TrustedClientToken=' + TRUSTED_CLIENT_TOKEN +
      '&Sec-MS-GEC=' + secMsGec +
      '&Sec-MS-GEC-Version=' + GEC_VERSION +
      '&ConnectionId=' + generateUuid();

    let ws;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      reject(new Error('ws init failed: ' + e.message));
      return;
    }

    const chunks = [];
    let done = false;
    const timer = setTimeout(() => {
      try { ws.close(); } catch (e) {}
      if (!done) { done = true; reject(new Error('synthesis timeout')); }
    }, 30000);

    const finish = (audio) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(audio);
    };
    const fail = (msg) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(new Error(msg));
    };

    ws.addEventListener('open', () => {
      try {
        ws.send(buildSpeechConfig());
        ws.send(buildSsml(text, voice, rate, pitch));
      } catch (e) {
        fail('send failed: ' + e.message);
      }
    });

    ws.addEventListener('message', (event) => {
      try {
        const data = event.data;
        if (typeof data === 'string') {
          if (data.indexOf('Path:turn.end') >= 0) {
            finish(concatChunks(chunks));
            try { ws.close(); } catch (e) {}
          }
        } else {
          const buf = new Uint8Array(data);
          const idx = findHeaderEnd(buf);
          if (idx < buf.length) {
            chunks.push(buf.slice(idx));
          }
        }
      } catch (e) {
        fail('message failed: ' + e.message);
      }
    });

    ws.addEventListener('error', () => fail('websocket error'));
    ws.addEventListener('close', () => {
      if (!done && chunks.length > 0) {
        finish(concatChunks(chunks));
      } else if (!done) {
        fail('connection closed early');
      }
    });
  });
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' }
  });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type'
        }
      });
    }

    if (url.pathname === '/voices') {
      return json({ voices: VOICES });
    }

    if (url.pathname === '/') {
      let input = '',
        voice = DEFAULT_VOICE,
        speed = 1,
        pitch = '+0Hz';
      if (request.method === 'POST') {
        try {
          const body = await request.json();
          input = body.input || body.text || '';
          voice = body.voice || DEFAULT_VOICE;
          speed = body.speed || 1;
          pitch = body.pitch || '+0Hz';
        } catch (e) {
          return json({ error: 'bad json body' }, 400);
        }
      } else {
        input = url.searchParams.get('input') || url.searchParams.get('text') || '';
        voice = url.searchParams.get('voice') || DEFAULT_VOICE;
        speed = parseFloat(url.searchParams.get('speed')) || 1;
        pitch = url.searchParams.get('pitch') || '+0Hz';
      }

      if (!input || !input.trim()) return json({ error: 'missing input' }, 400);

      const ratePct = Math.round((speed - 1) * 100);
      const rate = (ratePct >= 0 ? '+' : '') + ratePct + '%';

      try {
        const audio = await synthesize(input.trim(), voice, rate, pitch);
        return new Response(audio, {
          headers: {
            'Content-Type': 'audio/mpeg',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-store'
          }
        });
      } catch (e) {
        return json({ error: 'synthesis failed: ' + e.message }, 500);
      }
    }

    return json({ ok: true, msg: 'du-voice · 渡的声音 · POST {input, voice, speed, pitch} 或 GET ?input=' });
  }
};
