// The shared reader vectors (FORMAT_SPEC S6.4): templates and encoded lines the engine wrote
// for events read with CR LF, inside and at the end of an event, a CR alone inside an event,
// and the same lines read with LF, with the exact text each decodes to. The same file is
// checked by the engine's decoder, the Java decoder and the format's reference
// implementation (log10x-format fixtures/line-end-vectors.json).
import { readFileSync } from 'node:fs';
import { createDecoder } from '../src/decode.js';

const data = JSON.parse(readFileSync(new URL('./line-end-vectors.json', import.meta.url), 'utf8'));

const decoder = createDecoder(data.templates, {
  delimiter: ',', prefix: '~', timezoneOffsetMinutes: data.timezoneOffsetMinutes || 0,
});

const visible = (s) => (s === null || s === undefined) ? String(s) : s.replace(/\r/g, '\\r').replace(/\n/g, '\\n');

let failed = 0;
for (const event of data.events) {
  const got = decoder.decode(event.encoded);
  if (got !== event.text) {
    failed++;
    console.error(`FAIL ${event.encoded}\n  expected ${visible(event.text)}\n  got      ${visible(got)}`);
  }
}

console.log(`${data.events.length - failed} of ${data.events.length} encoded lines decode to their text`);

if (failed > 0) {
  process.exit(1);
}
