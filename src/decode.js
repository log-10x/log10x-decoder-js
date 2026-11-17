/**
 * Log10x Decoder for JavaScript
 *
 * Decodes Log10x-encoded log events back to their original form.
 * Port of the Java decoder (log10x-decoder-java).
 *
 * @author Dor Levi (original Java), ported to JavaScript
 * @license Apache-2.0
 */

// ─── Constants ───────────────────────────────────────────────────────────────

// CR is a delimiter (FORMAT_SPEC S2.1): a multi-line event's template joins its lines with
// the break each was read with, so CR sits between a line's last token and the next line.
const TOKEN_DELIMS = '<>|. ][:-+/*=\\,{}_();\'\"$\t\n\r@%';
const TOKEN_DELIM_SET = new Set(TOKEN_DELIMS.split(''));

const VAR_PLACEHOLDER = '$';
const VAR_ESCAPE = '/';
const TIMESTAMP_PREFIX = '$(';
const TIMESTAMP_POSTFIX = ')';

const MINUS_ONE_LEN = 2; // "-1".length

// Token types (ordinals match Java)
const TT_SYMBOL = 0;
const TT_VAR = 1;
const TT_DELIM = 2;
const TT_MINUS_ONE = 3;

// Segment types
const SEG_PATTERN = 0;
const SEG_VAR = 1;
const SEG_TIMESTAMP = 2;

// Epoch threshold: Jan 1, 2100 in millis
const JAN_FIRST_2100 = 4102444800000;

// ─── Default timestamp patterns ──────────────────────────────────────────────

const DEFAULT_TIMESTAMP_PATTERNS = new Set([
  "yyyy-MM-dd'T'HH:mm:ss*SSSZZZZ",
  "yyyy MMM dd HH:mm:ss.SSS zzzZ",
  "MMM dd HH:mm:ss ZZZZ yyyy",
  "dd/MMM/yyyy:HH:mm:ss ZZZZ",
  "MMM dd, yyyy hh:mm:ss a",
  "MMM dd yyyy HH:mm:ss",
  "MMM  d HH:mm:ss",
  "MMM dd HH:mm:ss yyyy",
  "MMM dd HH:mm:ss ZZZZ",
  "MMM dd HH:mm:ss",
  "yyyy-MM-dd'T'HH:mm:ssZZZZ",
  "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
  "yyyy-MM-dd HH:mm:ss ZZZZ",
  "yyyy-MM-dd HH:mm:ssZZZZ",
  "yyyy-MM-dd HH:mm:ss,SSS",
  "yyyy/MM/dd*HH:mm:ss",
  "yyyy MMM dd HH:mm:ss.SSS*zzz",
  "yyyy MMM dd HH:mm:ss.SSS",
  "yyyy-MM-dd HH:mm:ss.S",
  "yyyy-MM-dd HH:mm:ss,SSSZZZZ",
  "yyyy-MM-dd HH:mm:ss.SSS",
  "yyyy-MM-dd HH:mm:ss.SSSZZZZ",
  "yyyy-MM-dd'T'HH:mm:ss.SSS",
  "yyyy-MM-dd'T'HH:mm:ss",
  "yyyy-MM-dd'T'HH:mm:ss'Z'",
  "yyyy-MM-dd*HH:mm:ss:SSS",
  "yyyy-MM-dd*HH:mm:ss",
  "yy-MM-dd HH:mm:ss,SSS ZZZZ",
  "yy-MM-dd HH:mm:ss,SSS",
  "yy-MM-dd HH:mm:ss",
  "yy/MM/dd HH:mm:ss",
  "yyMMdd HH:mm:ss",
  "yyyyMMdd HH:mm:ss.SSS",
  "MM/dd/yy*HH:mm:ss",
  "MM/dd/yyyy*HH:mm:ss",
  "MM/dd/yyyy*HH:mm:ss*SSS",
  "MM/dd/yy HH:mm:ss ZZZZ",
  "MM/dd/yyyy HH:mm:ss ZZZZ",
  "HH:mm:ss",
  "HH:mm:ss.SSS",
  "HH:mm:ss,SSS",
  "dd/MMM HH:mm:ss,SSS",
  "dd/MMM/yyyy:HH:mm:ss",
  "dd/MMM/yyyy HH:mm:ss",
  "dd-MMM-yyyy HH:mm:ss",
  "dd-MMM-yyyy HH:mm:ss.SSS",
  "dd MMM yyyy HH:mm:ss",
  "dd MMM yyyy HH:mm:ss*SSS",
  "MMdd_HH:mm:ss",
  "MMdd_HH:mm:ss.SSS",
  "MM/dd/yyyy hh:mm:ss a:SSS",
  "MM/dd/yyyy hh:mm:ss a",
]);

// ─── Utility Functions ───────────────────────────────────────────────────────

function isTokenDelim(c) {
  return TOKEN_DELIM_SET.has(c);
}

function isNumeral(c) {
  return c >= '0' && c <= '9';
}

function isNegativeNum(chars, c, index, end) {
  if (c !== '-') return false;
  if (index >= end - 1) return false;
  return isNumeral(chars[index + 1]);
}

function regionMatches(chars, index, target) {
  for (let i = 0; i < target.length; i++) {
    if (chars[index + i] !== target[i]) return false;
  }
  return true;
}

function parseLong(chars, start, end, defaultValue) {
  // For large numbers (nanosecond epochs), return as string to preserve precision
  const len = end - start;
  if (len > 15) {
    // Validate all digits first
    for (let i = start; i < end; i++) {
      const c = chars[i];
      if (c < '0' || c > '9') return defaultValue;
    }
    return chars.slice(start, end).join('');
  }
  let result = 0;
  for (let i = start; i < end; i++) {
    const c = chars[i];
    if (c < '0' || c > '9') return defaultValue;
    result = result * 10 + (c.charCodeAt(0) - 48);
  }
  return result;
}

function parseIntFromStr(s, defaultValue) {
  let result = 0;
  let sign = 1;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c < '0' || c > '9') {
      if (i === 0 && c === '-') { sign = -1; continue; }
      return defaultValue;
    }
    result = result * 10 + (c.charCodeAt(0) - 48);
  }
  return result * sign;
}

// ─── JSON Unescape ───────────────────────────────────────────────────────────

function unescapeJson(str) {
  // Fast path: no backslash means nothing to unescape
  if (str.indexOf('\\') === -1) return str;
  let result = '';
  for (let i = 0; i < str.length; i++) {
    if (str[i] === '\\' && i + 1 < str.length) {
      const next = str[i + 1];
      switch (next) {
        case '"': result += '"'; i++; break;
        case '\\': result += '\\'; i++; break;
        case '/': result += '/'; i++; break;
        case 'b': result += '\b'; i++; break;
        case 'f': result += '\f'; i++; break;
        case 'n': result += '\n'; i++; break;
        case 'r': result += '\r'; i++; break;
        case 't': result += '\t'; i++; break;
        case 'u':
          if (i + 5 < str.length) {
            const hex = str.substring(i + 2, i + 6);
            const code = parseInt(hex, 16);
            if (!isNaN(code)) { result += String.fromCharCode(code); i += 5; break; }
          }
          result += str[i]; break;
        default: result += str[i]; break;
      }
    } else {
      result += str[i];
    }
  }
  return result;
}

// ─── Timestamp Formatting ────────────────────────────────────────────────────

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

function pad(n, len) {
  let s = String(n);
  while (s.length < len) s = '0' + s;
  return s;
}

/**
 * Converts a Java-style DateTimeFormatter pattern to a formatted date string.
 * Handles the most common patterns found in log timestamps.
 *
 * timezoneOffsetMinutes is a fixed offset in minutes east of UTC, or a zone name such
 * as 'America/New_York', or undefined for the system zone. For a zone name and for the
 * system zone the offset is taken at the timestamp's own instant, so daylight saving
 * applies as it does in the Java decoder's ZoneId.
 */
function formatTimestamp(epoch, pattern, timezoneOffsetMinutes) {
  // Epoch patterns — just return the number/string
  if (pattern === 'epoch' || pattern === '+%s' || pattern === '+%s.%N' || pattern === '+%s.%f') return String(epoch);
  if (pattern === 'epochNano') return String(epoch);

  // Handle string epochs (nanosecond precision preserved as string)
  let dateMs;
  let nanoFractionStr = '000000000';
  if (typeof epoch === 'string') {
    // String epoch — parse precisely using string operations
    // Nanosecond epoch: first N-9 digits are seconds, last 9 are nanoseconds
    const epochStr = epoch;
    if (epochStr.length > 13) {
      // Nanosecond epoch
      const secStr = epochStr.substring(0, epochStr.length - 9);
      nanoFractionStr = epochStr.substring(epochStr.length - 9);
      const sec = Number(secStr); // safe: seconds < 2^53
      dateMs = sec * 1000;
    } else {
      dateMs = Number(epochStr);
      const ms = dateMs % 1000;
      nanoFractionStr = String(ms).padStart(3, '0') + '000000';
    }
  } else if (epoch > JAN_FIRST_2100) {
    // Numeric nanosecond epoch (precision may be lost for > 2^53)
    const sec = Math.floor(epoch / 1000000000);
    const nanoFraction = epoch - sec * 1000000000;
    nanoFractionStr = String(nanoFraction).padStart(9, '0');
    dateMs = sec * 1000;
  } else {
    dateMs = epoch;
    const ms = epoch % 1000;
    nanoFractionStr = String(ms).padStart(3, '0') + '000000';
  }

  // Per-pattern timezone: patterns with Z or X use UTC, others use configured timezone
  // This matches the Java core product's FormatterTimestampPattern behavior
  const patternUsesUtc = pattern.indexOf('Z') !== -1 || pattern.indexOf('X') !== -1;
  let tzOffMin;
  if (patternUsesUtc) tzOffMin = 0;
  else if (typeof timezoneOffsetMinutes === 'string') tzOffMin = zoneOffsetAt(timezoneOffsetMinutes, dateMs);
  else if (timezoneOffsetMinutes !== undefined) tzOffMin = timezoneOffsetMinutes;
  else tzOffMin = -new Date(dateMs).getTimezoneOffset();
  // Wall-clock fields are read with the UTC getters from the instant shifted by the
  // zone offset, so the host's own zone never enters the result. Reading the shifted
  // instant with the local getters applied the host's offset at the shifted instant;
  // within a few hours of a host daylight-saving change that offset differs from the
  // one at the real instant, and those timestamps rendered one hour off.
  const date = new Date(dateMs + tzOffMin * 60000);

  const yyyy = date.getUTCFullYear();
  const yy = pad(yyyy % 100, 2);
  const MM = pad(date.getUTCMonth() + 1, 2);
  const dd = pad(date.getUTCDate(), 2);
  const d = date.getUTCDate();
  const HH = pad(date.getUTCHours(), 2);
  const mm = pad(date.getUTCMinutes(), 2);
  const ss = pad(date.getUTCSeconds(), 2);
  const MMM = MONTH_NAMES[date.getUTCMonth()];

  // 12-hour clock
  let hh12 = date.getUTCHours() % 12;
  if (hh12 === 0) hh12 = 12;
  const hh = pad(hh12, 2);
  const a = date.getUTCHours() < 12 ? 'AM' : 'PM';

  // Timezone offset: the offset the fields above were rendered in, not the host's
  const tzOff = tzOffMin;
  const tzSign = tzOff >= 0 ? '+' : '-';
  const tzH = pad(Math.floor(Math.abs(tzOff) / 60), 2);
  const tzM = pad(Math.abs(tzOff) % 60, 2);
  const ZZZZ = tzSign + tzH + tzM;

  // Build the output by replacing pattern tokens
  // Handle quoted literals first: 'T', 'Z', etc.
  let result = '';
  let i = 0;
  while (i < pattern.length) {
    if (pattern[i] === "'") {
      // Quoted literal
      let j = i + 1;
      while (j < pattern.length && pattern[j] !== "'") j++;
      result += pattern.substring(i + 1, j);
      i = j + 1;
    } else {
      // Count consecutive same chars
      const c = pattern[i];
      let count = 1;
      while (i + count < pattern.length && pattern[i + count] === c) count++;

      switch (c) {
        case 'y':
          result += count <= 2 ? yy : pad(yyyy, count);
          break;
        case 'M':
          if (count >= 3) result += MMM;
          else result += count === 2 ? MM : String(date.getUTCMonth() + 1);
          break;
        case 'd':
          result += count >= 2 ? dd : String(d);
          break;
        // H, h, m and s follow DateTimeFormatter: one letter writes the number
        // without padding (5), more letters pad it to that width (05).
        case 'H':
          result += count === 1 ? String(date.getUTCHours()) : (count === 2 ? HH : pad(date.getUTCHours(), count));
          break;
        case 'h':
          result += count === 1 ? String(hh12) : (count === 2 ? hh : pad(hh12, count));
          break;
        case 'm':
          result += count === 1 ? String(date.getUTCMinutes()) : (count === 2 ? mm : pad(date.getUTCMinutes(), count));
          break;
        case 's':
          result += count === 1 ? String(date.getUTCSeconds()) : (count === 2 ? ss : pad(date.getUTCSeconds(), count));
          break;
        case 'S':
          // Use nanoFractionStr for all precision levels
          result += nanoFractionStr.substring(0, count);
          break;
        case 'Z':
        case 'z':
          result += ZZZZ;
          break;
        case 'E': {
          // day of the week, as DateTimeFormatter writes it in English: 1-3 letters
          // short (Tue), 4 the full name (Tuesday), 5 the first letter (T)
          const day = DAY_NAMES[date.getUTCDay()];
          result += count <= 3 ? day.substring(0, 3) : (count === 4 ? day : day.substring(0, 1));
          break;
        }
        case 'a':
          result += a;
          break;
        default:
          result += pattern.substring(i, i + count);
          break;
      }
      i += count;
    }
  }

  return result;
}

// ─── Template Lexer ──────────────────────────────────────────────────────────

/**
 * Parses a template string into segments (Pattern, Var, Timestamp).
 * Faithful port of Java TemplateLexer.
 */
function parseTemplate(templateStr, timestampPatterns) {
  const chars = templateStr.split('');
  const len = chars.length;
  const patterns = timestampPatterns || DEFAULT_TIMESTAMP_PATTERNS;

  // Token storage (parallel arrays for type, start, end)
  const tokenTypes = [];
  const tokenStarts = [];
  const tokenEnds = [];
  let tokenSize = 0;

  // Var tracking
  const varIndexes = new Map();
  let varSize = 0;
  const varNameBuilder = [];

  // Timestamp tracking
  const timestamps = []; // { pattern, tokenIndex, tokenLength, timestamp }
  let timestampEnd = -1;

  let currCharIndex = 0;

  function addToken(type, start, end) {
    const idx = tokenSize;
    if (type === TT_VAR) {
      varIndexes.set(idx, end); // end is actually varIndex for Var tokens
    }
    tokenTypes.push(type);
    tokenStarts.push(start);
    tokenEnds.push(type === TT_VAR ? start + 1 : end); // Var tokens have length 1
    tokenSize++;
  }

  // A character is escaped when an odd number of escape characters runs up to it: the
  // template writes '/' as '//' and '$' as '/$', so '///$' is an escaped '/' followed by
  // an escaped '$' (the source text '/$'), not an escaped '/' and a value slot.
  function currCharEscaped() {
    let run = 0;
    for (let i = currCharIndex - 1; i >= 0 && chars[i] === VAR_ESCAPE; i--) run++;
    return run % 2 === 1;
  }

  function getTimestamp() {
    if (currCharIndex + TIMESTAMP_PREFIX.length >= len) return null;
    if (currCharEscaped()) return null;
    if (!regionMatches(chars, currCharIndex, TIMESTAMP_PREFIX)) return null;

    let tknSize = 0;
    let isCurrVar = true;

    const startFrom = currCharIndex + TIMESTAMP_PREFIX.length;
    for (let i = startFrom; i < len; i++) {
      if (regionMatches(chars, i, TIMESTAMP_POSTFIX)) {
        const start = currCharIndex + TIMESTAMP_PREFIX.length;
        const patternLen = i - start;
        const pattern = chars.slice(start, start + patternLen).join('');

        // Accept any pattern — the template explicitly marks timestamps with $(pattern)

        const tokenIndex = tokenSize;
        const timestampSize = isCurrVar ? tknSize + 1 : tknSize;

        return {
          pattern,
          tokenIndex,
          tokenLength: tokenIndex + timestampSize - tokenIndex || 1,
          _tknSize: timestampSize,
          _patternLen: patternLen,
        };
      }

      if (isTokenDelim(chars[i])) {
        if (isCurrVar && i !== startFrom) tknSize++;
        isCurrVar = false;
        tknSize++;
      } else {
        isCurrVar = true;
      }
    }
    return null;
  }

  function getVarState() {
    if (chars[currCharIndex] !== VAR_PLACEHOLDER) return 'NOT_FOUND';
    if (currCharEscaped()) return 'NOT_FOUND';
    if (currCharIndex === len - 1) return 'NON_INDEXED';

    varNameBuilder.length = 0;
    let result = 'NOT_FOUND';

    for (let i = currCharIndex + 1; i < len; i++) {
      const next = chars[i];
      if (isNumeral(next)) {
        varNameBuilder.push(next);
        result = 'NAMED';
      } else if (next === VAR_PLACEHOLDER) {
        if (varNameBuilder.length === 0) result = 'NON_INDEXED';
        break;
      } else if (isTokenDelim(next)) {
        if (varNameBuilder.length === 0) result = 'NON_INDEXED';
        break;
      } else {
        result = 'NOT_FOUND';
        break;
      }
    }
    return result;
  }

  function addVar(varState) {
    let varIndex;
    if (varState === 'NON_INDEXED') {
      varIndex = varSize;
      varSize++;
    } else if (varState === 'NAMED') {
      const varOffset = parseIntFromStr(varNameBuilder.join(''), -1);
      if (varOffset === -1) throw new Error('Unsupported variable: ' + varNameBuilder.join(''));
      if (varOffset !== 0) {
        varIndex = varSize - varOffset;
      } else {
        varIndex = varSize;
        varSize++;
      }
    }
    addToken(TT_VAR, currCharIndex, varIndex);
  }

  // Main tokenization loop
  let beginToken = 0;
  let endToken = 0;
  let isNumber = true;

  while (currCharIndex < len) {
    if (currCharIndex === timestampEnd) {
      timestampEnd = -1;
      currCharIndex++;
      continue;
    }

    let advance;
    const currChar = chars[currCharIndex];

    // Check timestamp
    const ts = getTimestamp();
    let charState;
    if (ts) {
      charState = 'TIMESTAMP';
      timestamps.push(ts);
      timestampEnd = currCharIndex + TIMESTAMP_PREFIX.length + ts._patternLen;
    } else {
      // Check var
      const vs = getVarState();
      if (vs !== 'NOT_FOUND') {
        charState = vs;
      } else if (isTokenDelim(currChar)) {
        charState = isNegativeNum(chars, currChar, currCharIndex, len) ? 'NUMBER' : 'DELIM';
      } else {
        charState = 'SYMBOL';
      }
    }

    if (charState === 'SYMBOL') {
      if (!isNumeral(currChar)) isNumber = false;
      endToken++;
      advance = 1;
    } else {
      if (endToken - beginToken > 0) {
        addToken(isNumber ? TT_MINUS_ONE : TT_SYMBOL, beginToken, endToken);
        isNumber = true;
      }

      if (charState === 'DELIM') {
        addToken(TT_DELIM, currCharIndex, currCharIndex + 1);
        advance = 1;
        beginToken = currCharIndex + 1;
        endToken = beginToken;
      } else if (charState === 'NUMBER') {
        addToken(TT_MINUS_ONE, currCharIndex, currCharIndex + MINUS_ONE_LEN);
        advance = MINUS_ONE_LEN;
        beginToken = currCharIndex + advance;
        endToken = beginToken;
      } else if (charState === 'TIMESTAMP') {
        advance = TIMESTAMP_PREFIX.length;
        beginToken = currCharIndex + advance;
        endToken = beginToken;
      } else if (charState === 'NON_INDEXED' || charState === 'NAMED') {
        addVar(charState);
        advance = varNameBuilder.length + 1;
        beginToken = currCharIndex + advance;
        endToken = beginToken;
      }
    }

    currCharIndex += advance;
  }

  if (beginToken < endToken) {
    addToken(isNumber ? TT_MINUS_ONE : TT_SYMBOL, beginToken, endToken);
  }

  // ─── Merge tokens into segments ──────────────────────────────────────────

  function tokenTypeToSegType(tt) {
    if (tt === TT_VAR) return SEG_VAR;
    return SEG_PATTERN; // Symbol, Delim, MinusOne → Pattern
  }

  function getTimestampForToken(index, startIdx) {
    for (let i = startIdx; i < timestamps.length; i++) {
      if (timestamps[i].tokenIndex === index) return timestamps[i];
    }
    return null;
  }

  const segments = [];
  let idx = 0;
  let tsIdx = 0;
  let currLen = 0;
  let currIdx = 0;
  let currType = null;

  function addPatternSegment(tokenIndex, count) {
    const start = tokenStarts[tokenIndex];
    const lastToken = tokenIndex + count - 1;
    const end = tokenEnds[lastToken];
    let text = chars.slice(start, end).join('');

    // Handle Log10x escape sequences: /$ → $ and // → /
    if (text.indexOf(VAR_ESCAPE) !== -1) {
      text = text.replace(/\/\$/g, '$').replace(/\/\//g, '/');
    }
    segments.push({ type: SEG_PATTERN, text });
  }

  function addVarSegment(tokenIndex) {
    const vi = varIndexes.get(tokenIndex);
    const actualIndex = vi + timestamps.length;
    segments.push({ type: SEG_VAR, index: actualIndex });
  }

  function addTimestampSegment() {
    let timestampIndex = 0;
    for (let i = segments.length - 1; i >= 0; i--) {
      if (segments[i].type === SEG_TIMESTAMP) {
        timestampIndex = segments[i].timestampIndex + 1;
        break;
      }
    }
    const ts = timestamps[timestampIndex];
    segments.push({ type: SEG_TIMESTAMP, timestampIndex, pattern: ts.pattern });
  }

  while (idx < tokenSize) {
    const ts = tsIdx < timestamps.length ? getTimestampForToken(idx, tsIdx) : null;

    if (ts) {
      if (currLen > 0) {
        if (currType === SEG_PATTERN) addPatternSegment(currIdx, currLen);
        else if (currType === SEG_VAR) addVarSegment(currIdx);
      }
      currIdx += currLen;
      addTimestampSegment();
      const tsTokenLen = ts._tknSize || 1;
      currLen = 0;
      tsIdx++;
      idx += tsTokenLen;
      currIdx += tsTokenLen;
    } else {
      const tt = tokenTypes[idx];
      const segType = tokenTypeToSegType(tt);

      if (segType === SEG_PATTERN) {
        if (segType !== currType) {
          if (currLen > 0) {
            if (currType === SEG_PATTERN) addPatternSegment(currIdx, currLen);
            else if (currType === SEG_VAR) addVarSegment(currIdx);
            currIdx += currLen;
            currLen = 0;
          } else {
            currLen++;
          }
          currType = segType;
        } else {
          currLen++;
        }
      } else if (segType === SEG_VAR) {
        if (segType !== currType) {
          if (currLen > 0) {
            if (currType === SEG_PATTERN) addPatternSegment(currIdx, currLen);
            currIdx += currLen;
          }
        }
        addVarSegment(idx);
        currLen = 0;
        currIdx = idx + 1;
        currType = segType;
      } else {
        currLen++;
        currType = segType;
      }
      idx++;
    }
  }

  if (currLen > 0) {
    if (currType === SEG_PATTERN) addPatternSegment(currIdx, currLen);
    else if (currType === SEG_VAR) addVarSegment(currIdx);
  }

  return { segments, timestampCount: timestamps.length, timestampPatterns: timestamps.map((t) => t.pattern) };
}

// ─── Event Lexer ─────────────────────────────────────────────────────────────

const SECONDS_FRACTION_RE = /^([0-9]{10})\.([0-9]{1,9})$/;
const MILLIS_FRACTION_RE = /^([0-9]{1,18})(?:\.([0-9]{1,9}))?$/;

/**
 * The event time of an epoch read with a fraction, from its value text:
 * - '+%s.%f': 10 digits of seconds, a dot, 1 to 9 fraction digits. Milliseconds (a
 *   number) for 1 to 3 fraction digits, nanoseconds (a string of digits) for 4 to 9:
 *   '1723042099.6' is 1723042099600 ms.
 * - '+%s.%N': milliseconds, then an optional dot and 1 to 9 digits of a millisecond.
 *   Nanoseconds (a string of digits, digits past the nanosecond dropped) with a
 *   fraction, milliseconds (a number) without one.
 * Never read through the magnitude rule of an integer epoch. A value of any other
 * shape gives -1 (no time); its text is still written back.
 * @param {string} text - The slot's value as encoded
 * @param {string} pattern - '+%s.%f' or '+%s.%N'
 * @returns {number|string}
 */
function epochFromText(text, pattern) {
  if (pattern === '+%s.%f') {
    const m = SECONDS_FRACTION_RE.exec(text);
    if (!m) return -1;
    const d = m[2].length;
    if (d <= 3) return Number(m[1]) * 1000 + Number(m[2]) * 10 ** (3 - d);
    return String(BigInt(m[1]) * 1000000000n + BigInt(m[2]) * 10n ** BigInt(9 - d));
  }
  const m = MILLIS_FRACTION_RE.exec(text);
  if (!m) return -1;
  if (m[2] === undefined) return m[1].length > 15 ? m[1] : Number(m[1]);
  const d = m[2].length;
  const nanos = d <= 6 ? BigInt(m[2]) * 10n ** BigInt(6 - d) : BigInt(m[2]) / 10n ** BigInt(d - 6);
  return String(BigInt(m[1]) * 1000000n + nanos);
}

/**
 * Tokenizes an encoded event's values.
 * @param {string} input - Encoded values (without hash), delimiter-separated
 * @param {string} delimiter - Value delimiter (space or comma)
 * @param {number} timestampCount - Number of timestamps in the template
 * @param {string[]} [timestampPatterns] - The template's timestamp patterns, by index. An
 *   epoch read with a fraction (+%s.%f, +%s.%N) gets its time from its text (epochFromText).
 * @returns {{ values: string[], timestampEpochs: (number|string)[] }}
 */
function tokenizeEvent(input, delimiter, timestampCount, timestampPatterns) {
  const chars = input.split('');
  const len = chars.length;
  const values = [];
  const timestampEpochs = [];
  const EMPTY = -1;

  let beginIndex = 0;
  let endIndex = 0;
  let pendingDelim = -1;
  let isNumber = true;

  function addTimestamp(start, end) {
    const pattern = timestampPatterns && timestampPatterns[timestampEpochs.length];
    if (pattern === '+%s.%f' || pattern === '+%s.%N') {
      timestampEpochs.push(epochFromText(chars.slice(start, end).join(''), pattern));
      return;
    }
    let epoch = parseLong(chars, start, end, EMPTY);
    if (epoch === EMPTY) {
      // Try fractional epoch: ms.nano
      for (let i = start; i < end; i++) {
        if (chars[i] === '.') {
          const epochMilli = parseLong(chars, start, i, EMPTY);
          const epochNano = parseLong(chars, i + 1, end, EMPTY);
          if (epochMilli !== EMPTY && epochNano !== EMPTY) {
            let times = 1;
            while (times <= epochNano) times *= 10;
            epoch = epochMilli * times + epochNano;
          }
          break;
        }
      }
    }
    timestampEpochs.push(epoch);
  }

  function addVarToken(start, end) {
    if (timestampEpochs.length < timestampCount) {
      addTimestamp(start, end);
    }
    values.push(chars.slice(start, end).join(''));
  }

  for (let i = 0; i < len; i++) {
    const c = chars[i];

    if (c === delimiter) {
      if (endIndex - beginIndex > 0) {
        if (pendingDelim !== -1) {
          if (isNumber && chars[pendingDelim] === '-') {
            if (endIndex - beginIndex > 1) addVarToken(beginIndex, endIndex);
          } else {
            if (endIndex > beginIndex + 1) addVarToken(beginIndex + 1, endIndex);
          }
        } else {
          addVarToken(beginIndex, endIndex);
        }
        isNumber = true;
      }
      beginIndex = endIndex;
      endIndex++;
      pendingDelim = i;
    } else {
      if (!isNumeral(c)) isNumber = false;
      endIndex++;
    }
  }

  const remaining = endIndex - beginIndex;
  if (remaining > 0) {
    if (pendingDelim !== -1) {
      if (remaining > 1) {
        if (isNumber && chars[pendingDelim] === '-') {
          addVarToken(beginIndex, endIndex);
        } else {
          addVarToken(beginIndex + 1, endIndex);
        }
      }
    } else {
      addVarToken(beginIndex, endIndex);
    }
  }

  return { values, timestampEpochs };
}

// Patterns whose value is the epoch text read from the source: the value is written
// back as it was encoded, with its fraction, dot and leading zeros, never through a number.
const EPOCH_TEXT_PATTERNS = new Set(['epoch', 'epochNano', '+%s', '+%s.%N', '+%s.%f']);

/**
 * Renders one timestamp segment of a tokenized event. A date pattern formats the epoch;
 * an epoch pattern writes the value text unchanged (timestamps are the first values).
 */
function renderTimestamp(event, seg, tzOffset) {
  if (EPOCH_TEXT_PATTERNS.has(seg.pattern)) {
    const text = event.values[seg.timestampIndex];
    return text === undefined ? '' : text;
  }
  const epoch = event.timestampEpochs[seg.timestampIndex];
  if (epoch === undefined || epoch === -1) return '';
  return formatTimestamp(epoch, seg.pattern, tzOffset);
}

const zoneOffsetFormatters = new Map();
const zoneOffsetHours = new Map();
const HOUR_MS = 3600000;

/**
 * The offset of a named zone at an instant, remembered per zone for the UTC hour that
 * holds it when the offset is the same at both ends of that hour (zones change offset
 * at most once in any hour), so time-ordered events rarely call Intl.
 */
function zoneOffsetAt(tz, ms) {
  const hourStart = Math.floor(ms / HOUR_MS) * HOUR_MS;
  const known = zoneOffsetHours.get(tz);
  if (known && known.hourStart === hourStart) return known.offset;
  const offset = getTimezoneOffsetMinutes(tz, new Date(ms));
  if (getTimezoneOffsetMinutes(tz, new Date(hourStart)) === offset &&
      getTimezoneOffsetMinutes(tz, new Date(hourStart + HOUR_MS - 1)) === offset) {
    zoneOffsetHours.set(tz, { hourStart, offset });
  }
  return offset;
}

/**
 * Converts a timezone name to its offset in minutes east of UTC at a given instant.
 * @param {string} tz - Timezone name (e.g., 'UTC', 'America/New_York')
 * @param {Date} [at=new Date()] - The instant; the offset differs across daylight saving
 * @returns {number} Minutes east of UTC
 */
function getTimezoneOffsetMinutes(tz, at) {
  let dt = zoneOffsetFormatters.get(tz);
  if (!dt) {
    dt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'shortOffset'
    });
    zoneOffsetFormatters.set(tz, dt);
  }
  const parts = dt.formatToParts(at || new Date());
  const tzPart = parts.find(p => p.type === 'timeZoneName');
  if (!tzPart) return 0;
  const val = tzPart.value; // e.g., "GMT", "GMT-4", "GMT+5:30"
  if (val === 'GMT' || val === 'UTC') return 0;
  const match = val.match(/GMT([+-])(\d+)(?::(\d+))?/);
  if (!match) return 0;
  const sign = match[1] === '+' ? 1 : -1;
  const hours = parseInt(match[2], 10);
  const mins = match[3] ? parseInt(match[3], 10) : 0;
  return sign * (hours * 60 + mins);
}

// ─── Single Event Decoder ────────────────────────────────────────────────────

/**
 * Decodes a single Log10x encoded event.
 *
 * @param {string} encodedValues - The encoded event values WITHOUT the hash
 * @param {string} templateStr - The template string with $ placeholders
 * @param {Object} [options] - Optional configuration
 * @param {string} [options.delimiter=' '] - Value delimiter in encoded events
 * @param {Set<string>} [options.timestampPatterns] - Known timestamp patterns
 * @param {string} [options.timezone] - Timezone name (e.g., 'UTC', 'America/New_York'), used when timezoneOffsetMinutes is not given. Daylight saving applies per timestamp.
 * @param {number} [options.timezoneOffsetMinutes] - Minutes east of UTC (e.g., -240 for UTC-4). Defaults to system timezone, with daylight saving per timestamp.
 * @returns {string} The decoded (original) event
 */
function decodeSingle(encodedValues, templateStr, options) {
  const delimiter = (options && options.delimiter) || ' ';
  const patterns = (options && options.timestampPatterns) || DEFAULT_TIMESTAMP_PATTERNS;
  let tzOffset = options && options.timezoneOffsetMinutes;
  if (tzOffset === undefined && options && options.timezone) {
    // Keep the name: formatTimestamp takes the zone's offset at each timestamp's instant.
    getTimezoneOffsetMinutes(options.timezone); // an unknown zone throws RangeError here
    tzOffset = options.timezone;
  }

  const template = parseTemplate(templateStr, patterns);
  const event = tokenizeEvent(encodedValues, delimiter, template.timestampCount, template.timestampPatterns);

  let result = '';
  for (const seg of template.segments) {
    if (seg.type === SEG_PATTERN) {
      result += seg.text;
    } else if (seg.type === SEG_VAR) {
      const val = event.values[seg.index];
      if (val !== undefined) result += val;
    } else if (seg.type === SEG_TIMESTAMP) {
      result += renderTimestamp(event, seg, tzOffset);
    }
  }

  return result;
}

// ─── Stream Decoder ──────────────────────────────────────────────────────────

/**
 * Creates a decoder that can decode multiple events sharing templates.
 *
 * @param {Object} templates - Map of hash → template string
 * @param {Object} [options] - Optional configuration
 * @param {string} [options.delimiter=','] - Value delimiter (default comma for console format)
 * @param {string} [options.prefix='~'] - Encoded line prefix (default ~ for console format)
 * @param {Set<string>} [options.timestampPatterns] - Known timestamp patterns
 * @param {string} [options.timezone] - Timezone name (e.g., 'UTC', 'America/New_York'), used when timezoneOffsetMinutes is not given. Daylight saving applies per timestamp.
 * @param {number} [options.timezoneOffsetMinutes] - Minutes east of UTC (e.g., -240 for UTC-4). Defaults to system timezone, with daylight saving per timestamp.
 * @returns {{ decode: function(string): string|null, decodeAll: function(string[]): string[] }}
 */
function createDecoder(templates, options) {
  const delimiter = (options && options.delimiter) || ',';
  const prefix = (options && options.prefix) || '~';
  const patterns = (options && options.timestampPatterns) || DEFAULT_TIMESTAMP_PATTERNS;
  let tzOffset = options && options.timezoneOffsetMinutes;
  if (tzOffset === undefined && options && options.timezone) {
    // Keep the name: formatTimestamp takes the zone's offset at each timestamp's instant.
    getTimezoneOffsetMinutes(options.timezone); // an unknown zone throws RangeError here
    tzOffset = options.timezone;
  }

  // Cache compiled templates
  const compiledTemplates = new Map();

  function getTemplate(hash) {
    if (compiledTemplates.has(hash)) return compiledTemplates.get(hash);

    const templateStr = templates[hash];
    if (!templateStr) return null;

    const compiled = parseTemplate(templateStr, patterns);
    compiledTemplates.set(hash, compiled);
    return compiled;
  }

  /**
   * Decodes a single encoded line.
   * @param {string} line - Full encoded line (e.g., "~hash,val1,val2,...")
   * @returns {string|null} Decoded original event, or null if template not found
   */
  function decode(line) {
    if (!line || !line.startsWith(prefix)) return line; // non-compact event

    const withoutPrefix = line.substring(prefix.length);
    const firstDelim = withoutPrefix.indexOf(delimiter);

    // An event whose template has no value slot is written as the hash alone
    // ("~<hash>", no delimiter). It decodes to the template's text when the hash
    // is a known template; any other line without a delimiter passes through.
    if (firstDelim === -1) {
      if (!getTemplate(withoutPrefix)) return line;
    }

    const hash = firstDelim === -1 ? withoutPrefix : withoutPrefix.substring(0, firstDelim);
    const values = firstDelim === -1 ? '' : withoutPrefix.substring(firstDelim + 1);

    const template = getTemplate(hash);
    if (!template) return null; // template not found

    const event = tokenizeEvent(values, delimiter, template.timestampCount, template.timestampPatterns);

    let result = '';
    for (const seg of template.segments) {
      if (seg.type === SEG_PATTERN) {
        result += seg.text;
      } else if (seg.type === SEG_VAR) {
        const val = event.values[seg.index];
        if (val !== undefined) result += val;
      } else if (seg.type === SEG_TIMESTAMP) {
        result += renderTimestamp(event, seg, tzOffset);
      }
    }

    return result;
  }

  /**
   * Decodes multiple encoded lines.
   * @param {string[]} lines - Array of encoded lines
   * @returns {string[]} Array of decoded lines (null for lines with missing templates)
   */
  function decodeAll(lines) {
    return lines.map(decode);
  }

  return { decode, decodeAll };
}

// ─── Exports ─────────────────────────────────────────────────────────────────

// Support both ESM and CJS
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { decodeSingle, createDecoder, parseTemplate, tokenizeEvent, formatTimestamp, DEFAULT_TIMESTAMP_PATTERNS };
}

// Also expose for browser / ESM
if (typeof globalThis !== 'undefined') {
  globalThis.Log10xDecoder = { decodeSingle, createDecoder, parseTemplate, tokenizeEvent, formatTimestamp, DEFAULT_TIMESTAMP_PATTERNS };
}

export { decodeSingle, createDecoder, parseTemplate, tokenizeEvent, formatTimestamp, DEFAULT_TIMESTAMP_PATTERNS };
