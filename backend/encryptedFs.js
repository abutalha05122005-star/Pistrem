/**
 * 🔒 PiStream Transparent AES-256 Storage Encryption Layer
 * Implements a monkey-patched fs overlay that transparently encrypts all writes
 * to /tmp/streamcache and decrypts all reads from /tmp/streamcache at the byte level.
 * Allows sequential download, random-access seek-and-read, and secure storage at rest.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const TEMP_DIR = process.env.TEMP_DIR || '/tmp/streamcache';
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'SuperSecureStreamingEncryptionKey123';

const KEY = crypto.createHash('sha256').update(ENCRYPTION_KEY).digest();
const fdMap = {}; // Maps fd -> { filePath, baseIv }

// Math helper to seek/CTR encrypt/decrypt buffers
function encryptDecryptBuffer(buffer, key, baseIv, position) {
  if (!buffer || buffer.length === 0) return buffer;
  
  const blockIndex = Math.floor(position / 16);
  const byteOffsetInBlock = position % 16;
  
  // Increment IV
  const iv = Buffer.from(baseIv);
  let carry = blockIndex;
  for (let i = 15; i >= 0 && carry > 0; i--) {
    const sum = iv[i] + carry;
    iv[i] = sum & 0xff;
    carry = Math.floor(sum / 256);
  }
  
  const padLength = byteOffsetInBlock;
  const paddedInput = Buffer.alloc(padLength + buffer.length);
  buffer.copy(paddedInput, padLength);
  
  const cipher = crypto.createCipheriv('aes-256-ctr', key, iv);
  const paddedOutput = Buffer.concat([cipher.update(paddedInput), cipher.final()]);
  
  return paddedOutput.slice(padLength);
}

// Derive a unique and deterministic IV from file name so it is decryptable after server restarts
function getBaseIv(filePath) {
  return crypto.createHash('md5').update(path.basename(filePath)).digest();
}

function shouldEncrypt(filePath) {
  if (!filePath) return false;
  const resolved = path.resolve(filePath);
  const resolvedCache = path.resolve(TEMP_DIR);
  return resolved.startsWith(resolvedCache);
}

// --- Monkey patching open / openSync ---
const originalOpen = fs.open;
fs.open = function(pathStr, flags, mode, callback) {
  if (typeof mode === 'function') {
    callback = mode;
    mode = undefined;
  }
  
  originalOpen(pathStr, flags, mode, (err, fd) => {
    if (!err && shouldEncrypt(pathStr)) {
      fdMap[fd] = {
        filePath: pathStr,
        baseIv: getBaseIv(pathStr),
        cursor: 0
      };
    }
    if (callback) callback(err, fd);
  });
};

const originalOpenSync = fs.openSync;
fs.openSync = function(pathStr, flags, mode) {
  const fd = originalOpenSync(pathStr, flags, mode);
  if (shouldEncrypt(pathStr)) {
    fdMap[fd] = {
      filePath: pathStr,
      baseIv: getBaseIv(pathStr),
      cursor: 0
    };
  }
  return fd;
};

// --- Monkey patching close / closeSync ---
const originalClose = fs.close;
fs.close = function(fd, callback) {
  delete fdMap[fd];
  originalClose(fd, callback);
};

const originalCloseSync = fs.closeSync;
fs.closeSync = function(fd) {
  delete fdMap[fd];
  originalCloseSync(fd);
};

// --- Monkey patching write / writeSync ---
const originalWrite = fs.write;
fs.write = function(fd, buffer, offset, length, position, callback) {
  // Overloaded signatures
  if (typeof buffer === 'string') {
    return originalWrite.apply(fs, arguments);
  }
  if (typeof position === 'function') {
    callback = position;
    position = null;
  }
  if (typeof length === 'function') {
    callback = length;
    length = buffer.length;
    position = null;
  }

  const tracking = fdMap[fd];
  if (tracking) {
    const writePos = (position !== null && position !== undefined && position !== -1) 
      ? position 
      : tracking.cursor;
      
    const plainBuffer = buffer.slice(offset, offset + length);
    const encryptedBuf = encryptDecryptBuffer(plainBuffer, KEY, tracking.baseIv, writePos);
    
    // Copy encrypted back into a temp buffer to send to original write
    const writeBuf = Buffer.from(buffer);
    encryptedBuf.copy(writeBuf, offset);
    
    return originalWrite(fd, writeBuf, offset, length, position, (err, bytesWritten, writtenBuf) => {
      if (!err) {
        tracking.cursor = writePos + bytesWritten;
      }
      if (callback) callback(err, bytesWritten, buffer); // return original plain buffer to callback
    });
  }
  
  return originalWrite(fd, buffer, offset, length, position, callback);
};

const originalWriteSync = fs.writeSync;
fs.writeSync = function(fd, buffer, offset, length, position) {
  if (typeof buffer === 'string') {
    return originalWriteSync.apply(fs, arguments);
  }
  const tracking = fdMap[fd];
  if (tracking) {
    const writePos = (position !== null && position !== undefined && position !== -1)
      ? position
      : tracking.cursor;
    
    const plainBuffer = buffer.slice(offset, offset + length);
    const encryptedBuf = encryptDecryptBuffer(plainBuffer, KEY, tracking.baseIv, writePos);
    
    const writeBuf = Buffer.from(buffer);
    encryptedBuf.copy(writeBuf, offset);
    
    const bytesWritten = originalWriteSync(fd, writeBuf, offset, length, position);
    tracking.cursor = writePos + bytesWritten;
    return bytesWritten;
  }
  return originalWriteSync(fd, buffer, offset, length, position);
};

// --- Monkey patching read / readSync ---
const originalRead = fs.read;
fs.read = function(fd, buffer, offset, length, position, callback) {
  const tracking = fdMap[fd];
  if (tracking) {
    const readPos = (position !== null && position !== undefined && position !== -1)
      ? position
      : tracking.cursor;
      
    return originalRead(fd, buffer, offset, length, position, (err, bytesRead, buf) => {
      if (!err && bytesRead > 0) {
        const encryptedSeg = buf.slice(offset, offset + bytesRead);
        const decryptedSeg = encryptDecryptBuffer(encryptedSeg, KEY, tracking.baseIv, readPos);
        decryptedSeg.copy(buf, offset);
        tracking.cursor = readPos + bytesRead;
      }
      if (callback) callback(err, bytesRead, buf);
    });
  }
  return originalRead(fd, buffer, offset, length, position, callback);
};

const originalReadSync = fs.readSync;
fs.readSync = function(fd, buffer, offset, length, position) {
  const tracking = fdMap[fd];
  if (tracking) {
    const readPos = (position !== null && position !== undefined && position !== -1)
      ? position
      : tracking.cursor;
      
    const bytesRead = originalReadSync(fd, buffer, offset, length, position);
    if (bytesRead > 0) {
      const encryptedSeg = buffer.slice(offset, offset + bytesRead);
      const decryptedSeg = encryptDecryptBuffer(encryptedSeg, KEY, tracking.baseIv, readPos);
      decryptedSeg.copy(buffer, offset);
      tracking.cursor = readPos + bytesRead;
    }
    return bytesRead;
  }
  return originalReadSync(fd, buffer, offset, length, position);
};

console.log('🔒 [Encryption Layer] Transparent AES-256-CTR storage system active for path:', TEMP_DIR);
