// Timestamp rendering must not depend on the zone of the machine that decodes.
//
// Regression: with timezoneOffsetMinutes 0 and the pattern below, a host in
// America/New_York rendered 2020-11-01T05:05:16.696563Z as 04:05:16, one hour off, for
// every event between 02:00 and 06:00 UTC that day (the host's daylight-saving change),
// and in March one hour late. The smallest input that shows it is one template holding
// only the timestamp and one encoded value, taken from a CloudTrail sample (24 of 8,100
// events were affected there).
//
// A zone name (options.timezone) and the system zone must take the zone's offset at each
// timestamp's instant, as java.time's ZoneId does in the Java decoder; they used the
// offset on the day the decoder ran, so summer events decoded in winter were one hour off.
//
// Each host zone is set through process.env.TZ, which Node applies to later Date calls.

import { createDecoder, decodeSingle } from '../src/decode.js';

let failed = 0;
function check(actual, expected, message) {
  if (actual === expected) {
    console.log('PASS:', message);
  } else {
    failed++;
    console.error(`FAIL: ${message}\n  expected ${expected}\n  actual   ${actual}`);
  }
}

const HOST_ZONES = [
  'UTC',
  'America/New_York',     // DST ends 2020-11-01 06:00 UTC, starts 2020-03-08 07:00 UTC
  'America/Los_Angeles',  // DST ends 2020-11-01 09:00 UTC
  'Europe/London',
  'Australia/Sydney',     // southern hemisphere: DST starts 2020-10-04
  'Asia/Kolkata',         // +05:30, no DST
];

const ISO = "$(yyyy-MM-dd'T'HH:mm:ss.SSSSSS'Z')";    // CloudTrail eventTime pattern (quoted Z: UTC)
const OFFSET = '$(yyyy-MM-dd HH:mm:ss.SSSZ)';          // unquoted Z: UTC, renders the offset
const LOCAL = '$(yyyy-MM-dd HH:mm:ss)';                // no zone field: configured zone
const AMPM = '$(MMM d hh:mm:ss a)';

const originalTz = process.env.TZ;
for (const hostZone of HOST_ZONES) {
  process.env.TZ = hostZone;
  const at = `[host ${hostZone}]`;

  const utc = createDecoder({ iso: ISO, off: OFFSET, loc: LOCAL, ampm: AMPM }, { timezoneOffsetMinutes: 0 });
  // The CloudTrail events, nanosecond epochs.
  check(utc.decode('~iso,1604207116696563000'), '2020-11-01T05:05:16.696563Z', `${at} 2020-11-01 05:05Z, one hour before the US DST end`);
  check(utc.decode('~iso,1604196258446822000'), '2020-11-01T02:04:18.446822Z', `${at} 2020-11-01 02:04Z, four hours before the US DST end`);
  check(utc.decode('~iso,1604210716696563000'), '2020-11-01T06:05:16.696563Z', `${at} 2020-11-01 06:05Z, after the US DST end`);
  // Spring change, millisecond epoch.
  check(utc.decode('~iso,1583638200000'), '2020-03-08T03:30:00.000000Z', `${at} 2020-03-08 03:30Z, before the US DST start`);
  // A zone field renders the offset the fields were rendered in (UTC here), not the host's.
  check(utc.decode('~off,1604207116696'), '2020-11-01 05:05:16.696+0000', `${at} unquoted Z renders +0000`);
  check(utc.decode('~loc,1604207116696'), '2020-11-01 05:05:16', `${at} no zone field, offset 0`);
  check(utc.decode('~ampm,1604207116696'), 'Nov 1 05:05:16 AM', `${at} 12-hour clock`);

  // A configured fixed offset is applied as given, wherever the host is.
  const minus4 = createDecoder({ loc: LOCAL, off: OFFSET }, { timezoneOffsetMinutes: -240 });
  check(minus4.decode('~loc,1604207116696'), '2020-11-01 01:05:16', `${at} fixed offset -240`);
  check(minus4.decode('~loc,1604210716696'), '2020-11-01 02:05:16', `${at} fixed offset -240, after the US DST end`);
  check(minus4.decode('~off,1604207116696'), '2020-11-01 05:05:16.696+0000', `${at} Z pattern ignores the configured offset`);
  const plus530 = createDecoder({ loc: LOCAL }, { timezoneOffsetMinutes: 330 });
  check(plus530.decode('~loc,1604187000000'), '2020-11-01 05:00:00', `${at} fixed offset +330 across midnight UTC`);

  // A zone name takes the zone's offset at each timestamp, as java.time's ZoneId does,
  // not the offset on the day the decoder runs.
  const ny = createDecoder({ loc: LOCAL, off: OFFSET }, { timezone: 'America/New_York' });
  check(ny.decode('~loc,1594052800000'), '2020-07-06 12:26:40', `${at} zone name, summer (EDT)`);
  check(ny.decode('~loc,1606824000000'), '2020-12-01 07:00:00', `${at} zone name, winter (EST)`);
  check(ny.decode('~loc,1604210399000'), '2020-11-01 01:59:59', `${at} zone name, last second of EDT`);
  check(ny.decode('~loc,1604210400000'), '2020-11-01 01:00:00', `${at} zone name, first second of EST`);
  check(ny.decode('~off,1594052800000'), '2020-07-06 16:26:40.000+0000', `${at} zone name, Z pattern stays UTC`);
  check(decodeSingle('1594052800000 x', '$(yyyy-MM-dd HH:mm:ss) $', { timezone: 'America/New_York' }),
    '2020-07-06 12:26:40 x', `${at} decodeSingle with a zone name`);
}

// No zone given: the system zone, with its offset at each timestamp.
process.env.TZ = 'America/New_York';
const sys = createDecoder({ loc: LOCAL }, {});
check(sys.decode('~loc,1594052800000'), '2020-07-06 12:26:40', '[host America/New_York] system zone, summer');
check(sys.decode('~loc,1606824000000'), '2020-12-01 07:00:00', '[host America/New_York] system zone, winter');
process.env.TZ = originalTz;

// Every minute across both 2020 changes in two zones, in order and then interleaved,
// against Intl's own wall-clock rendering of the same instant.
for (const zone of ['America/New_York', 'Europe/London']) {
  const wall = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const expect = (ms) => {
    const p = Object.fromEntries(wall.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
  };
  const dec = createDecoder({ loc: LOCAL }, { timezone: zone });
  const instants = [];
  for (const start of [Date.UTC(2020, 2, 7, 22), Date.UTC(2020, 2, 28, 22), Date.UTC(2020, 9, 24, 22), Date.UTC(2020, 9, 31, 22)]) {
    for (let m = 0; m < 12 * 60; m++) instants.push(start + m * 60000 + 7000);
  }
  const interleaved = instants.map((_, i) => instants[(i * 7919) % instants.length]);
  let wrong = 0;
  for (const ms of instants.concat(interleaved)) {
    if (dec.decode(`~loc,${ms}`) !== expect(ms)) wrong++;
  }
  check(wrong, 0, `zone name ${zone}: ${instants.length * 2} minutes across the 2020 changes match Intl`);
}

// An unknown zone name is still refused when the decoder is created.
let threw = false;
try { createDecoder({}, { timezone: 'Not/AZone' }); } catch (e) { threw = e instanceof RangeError; }
check(threw, true, 'unknown zone name throws RangeError');

if (failed) {
  console.error(`\n${failed} timestamp zone check(s) failed.`);
  process.exit(1);
}
console.log('\nAll timestamp zone tests passed.');
