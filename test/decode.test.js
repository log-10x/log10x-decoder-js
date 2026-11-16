import { decodeSingle, createDecoder, formatTimestamp, parseTemplate, tokenizeEvent, DEFAULT_TIMESTAMP_PATTERNS } from '../src/decode.js';

// ─── Java Decoder Test Case ──────────────────────────────────────────────────
// From DecoderTest.java — space-delimited, $ prefix

const javaHash = '$bvKCbEl6WYQ';
const javaEncoded = '1441120604000 Paths yxsu ImageNet ILSVRC2012 00000622 JPEG 0 135395 00000669 153355';
const javaTemplate = "$(yy/MM/dd HH:mm:ss) INFO rdd.BinaryFileRDD: Input split: $://$//dataset//$//$_img_test//$1_test_$.$:$+$,//$7//dataset//$6//$5_img_test//$5_test_$.$4:$3+$";

// ─── Console Format Test Case ────────────────────────────────────────────────
// Comma-delimited, ~ prefix (from the Log10x console)

const consoleTemplates = {
  'abc123': '{"stream":"stdout","log":"$ service started","docker":{"container_id":"$"},"kubernetes":{"pod_name":"$-$"}}',
};

const consoleLine = '~abc123,Accounting,80d793bf,accounting,6f7cb8';

// ─── Tests ───────────────────────────────────────────────────────────────────

function assert(condition, message) {
  if (!condition) {
    console.error('FAIL:', message);
    process.exit(1);
  }
  console.log('PASS:', message);
}

// Test 1: Java format (space delimiter)
const javaDecoded = decodeSingle(javaEncoded, javaTemplate, { delimiter: ' ' });
console.log('Java decoded:', javaDecoded);
assert(javaDecoded.includes('INFO rdd.BinaryFileRDD: Input split:'), 'Java test: contains expected pattern text');
assert(javaDecoded.includes('Paths'), 'Java test: contains variable value');
assert(javaDecoded.includes('ImageNet'), 'Java test: contains ImageNet');

// Test 2: Console format (comma delimiter, ~ prefix)
const decoder = createDecoder(consoleTemplates, { delimiter: ',', prefix: '~' });
const consoleDecoded = decoder.decode(consoleLine);
console.log('Console decoded:', consoleDecoded);
assert(consoleDecoded !== null, 'Console test: decoded successfully');
assert(consoleDecoded.includes('"stream":"stdout"'), 'Console test: contains stream');
assert(consoleDecoded.includes('Accounting service started'), 'Console test: service name substituted');
assert(consoleDecoded.includes('"container_id":"80d793bf"'), 'Console test: container_id substituted');

// Test 3: Non-compact lines pass through
const passthrough = decoder.decode('regular log line');
assert(passthrough === 'regular log line', 'Non-compact line passes through');

// Test 4: Missing template returns null
const decoder2 = createDecoder({}, { delimiter: ',', prefix: '~' });
const missing = decoder2.decode('~unknownhash,val1,val2');
assert(missing === null, 'Missing template returns null');

// Test 5: Multiple events
const results = decoder.decodeAll([consoleLine, 'plain line']);
assert(results.length === 2, 'decodeAll returns correct count');
assert(results[0].includes('Accounting'), 'decodeAll first line decoded');
assert(results[1] === 'plain line', 'decodeAll second line passed through');

// Test 6: Variable reuse ($1)
const reuseTemplates = { 'reuse': '$ says hello to $1' };
const reuseDecoder = createDecoder(reuseTemplates, { delimiter: ',', prefix: '~' });
const reuseResult = reuseDecoder.decode('~reuse,Alice');
console.log('Reuse decoded:', reuseResult);
assert(reuseResult === 'Alice says hello to Alice', 'Variable reuse ($1) works');

// Test 7: Epoch timestamp
const tsTemplates = { 'ts': '$(epoch) INFO $ started' };
const tsDecoder = createDecoder(tsTemplates, { delimiter: ',', prefix: '~' });
const tsResult = tsDecoder.decode('~ts,1710864000000,MyService');
console.log('Timestamp decoded:', tsResult);
assert(tsResult.includes('1710864000000'), 'Epoch timestamp rendered');
assert(tsResult.includes('MyService started'), 'Value after timestamp works');

// Test 8: a value at the end of a line of a grouped event, before CR LF, and values
// that hold the characters of a Windows path (spaces, backslashes, parentheses, $, ~)
const crTemplates = {
  'cr': "<Data Name='AccessList'>%%$\r\n\t</Data><Data Name='ObjectName'>$</Data>",
};
const crDecoder = createDecoder(crTemplates, { delimiter: ',', prefix: '~' });
const crResult = crDecoder.decode('~cr,4432,C:\\Program Files (x86)\\$Recycle.Bin\\PROGRA~1\\a b.txt');
assert(crResult === "<Data Name='AccessList'>%%4432\r\n\t</Data><Data Name='ObjectName'>C:\\Program Files (x86)\\$Recycle.Bin\\PROGRA~1\\a b.txt</Data>",
  'A value before CR LF and a path value decode byte for byte');

// Test 9: one pattern letter writes the number without padding, two pad it (DateTimeFormatter)
const morning = Date.UTC(2024, 0, 15, 5, 5, 9);   // 2024-01-15 05:05:09 UTC
const evening = Date.UTC(2024, 0, 15, 21, 7, 3);  // 2024-01-15 21:07:03 UTC
assert(formatTimestamp(morning, 'h:mm:ss a', 0) === '5:05:09 AM', 'h: one digit for 5 AM');
assert(formatTimestamp(morning, 'hh:mm:ss a', 0) === '05:05:09 AM', 'hh: two digits for 5 AM');
assert(formatTimestamp(evening, 'h:mm a', 0) === '9:07 PM', 'h: one digit for 9 PM');
assert(formatTimestamp(morning, 'H:mm', 0) === '5:05', 'H: one digit');
assert(formatTimestamp(morning, 'HH:mm', 0) === '05:05', 'HH: two digits');
assert(formatTimestamp(morning, 'HH:m:s', 0) === '05:5:9', 'm and s: one digit');
assert(formatTimestamp(morning, 'yyyy-MM-dd HH:mm:ss', 0) === '2024-01-15 05:05:09', 'two-letter fields unchanged');

// Test: an event whose template has no value slot. The 10x Engine writes it as the hash
// alone, with no delimiter. Lines and templates below are its output (1.1.180).
const valueFreeTemplates = {
  '->GI_L4yVkB': 'space C:\\Windows\\beta.exe and more',
  ';Uvy[i10Xn': 'ads C:\\Users\\alice\\file.txt:Zone.Identifier:/$DATA',
};
const valueFree = createDecoder(valueFreeTemplates, { delimiter: ',', prefix: '~' });
assert(valueFree.decode('~->GI_L4yVkB') === 'space C:\\Windows\\beta.exe and more',
  'Hash-only line decodes to its template text');
assert(valueFree.decode('~;Uvy[i10Xn') === 'ads C:\\Users\\alice\\file.txt:Zone.Identifier:$DATA',
  'Hash-only line: template escapes are undone');
assert(valueFree.decode('~->GI_L4yVkB,') === 'space C:\\Windows\\beta.exe and more',
  'Hash followed by an empty value list decodes the same');
assert(valueFree.decode('~notahash') === '~notahash',
  'Line without a delimiter whose text is no known hash passes through');

// Test: day of the week (pattern letter E), as in the engine's shipped patterns
// "EEE MMM dd HH:mm:ss yyyy" and "EEE, dd MMM yyyy HH:mm:ss zzz"
const dowTemplates = {
  'ctime': 'job ran at $(EEE MMM dd HH:mm:ss yyyy)',
  'full': '$(EEEE dd MMM yyyy) $(EEEEE)',
  'rfc': '$(EEE, dd MMM yyyy HH:mm:ss) GMT',
};
const dow = createDecoder(dowTemplates, { delimiter: ',', prefix: '~', timezoneOffsetMinutes: 0 });
assert(dow.decode('~ctime,1794733507000') === 'job ran at Sun Nov 15 09:05:07 2026', 'EEE: short day name');
assert(dow.decode('~full,1794733507000,1794733507000') === 'Sunday 15 Nov 2026 S', 'EEEE: full name, EEEEE: first letter');
assert(dow.decode('~rfc,1794733507000') === 'Sun, 15 Nov 2026 09:05:07 GMT', 'EEE, with a comma after it');

// Test: an epoch timestamp is written back as its text. The 10x Engine reads an epoch in
// milliseconds with a fraction as the pattern +%s.%N and carries the text it read;
// templates and lines below have the shape of its output.
const epochTemplates = {
  'ms': '$(+%s.%N) INFO epoch ms fraction $ digits',
  'json': '{"ts":$(+%s.%N),"msg":"$"}',
  'ns': '$(+%s) INFO epoch ns',
};
const epochDecoder = createDecoder(epochTemplates, { delimiter: ',', prefix: '~', timezoneOffsetMinutes: 0 });
assert(epochDecoder.decode('~ms,1705313472123.456,3') === '1705313472123.456 INFO epoch ms fraction 3 digits',
  '+%s.%N: milliseconds with a fraction keep the dot');
assert(epochDecoder.decode('~ms,1705313472123.000456,6') === '1705313472123.000456 INFO epoch ms fraction 6 digits',
  '+%s.%N: leading zeros of the fraction are kept');
assert(epochDecoder.decode('~ms,1705313472123.456789123,9') === '1705313472123.456789123 INFO epoch ms fraction 9 digits',
  '+%s.%N: nine fraction digits are not rounded');
assert(epochDecoder.decode('~ms,1705313472123.0,0') === '1705313472123.0 INFO epoch ms fraction 0 digits',
  '+%s.%N: a zero fraction is kept');
assert(epochDecoder.decode('~json,1705313472123.456789,started') === '{"ts":1705313472123.456789,"msg":"started"}',
  '+%s.%N: in a JSON line');
assert(epochDecoder.decode('~ns,1705313472123456789') === '1705313472123456789 INFO epoch ns',
  '+%s: a nanosecond epoch is written as read');
assert(decodeSingle('1705313472123.5', '$(+%s.%N)', { delimiter: ',' }) === '1705313472123.5',
  'decodeSingle: +%s.%N keeps the fraction');

// Test: seconds since the epoch with a fraction, $(+%s.%f). The value is the text the
// 10x Engine read; it is written back as is, and the event time is read from its digits.
// Templates and lines are the engine's output for the source lines.
const secondsTemplates = {
  'Q<C9E6L.6o': 'type=SYSCALL msg=audit($(+%s.%f):$): arch=$ syscall=$',
  'IE{DdzvP[H': 'ts=$(+%s.%f) msg=hello',
};
const seconds = createDecoder(secondsTemplates, { delimiter: ',', prefix: '~', timezoneOffsetMinutes: 0 });
assert(seconds.decode('~Q<C9E6L.6o,1723042099.699,13369,c000003e,59') === 'type=SYSCALL msg=audit(1723042099.699:13369): arch=c000003e syscall=59',
  '+%s.%f: an audit record comes back as it was');
assert(seconds.decode('~IE{DdzvP[H,1705313472.123') === 'ts=1705313472.123 msg=hello', '+%s.%f: a logfmt line comes back as it was');
assert(seconds.decode('~IE{DdzvP[H,1723042099.600') === 'ts=1723042099.600 msg=hello', '+%s.%f: trailing zeros are kept');
assert(seconds.decode('~IE{DdzvP[H,1723042099.6') === 'ts=1723042099.6 msg=hello', '+%s.%f: one fraction digit is kept');
const secondsSlots = parseTemplate('ts=$(+%s.%f) msg=hello', DEFAULT_TIMESTAMP_PATTERNS).timestampPatterns;
const timeOf = (v) => tokenizeEvent(v, ',', 1, secondsSlots).timestampEpochs[0];
assert(timeOf('1723042099.699') === Date.UTC(2024, 7, 7, 14, 48, 19, 699), '+%s.%f: event time of 3 fraction digits, in ms');
assert(timeOf('1723042099.6') === Date.UTC(2024, 7, 7, 14, 48, 19, 600), '+%s.%f: one digit is tenths of a second, never 1970');
assert(timeOf('1705313472.022663733') === '1705313472022663733', '+%s.%f: nine digits give nanoseconds');
assert(timeOf('17230420.99') === -1 && timeOf('1723042099') === -1, '+%s.%f: a value of another shape gives no time');
assert(seconds.decode('~IE{DdzvP[H,17230420.99') === 'ts=17230420.99 msg=hello', '+%s.%f: a value of another shape keeps its text');
const millisSlots = parseTemplate('$(+%s.%N) INFO x', DEFAULT_TIMESTAMP_PATTERNS).timestampPatterns;
assert(tokenizeEvent('1705313472123.456', ',', 1, millisSlots).timestampEpochs[0] === '1705313472123456000',
  '+%s.%N: milliseconds with a fraction give nanoseconds, never 1970');

// Test: a multi-line event's template joins its lines with the break each line was read
// with, LF, CR LF or a CR alone; a value slot right before either kind of CR is a slot.
const loneCrTemplates = { 'w': "<Data Name='AccessList'>%%$\r\t\t\t\t%%$\r\n\t\t\t\t<//Data>\n<Data Name='AccessMask'>$<//Data>" };
const loneCr = createDecoder(loneCrTemplates, { delimiter: ',', prefix: '~' });
assert(loneCr.decode('~w,4432,4433,0x1') === "<Data Name='AccessList'>%%4432\r\t\t\t\t%%4433\r\n\t\t\t\t</Data>\n<Data Name='AccessMask'>0x1</Data>",
  'A lone CR and a CR LF inside an event: slots before them are values');

console.log('\nAll tests passed.');
