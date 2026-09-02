// Canonical messages; the importers' error strings are matched against `en.importError`
// and localized from there (see i18n/importMessages.ts).
export const WRONG_PASSWORD = 'Wrong password.';
export const UNSUPPORTED_ENCRYPTION = 'This document uses an encryption method that is not supported.';

// `name` marks a failure of the crypto layer itself, so a save error is not mistaken
// for a lost file handle.
export function encryptionError(message: string): Error {
  const err = new Error(message);
  err.name = 'EncryptionError';
  return err;
}
