import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeMessage, decodeMessages } from '../native-host/framing.js';

test('encode prefixes a little-endian uint32 length', () => {
  const buf = encodeMessage({ a: 1 });
  const json = JSON.stringify({ a: 1 });
  assert.equal(buf.length, 4 + json.length);
  assert.equal(buf.readUInt32LE(0), json.length);
  assert.equal(buf.subarray(4).toString('utf8'), json);
});

test('decode reads whole frames and returns the remainder', () => {
  const a = encodeMessage({ x: 1 });
  const b = encodeMessage({ y: 2 });
  const { messages, rest } = decodeMessages(Buffer.concat([a, b]));
  assert.deepEqual(messages, [{ x: 1 }, { y: 2 }]);
  assert.equal(rest.length, 0);
});

test('decode leaves a partial trailing frame in rest', () => {
  const a = encodeMessage({ x: 1 });
  const partial = a.subarray(0, a.length - 2);
  const { messages, rest } = decodeMessages(partial);
  assert.deepEqual(messages, []);
  assert.equal(rest.length, partial.length);
});
