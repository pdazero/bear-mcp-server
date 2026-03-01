import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildBearUrl } from '../src/bear-api/xcallback.js';

describe('buildBearUrl', () => {
  it('builds correct URL format', () => {
    const url = buildBearUrl('create', { title: 'Hello' });
    assert.ok(url.startsWith('bear://x-callback-url/create?'));
    assert.ok(url.includes('title=Hello'));
  });

  it('converts boolean true to yes', () => {
    const url = buildBearUrl('create', { pin: true });
    assert.ok(url.includes('pin=yes'));
  });

  it('converts boolean false to no', () => {
    const url = buildBearUrl('create', { pin: false });
    assert.ok(url.includes('pin=no'));
  });

  it('excludes undefined params', () => {
    const url = buildBearUrl('create', { title: 'Test', text: undefined });
    assert.ok(url.includes('title=Test'));
    assert.ok(!url.includes('text='));
  });

  it('excludes null params', () => {
    const url = buildBearUrl('create', { title: 'Test', text: null });
    assert.ok(url.includes('title=Test'));
    assert.ok(!url.includes('text='));
  });

  it('URL-encodes special characters', () => {
    const url = buildBearUrl('create', { title: 'Hello World & More' });
    assert.ok(url.includes('title=Hello+World+%26+More') || url.includes('title=Hello%20World%20%26%20More'));
  });

  it('adds show_window=no by default', () => {
    const url = buildBearUrl('create', { title: 'Test' });
    assert.ok(url.includes('show_window=no'));
  });

  it('does not override explicit show_window', () => {
    const url = buildBearUrl('trash', { id: '123', show_window: true });
    assert.ok(url.includes('show_window=yes'));
    // Should not contain show_window=no
    assert.ok(!url.includes('show_window=no'));
  });

  it('handles empty params', () => {
    const url = buildBearUrl('create');
    assert.equal(url, 'bear://x-callback-url/create?show_window=no');
  });

  it('handles action with no query params except default', () => {
    const url = buildBearUrl('trash', {});
    assert.ok(url.includes('show_window=no'));
  });
});
