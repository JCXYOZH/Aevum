'use strict';

/**
 * Action field contract for pose writers.
 *
 * Each field has one owner. A run records conflicts instead of silently
 * overwriting another writer, and clamps values that exceed the declared
 * range so downstream renderers always receive a safe pose.
 */
const FIELDS = {
  R3_LEG_SPLAY: { owner: 'R3', min: -16, max: 16 },
  R3_LEG_OUTWARD_LEFT: { owner: 'R3', min: -16, max: 16 },
  R3_LEG_OUTWARD_RIGHT: { owner: 'R3', min: -16, max: 16 },
  R2_POSE_ROTATION: { owner: 'R2', min: -180, max: 180 }
};

const ERROR = {
  WRITER_CONFLICT: 0x020102,
  OUT_OF_RANGE: 0x030103,
  UNKNOWN_FIELD: 0x070001
};

function createRun() {
  const claims = new Map();
  const errors = [];

  function claim(field, writer, value) {
    const spec = FIELDS[field];
    if (!spec) {
      errors.push({
        code: ERROR.UNKNOWN_FIELD,
        field,
        owner: writer,
        at: 'action-contract:createRun'
      });
      return undefined;
    }

    const previous = claims.get(field);
    if (writer !== spec.owner || (previous && previous.writer !== writer)) {
      errors.push({
        code: ERROR.WRITER_CONFLICT,
        field,
        owner: '骨骼映射',
        at: 'action-contract:createRun'
      });
      return previous ? previous.value : undefined;
    }

    let next = value;
    if (typeof next === 'number' && spec.min !== undefined && next < spec.min) {
      next = spec.min;
      errors.push({ code: ERROR.OUT_OF_RANGE, field, owner: writer, at: 'action-contract:createRun' });
    }
    if (typeof next === 'number' && spec.max !== undefined && next > spec.max) {
      next = spec.max;
      errors.push({ code: ERROR.OUT_OF_RANGE, field, owner: writer, at: 'action-contract:createRun' });
    }

    claims.set(field, { writer, value: next });
    return next;
  }

  return { claim, errors };
}

module.exports = { FIELDS, ERROR, createRun };
