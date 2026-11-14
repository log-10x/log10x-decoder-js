import { decodeSingle, createDecoder, formatTimestamp } from '../src/decode.js';

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

console.log('\nAll tests passed.');
