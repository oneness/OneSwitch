// Pure. Native-messaging frame = uint32 LE length prefix + UTF-8 JSON.
// Uses Buffer (Node) or the GJS shim in oneswitch-browser.js.

export function encodeMessage(obj) {
  const json = JSON.stringify(obj);
  const body = Buffer.from(json, 'utf8');
  const head = Buffer.alloc(4);
  head.writeUInt32LE(body.length, 0);
  return Buffer.concat([head, body]);
}

export function decodeMessages(buffer) {
  const messages = [];
  let offset = 0;
  while (buffer.length - offset >= 4) {
    const len = buffer.readUInt32LE(offset);
    if (buffer.length - offset - 4 < len) break;
    const body = buffer.subarray(offset + 4, offset + 4 + len);
    messages.push(JSON.parse(body.toString('utf8')));
    offset += 4 + len;
  }
  return { messages, rest: buffer.subarray(offset) };
}
