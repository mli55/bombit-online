/* Shared optical baseline for native menus, score screens, and online labels. */
(() => {
  const updateTexture = Phaser.Text.prototype.updateTexture;
  Phaser.Text.prototype.updateTexture = function () {
    this.pivot.y -= this.bombitBaselineOffset || 0;
    const result = updateTexture.call(this);
    // Move the complete texture, so accents/strokes are never clipped. Reapply
    // once after layout, including when text bounds reset the native pivot.
    const offset = this.fontSize * 0.08;
    this.pivot.y += offset;
    this.bombitBaselineOffset = offset;
    return result;
  };

  const refreshText = Game.App.prototype.recursiveUpdateText;
  Game.App.prototype.recursiveUpdateText = function (node) {
    if (node === this.stage) Phaser.Text.fontPropertiesCache = {};
    return refreshText.call(this, node);
  };
})();
