import { setBit } from 'foxts/bitwise';
import type { JsonValue } from './types';

const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const RE_HEX_ESCAPE = /^[\dA-F]{4}$/i;
const NUMBER_PATTERN = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:e[+-]?\d+)?/iy;

export function encodeBase64Url(bytes: Uint8Array): string {
  let encoded = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const remaining = bytes.length - index;
    const first = bytes[index];
    const second = remaining > 1 ? bytes[index + 1] : 0;
    const third = remaining > 2 ? bytes[index + 2] : 0;
    encoded += BASE64URL_ALPHABET[first >> 2];
    encoded += BASE64URL_ALPHABET[setBit((first & 3) << 4, second >> 4)];
    if (remaining > 1) encoded += BASE64URL_ALPHABET[setBit((second & 15) << 2, third >> 6)];
    if (remaining > 2) encoded += BASE64URL_ALPHABET[third & 63];
  }
  return encoded;
}

export function decodeBase64Url(encoded: string): Uint8Array {
  if (encoded.length % 4 === 1) throw new TypeError('Invalid Base64URL length');
  const decoded = new Uint8Array(Math.floor((encoded.length * 6) / 8));
  let accumulator = 0;
  let accumulatedBits = 0;
  let offset = 0;
  for (const character of encoded) {
    const value = BASE64URL_ALPHABET.indexOf(character);
    if (value === -1) throw new TypeError('Base64URL must be unpadded and URL-safe');
    accumulator = setBit(accumulator << 6, value);
    accumulatedBits += 6;
    if (accumulatedBits < 8) continue;
    accumulatedBits -= 8;
    decoded[offset] = (accumulator >> accumulatedBits) & 255;
    offset += 1;
    accumulator &= (1 << accumulatedBits) - 1;
  }
  if (accumulator !== 0 || offset !== decoded.length) {
    throw new TypeError('Base64URL has non-canonical trailing bits');
  }
  return decoded;
}

export function cloneJson<Value extends JsonValue>(value: Value): Value;
export function cloneJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map((entry) => cloneJson(entry));
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, cloneJson(entry)]));
  }
  return value;
}

function assertIJsonValue(value: unknown, label: string): asserts value is JsonValue {
  if (typeof value === 'string') {
    assertUnicodeScalarString(value, label);
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`${label} contains a non-finite number`);
    return;
  }
  if (value === null || typeof value === 'boolean') return;
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) assertIJsonValue(entry, `${label}[${index}]`);
    return;
  }
  if (typeof value !== 'object') throw new TypeError(`${label} is not an I-JSON value`);
  for (const [key, entry] of Object.entries(value)) {
    assertUnicodeScalarString(key, `${label} key`);
    assertIJsonValue(entry, `${label}.${key}`);
  }
}

function assertUnicodeScalarString(value: string, label: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.codePointAt(index);
    if (code !== undefined && code > 65535) {
      index += 1;
    } else if (code !== undefined && code >= 55296 && code <= 57343) {
      throw new TypeError(`${label} contains a lone surrogate`);
    }
  }
}

class DuplicateKeyScanner {
  readonly #text: string;
  #index = 0;

  constructor(text: string) {
    this.#text = text;
  }

  scan(): void {
    this.#skipWhitespace();
    this.#scanValue();
    this.#skipWhitespace();
    if (this.#index !== this.#text.length) throw new TypeError('Invalid JSON');
  }

  #scanValue(): void {
    const character = this.#text[this.#index];
    switch (character) {
      case '{': {
        this.#scanObject();
        break;
      }
      case '[': {
        this.#scanArray();
        break;
      }
      case '"': {
        this.#scanString();
        break;
      }
      case 't': {
        this.#scanLiteral('true');
        break;
      }
      case 'f': {
        this.#scanLiteral('false');
        break;
      }
      case 'n': {
        this.#scanLiteral('null');
        break;
      }
      default:
        this.#scanNumber();
    }
  }

  #scanObject(): void {
    this.#index += 1;
    this.#skipWhitespace();
    if (this.#consume('}')) return;
    const keys = new Set<string>();
    while (true) {
      if (this.#text[this.#index] !== '"') throw new TypeError('Invalid JSON object key');
      const key = this.#scanString();
      if (keys.has(key)) throw new TypeError(`I-JSON contains duplicate object member ${key}`);
      keys.add(key);
      this.#skipWhitespace();
      if (!this.#consume(':')) throw new TypeError('Invalid JSON object');
      this.#skipWhitespace();
      this.#scanValue();
      this.#skipWhitespace();
      if (this.#consume('}')) return;
      if (!this.#consume(',')) throw new TypeError('Invalid JSON object');
      this.#skipWhitespace();
    }
  }

  #scanArray(): void {
    this.#index += 1;
    this.#skipWhitespace();
    if (this.#consume(']')) return;
    while (true) {
      this.#scanValue();
      this.#skipWhitespace();
      if (this.#consume(']')) return;
      if (!this.#consume(',')) throw new TypeError('Invalid JSON array');
      this.#skipWhitespace();
    }
  }

  #scanString(): string {
    const start = this.#index;
    this.#index += 1;
    while (this.#index < this.#text.length) {
      const character = this.#text[this.#index];
      if (character === '"') {
        this.#index += 1;
        return JSON.parse(this.#text.slice(start, this.#index)) as string;
      }
      if (character === '\\') {
        this.#index += 1;
        const escape = this.#text[this.#index];
        if (escape === 'u') {
          const hex = this.#text.slice(this.#index + 1, this.#index + 5);
          if (!RE_HEX_ESCAPE.test(hex)) throw new TypeError('Invalid JSON string escape');
          this.#index += 5;
          continue;
        }
        if (!String.raw`"\/bfnrt`.includes(escape)) {
          throw new TypeError('Invalid JSON string escape');
        }
        this.#index += 1;
        continue;
      }
      if ((character.codePointAt(0) ?? 0) < 32) throw new TypeError('Invalid JSON string');
      this.#index += 1;
    }
    throw new TypeError('Unterminated JSON string');
  }

  #scanLiteral(literal: string): void {
    if (!this.#text.startsWith(literal, this.#index)) throw new TypeError('Invalid JSON literal');
    this.#index += literal.length;
  }

  #scanNumber(): void {
    NUMBER_PATTERN.lastIndex = this.#index;
    const match = NUMBER_PATTERN.exec(this.#text);
    if (!match) throw new TypeError('Invalid JSON number');
    this.#index = NUMBER_PATTERN.lastIndex;
  }

  #skipWhitespace(): void {
    while (' \n\r\t'.includes(this.#text[this.#index] ?? 'x')) this.#index += 1;
  }

  #consume(character: string): boolean {
    if (this.#text[this.#index] !== character) return false;
    this.#index += 1;
    return true;
  }
}

export function parseIJson(bytes: Uint8Array): JsonValue {
  if (bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191) {
    throw new TypeError('I-JSON must not contain a UTF-8 BOM');
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    throw new TypeError('I-JSON must contain valid UTF-8', { cause: error });
  }
  new DuplicateKeyScanner(text).scan();
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new TypeError('Invalid JSON', { cause: error });
  }
  assertIJsonValue(value, 'document');
  return value;
}
