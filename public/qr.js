const QR_BLOCKS = {
  1: [[16, 10]],
  2: [[28, 16]],
  3: [[44, 26]],
  4: [[32, 18], [32, 18]],
  5: [[43, 24], [43, 24]],
  6: [[27, 16], [27, 16], [27, 16], [27, 16]],
};

const QR_ALIGN = {
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
};

function qrMultiply(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i -= 1) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function qrDivisor(degree) {
  const result = new Array(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i += 1) {
    for (let j = 0; j < result.length; j += 1) {
      result[j] = qrMultiply(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = qrMultiply(root, 0x02);
  }
  return result;
}

function qrRemainder(data, divisor) {
  const result = new Array(divisor.length).fill(0);
  data.forEach((value) => {
    const factor = (value ^ result[0]) & 0xff;
    result.copyWithin(0, 1);
    result[result.length - 1] = 0;
    for (let i = 0; i < result.length; i += 1) result[i] ^= qrMultiply(divisor[i], factor);
  });
  return result;
}

function qrDataCodewords(version) {
  return QR_BLOCKS[version].reduce((sum, block) => sum + block[0], 0);
}

function qrChooseVersion(length) {
  for (let version = 1; version <= 6; version += 1) {
    if (length <= qrDataCodewords(version) - 2) return version;
  }
  return 0;
}

function qrPushBits(bits, value, count) {
  for (let i = count - 1; i >= 0; i -= 1) bits.push((value >>> i) & 1);
}

function qrBytes(text, version) {
  const capacity = qrDataCodewords(version);
  const bits = [];
  const bytes = new TextEncoder().encode(text);
  qrPushBits(bits, 0b0100, 4);
  qrPushBits(bits, bytes.length, 8);
  bytes.forEach((value) => qrPushBits(bits, value, 8));
  const terminator = Math.min(4, capacity * 8 - bits.length);
  qrPushBits(bits, 0, terminator);
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) {
    let value = 0;
    for (let j = 0; j < 8; j += 1) value = (value << 1) | bits[i + j];
    data.push(value);
  }
  for (let pad = 0; data.length < capacity; pad += 1) data.push(pad % 2 ? 0x11 : 0xec);
  return data;
}

function qrCodewords(data, version) {
  const blocks = QR_BLOCKS[version];
  const groups = [];
  let offset = 0;
  blocks.forEach(([dataLen, eccLen]) => {
    const chunk = data.slice(offset, offset + dataLen);
    offset += dataLen;
    groups.push({ data: chunk, ecc: qrRemainder(chunk, qrDivisor(eccLen)) });
  });
  const out = [];
  const dataLen = Math.max(...groups.map((group) => group.data.length));
  const eccLen = groups[0].ecc.length;
  for (let i = 0; i < dataLen; i += 1) {
    groups.forEach((group) => { if (i < group.data.length) out.push(group.data[i]); });
  }
  for (let i = 0; i < eccLen; i += 1) groups.forEach((group) => out.push(group.ecc[i]));
  const bits = [];
  out.forEach((value) => qrPushBits(bits, value, 8));
  const remainder = [0, 7, 7, 7, 7, 7, 7][version];
  for (let i = 0; i < remainder; i += 1) bits.push(0);
  return bits;
}

function qrFormatBits(mask) {
  let bits = mask << 10;
  for (let i = 14; i >= 10; i -= 1) {
    if ((bits >>> i) & 1) bits ^= 0b10100110111 << (i - 10);
  }
  return ((mask << 10) | (bits & 0x3ff)) ^ 0b101010000010010;
}

function qrMask(mask, row, col) {
  if (mask === 0) return ((row + col) % 2) === 0;
  if (mask === 1) return (row % 2) === 0;
  if (mask === 2) return (col % 3) === 0;
  if (mask === 3) return ((row + col) % 3) === 0;
  if (mask === 4) return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0;
  if (mask === 5) return ((row * col) % 2) + ((row * col) % 3) === 0;
  if (mask === 6) return (((row * col) % 2) + ((row * col) % 3)) % 2 === 0;
  return (((row + col) % 2) + ((row * col) % 3)) % 2 === 0;
}

function qrBlank(size) {
  return Array.from({ length: size }, () => Array(size).fill(false));
}

function qrFinder(matrix, reserved, row, col) {
  for (let dr = -1; dr <= 7; dr += 1) {
    for (let dc = -1; dc <= 7; dc += 1) {
      const y = row + dr;
      const x = col + dc;
      if (y < 0 || x < 0 || y >= matrix.length || x >= matrix.length) continue;
      const inside = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
      const edge = dr === 0 || dr === 6 || dc === 0 || dc === 6;
      const core = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
      matrix[y][x] = inside && (edge || core);
      reserved[y][x] = true;
    }
  }
}

function qrAlign(matrix, reserved, row, col) {
  for (let dr = -2; dr <= 2; dr += 1) {
    for (let dc = -2; dc <= 2; dc += 1) {
      matrix[row + dr][col + dc] = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
      reserved[row + dr][col + dc] = true;
    }
  }
}

function qrFunctions(version) {
  const size = 17 + version * 4;
  const matrix = qrBlank(size);
  const reserved = qrBlank(size);
  qrFinder(matrix, reserved, 0, 0);
  qrFinder(matrix, reserved, 0, size - 7);
  qrFinder(matrix, reserved, size - 7, 0);
  for (let i = 0; i < size; i += 1) {
    if (!reserved[6][i]) {
      matrix[6][i] = i % 2 === 0;
      reserved[6][i] = true;
    }
    if (!reserved[i][6]) {
      matrix[i][6] = i % 2 === 0;
      reserved[i][6] = true;
    }
  }
  (QR_ALIGN[version] || []).forEach((row) => {
    (QR_ALIGN[version] || []).forEach((col) => {
      if (!reserved[row][col]) qrAlign(matrix, reserved, row, col);
    });
  });
  matrix[size - 8][8] = true;
  reserved[size - 8][8] = true;
  for (let i = 0; i < 9; i += 1) {
    reserved[8][i] = true;
    reserved[i][8] = true;
  }
  for (let i = 0; i < 8; i += 1) {
    reserved[8][size - 1 - i] = true;
    reserved[size - 1 - i][8] = true;
  }
  return { matrix, reserved, size };
}

function qrPlaceData(matrix, reserved, bits, mask) {
  const size = matrix.length;
  let index = 0;
  let upward = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col = 5;
    for (let step = 0; step < size; step += 1) {
      const row = upward ? size - 1 - step : step;
      for (let offset = 0; offset < 2; offset += 1) {
        const x = col - offset;
        if (reserved[row][x]) continue;
        let bit = index < bits.length ? bits[index] : 0;
        index += 1;
        if (qrMask(mask, row, x)) bit ^= 1;
        matrix[row][x] = bit === 1;
      }
    }
    upward = !upward;
  }
}

function qrPlaceFormat(matrix, mask) {
  const size = matrix.length;
  const bits = qrFormatBits(mask);
  const bit = (index) => ((bits >>> index) & 1) === 1;
  for (let i = 0; i <= 5; i += 1) matrix[i][8] = bit(i);
  matrix[7][8] = bit(6);
  matrix[8][8] = bit(7);
  matrix[8][7] = bit(8);
  for (let i = 9; i < 15; i += 1) matrix[8][14 - i] = bit(i);
  for (let i = 0; i < 8; i += 1) matrix[8][size - 1 - i] = bit(i);
  for (let i = 8; i < 15; i += 1) matrix[size - 15 + i][8] = bit(i);
}

function qrPenalty(matrix) {
  const size = matrix.length;
  let score = 0;
  for (let row = 0; row < size; row += 1) {
    let run = 1;
    for (let col = 1; col < size; col += 1) {
      if (matrix[row][col] === matrix[row][col - 1]) run += 1;
      else {
        if (run >= 5) score += run - 2;
        run = 1;
      }
    }
    if (run >= 5) score += run - 2;
  }
  for (let col = 0; col < size; col += 1) {
    let run = 1;
    for (let row = 1; row < size; row += 1) {
      if (matrix[row][col] === matrix[row - 1][col]) run += 1;
      else {
        if (run >= 5) score += run - 2;
        run = 1;
      }
    }
    if (run >= 5) score += run - 2;
  }
  let dark = 0;
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      if (matrix[row][col]) dark += 1;
      if (row < size - 1 && col < size - 1) {
        const color = matrix[row][col];
        if (color === matrix[row][col + 1] && color === matrix[row + 1][col] && color === matrix[row + 1][col + 1]) score += 3;
      }
    }
  }
  const percent = Math.abs(Math.floor((dark * 100) / (size * size)) - 50);
  score += Math.floor(percent / 5) * 10;
  return score;
}

function qrMatrix(text) {
  const version = qrChooseVersion(String(text || '').length);
  if (!version) return [];
  const bits = qrCodewords(qrBytes(text, version), version);
  let best = null;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask += 1) {
    const { matrix, reserved } = qrFunctions(version);
    qrPlaceData(matrix, reserved, bits, mask);
    qrPlaceFormat(matrix, mask);
    const score = qrPenalty(matrix);
    if (score < bestScore) {
      best = matrix;
      bestScore = score;
    }
  }
  return best;
}

function qrSvg(text) {
  const matrix = qrMatrix(text);
  if (!matrix.length) return '';
  const quiet = 4;
  const size = matrix.length + quiet * 2;
  let marks = '';
  matrix.forEach((row, y) => {
    row.forEach((on, x) => {
      if (on) marks += `<rect x="${x + quiet}" y="${y + quiet}" width="1" height="1"/>`;
    });
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img" aria-label="QR code"><rect width="${size}" height="${size}" fill="#ffffff"/><g fill="#102033">${marks}</g></svg>`;
}

function qrPngDataUrl(text, scale = 8) {
  const matrix = qrMatrix(text);
  if (!matrix.length) return '';
  const quiet = 4;
  const modules = matrix.length + quiet * 2;
  const canvas = document.createElement('canvas');
  canvas.width = modules * scale;
  canvas.height = modules * scale;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#102033';
  for (let y = 0; y < matrix.length; y += 1) {
    for (let x = 0; x < matrix[y].length; x += 1) {
      if (!matrix[y][x]) continue;
      ctx.fillRect((x + quiet) * scale, (y + quiet) * scale, scale, scale);
    }
  }
  return canvas.toDataURL('image/png');
}

if (typeof module !== 'undefined' && module.exports) module.exports = { qrMatrix, qrSvg, qrPngDataUrl };
