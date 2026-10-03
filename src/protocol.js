function encodeLength(length) {
  if (length < 0x80) return Buffer.from([length]);
  if (length < 0x4000) {
    return Buffer.from([((length >> 8) & 0xff) | 0x80, length & 0xff]);
  }
  if (length < 0x200000) {
    return Buffer.from([
      ((length >> 16) & 0xff) | 0xc0,
      (length >> 8) & 0xff,
      length & 0xff,
    ]);
  }
  if (length < 0x10000000) {
    return Buffer.from([
      ((length >> 24) & 0xff) | 0xe0,
      (length >> 16) & 0xff,
      (length >> 8) & 0xff,
      length & 0xff,
    ]);
  }
  return Buffer.from([
    0xf0,
    Math.floor(length / 16777216) & 0xff,
    (length >> 16) & 0xff,
    (length >> 8) & 0xff,
    length & 0xff,
  ]);
}

export function encodeSentence(words) {
  const parts = [];
  for (const word of words) {
    const body = Buffer.from(String(word), 'utf8');
    parts.push(encodeLength(body.length), body);
  }
  parts.push(Buffer.from([0]));
  return Buffer.concat(parts);
}

function readLength(buf, offset) {
  if (offset >= buf.length) return null;
  const b0 = buf[offset];
  if ((b0 & 0x80) === 0) return { length: b0, offset: offset + 1 };
  if ((b0 & 0xc0) === 0x80) {
    if (buf.length < offset + 2) return null;
    return { length: ((b0 & 0x3f) << 8) + buf[offset + 1], offset: offset + 2 };
  }
  if ((b0 & 0xe0) === 0xc0) {
    if (buf.length < offset + 3) return null;
    return {
      length: ((b0 & 0x1f) << 16) + (buf[offset + 1] << 8) + buf[offset + 2],
      offset: offset + 3,
    };
  }
  if ((b0 & 0xf0) === 0xe0) {
    if (buf.length < offset + 4) return null;
    return {
      length: ((b0 & 0x0f) * 16777216) + (buf[offset + 1] << 16) + (buf[offset + 2] << 8) + buf[offset + 3],
      offset: offset + 4,
    };
  }
  if (b0 === 0xf0) {
    if (buf.length < offset + 5) return null;
    const length = (buf[offset + 1] * 16777216)
      + (buf[offset + 2] << 16)
      + (buf[offset + 3] << 8)
      + buf[offset + 4];
    return { length, offset: offset + 5 };
  }
  throw new Error('Réponse du routeur illisible.');
}

export function takeSentence(state) {
  let offset = 0;
  const words = [];
  while (offset < state.buf.length) {
    const head = readLength(state.buf, offset);
    if (!head) return null;
    if (head.length === 0) {
      state.buf = Buffer.from(state.buf.subarray(head.offset));
      return words;
    }
    if (state.buf.length < head.offset + head.length) return null;
    words.push(state.buf.subarray(head.offset, head.offset + head.length).toString('utf8'));
    offset = head.offset + head.length;
  }
  return null;
}

export function wordsToRecord(words) {
  const record = {};
  for (const word of words) {
    if (!word.startsWith('=')) continue;
    const eq = word.indexOf('=', 1);
    if (eq === -1) continue;
    record[word.slice(1, eq)] = word.slice(eq + 1);
  }
  return record;
}
