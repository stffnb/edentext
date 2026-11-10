import * as Y from 'yjs';

// Yjs 13.6.33's undo traces a restored item's left and right neighbours separately through
// `redone` copies; both can reach one copy, so its origins contradict each other and every
// other replica (and a reload) places it elsewhere (yjs#823). Insert it after `left` instead.
const PATCHED = Symbol.for('edentext.yjsRedo');
const proto = Y.Item.prototype as Y.Item & { [PATCHED]?: true };
if (!proto[PATCHED]) {
  const integrate = proto.integrate;
  proto.integrate = function (this: Y.Item, tr: Y.Transaction, offset: number) {
    const { left, right } = this;
    if (offset === 0 && left && right && left.right !== right && tr.origin instanceof Y.UndoManager) {
      let r = left.right;
      while (r && r !== right) r = r.right;
      if (!r) {
        this.right = left.right;
        this.rightOrigin = left.right ? left.right.id : null;
      }
    }
    return integrate.call(this, tr, offset);
  };
  proto[PATCHED] = true;
}
