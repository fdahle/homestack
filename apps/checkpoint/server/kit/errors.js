// Copied from kit/server/errors.js by kit/sync.mjs. Change it there, not here.
// A 400 with a code the frontend can show: throw new BadRequest('name_required').
// The kit's errorHandler (http.js) answers it as { error: code }.
export class BadRequest extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}
