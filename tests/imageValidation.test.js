import test from 'node:test';
import assert from 'node:assert/strict';
import { validateImageAttachments, MAX_IMAGE_ATTACHMENTS, MAX_IMAGE_BYTES, MAX_TOTAL_IMAGE_BYTES } from '../src/imageValidation.js';

const image = (data = 'AAAA', mimeType = 'image/jpeg') => ({ data, mimeType, name: 'ignored-by-worker.jpg' });

test('empty photo list is valid for text-only analysis', () => {
  const result = validateImageAttachments([]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.images, []);
});

test('allows at most five supported image attachments', () => {
  const five = validateImageAttachments(Array.from({ length: MAX_IMAGE_ATTACHMENTS }, () => image()));
  assert.equal(five.ok, true);
  const six = validateImageAttachments(Array.from({ length: 6 }, () => image()));
  assert.equal(six.ok, false);
  assert.equal(six.status, 400);
});

test('rejects unsupported MIME types and malformed base64', () => {
  assert.equal(validateImageAttachments([image('AAAA', 'image/gif')]).ok, false);
  assert.equal(validateImageAttachments([image('not base64!')]).ok, false);
});

test('enforces per-image and aggregate decoded byte limits', () => {
  const tooLarge = validateImageAttachments([image('A'.repeat(2_000_004))]);
  assert.equal(tooLarge.ok, false);
  assert.equal(tooLarge.status, 400);
  const aggregate = validateImageAttachments(Array.from({ length: 4 }, () => image('A'.repeat(2_000_000))));
  assert.equal(aggregate.ok, false);
  assert.equal(aggregate.status, 413);
  assert.equal(MAX_IMAGE_BYTES, 1_500_000);
  assert.equal(MAX_TOTAL_IMAGE_BYTES, 5 * 1024 * 1024);
});

test('strips untrusted attachment metadata before forwarding to the model', () => {
  const result = validateImageAttachments([image()]);
  assert.deepEqual(Object.keys(result.images[0]).sort(), ['data', 'mimeType']);
});
