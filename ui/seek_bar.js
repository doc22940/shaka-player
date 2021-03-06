/** @license
 * Copyright 2016 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */


goog.provide('shaka.ui.SeekBar');

goog.require('shaka.ui.Constants');
goog.require('shaka.ui.Locales');
goog.require('shaka.ui.Localization');
goog.require('shaka.ui.RangeElement');
goog.require('shaka.ui.Utils');
goog.require('shaka.util.Timer');


/**
 * @extends {shaka.ui.RangeElement}
 * @final
 * @export
 */
shaka.ui.SeekBar = class extends shaka.ui.RangeElement {
  /**
   * @param {!HTMLElement} parent
   * @param {!shaka.ui.Controls} controls
   */
  constructor(parent, controls) {
    super(parent, controls,
        [
          'shaka-seek-bar-container',
        ],
        [
          'shaka-seek-bar',
          'shaka-no-propagation',
          'shaka-show-controls-on-mouse-over',
        ]);

    /** @private {!shaka.extern.UIConfiguration} */
    this.config_ = this.controls.getConfig();

    /**
     * This timer is used to introduce a delay between the user scrubbing across
     * the seek bar and the seek being sent to the player.
     *
     * @private {shaka.util.Timer}
     */
    this.seekTimer_ = new shaka.util.Timer(() => {
      this.video.currentTime = this.getValue();
    });

    this.eventManager.listen(this.localization,
        shaka.ui.Localization.LOCALE_UPDATED,
        () => this.updateAriaLabel_());

    this.eventManager.listen(this.localization,
        shaka.ui.Localization.LOCALE_CHANGED,
        () => this.updateAriaLabel_());

    this.eventManager.listen(
        this.adManager, shaka.ads.AdManager.AD_STARTED, () => {
          shaka.ui.Utils.setDisplay(this.container, false);
        });

    this.eventManager.listen(
        this.adManager, shaka.ads.AdManager.AD_STOPPED, () => {
          if (this.shouldBeDisplayed_()) {
            shaka.ui.Utils.setDisplay(this.container, true);
          }
        });

    // Initialize seek state and label.
    this.setValue(this.video.currentTime);
    this.update();
    this.updateAriaLabel_();
  }

  /** @override */
  release() {
    if (this.seekTimer_) {
      this.seekTimer_.stop();
      this.seekTimer_ = null;
    }

    super.release();
  }

  /**
   * Called by the base class when user interaction with the input element
   * begins.
   *
   * @override
   */
  onChangeStart() {
    this.controls.setSeeking(true);
    this.video.pause();
  }

  /**
   * Update the video element's state to match the input element's state.
   * Called by the base class when the input element changes.
   *
   * @override
   */
  onChange() {
    if (!this.video.duration) {
      // Can't seek yet.  Ignore.
      return;
    }

    // Update the UI right away.
    this.update();

    // We want to wait until the user has stopped moving the seek bar for a
    // little bit to reduce the number of times we ask the player to seek.
    //
    // To do this, we will start a timer that will fire in a little bit, but if
    // we see another seek bar change, we will cancel that timer and re-start
    // it.
    //
    // Calling |start| on an already pending timer will cancel the old request
    // and start the new one.
    this.seekTimer_.tickAfter(/* seconds= */ 0.125);
  }

  /**
   * Called by the base class when user interaction with the input element
   * ends.
   *
   * @override
   */
  onChangeEnd() {
    // They just let go of the seek bar, so cancel the timer and manually
    // call the event so that we can respond immediately.
    this.seekTimer_.tickNow();
    this.controls.setSeeking(false);
    this.video.play();
  }

  /** @return {boolean} */
  isShowing() {
    // It is showing by default, so it is hidden if shaka-hidden is in the list.
    return !this.container.classList.contains('shaka-hidden');
  }

  /**
   * Called by Controls on a timer to update the state of the seek bar.
   * Also called internally when the user interacts with the input element.
   */
  update() {
    const colors = this.config_.seekBarColors;
    const currentTime = this.getValue();
    const bufferedLength = this.video.buffered.length;
    const bufferedStart = bufferedLength ? this.video.buffered.start(0) : 0;
    const bufferedEnd =
        bufferedLength ? this.video.buffered.end(bufferedLength - 1) : 0;

    const seekRange = this.player.seekRange();
    const seekRangeSize = seekRange.end - seekRange.start;

    this.setRange(seekRange.start, seekRange.end);

    if (!this.shouldBeDisplayed_()) {
      shaka.ui.Utils.setDisplay(this.container, false);
    } else {
      shaka.ui.Utils.setDisplay(this.container, true);

      if (bufferedLength == 0) {
        this.container.style.background = colors.base;
      } else {
        const clampedBufferStart = Math.max(bufferedStart, seekRange.start);
        const clampedBufferEnd = Math.min(bufferedEnd, seekRange.end);
        const clampedCurrentTime = Math.min(
            Math.max(currentTime, seekRange.start),
            seekRange.end);

        const bufferStartDistance = clampedBufferStart - seekRange.start;
        const bufferEndDistance = clampedBufferEnd - seekRange.start;
        const playheadDistance = clampedCurrentTime - seekRange.start;

        // NOTE: the fallback to zero eliminates NaN.
        const bufferStartFraction = (bufferStartDistance / seekRangeSize) || 0;
        const bufferEndFraction = (bufferEndDistance / seekRangeSize) || 0;
        const playheadFraction = (playheadDistance / seekRangeSize) || 0;

        const unbufferedColor =
            this.config_.showUnbufferedStart ? colors.base : colors.played;

        const makeColor = (color, fract) => color + ' ' + (fract * 100) + '%';
        const gradient = [
          'to right',
          makeColor(unbufferedColor, bufferStartFraction),
          makeColor(colors.played, bufferStartFraction),
          makeColor(colors.played, playheadFraction),
          makeColor(colors.buffered, playheadFraction),
          makeColor(colors.buffered, bufferEndFraction),
          makeColor(colors.base, bufferEndFraction),
        ];
        this.container.style.background =
            'linear-gradient(' + gradient.join(',') + ')';
      }
    }
  }

  /**
   * @return {boolean}
   * @private
   */
  shouldBeDisplayed_() {
    // The seek bar should be hidden when the seek window's too small or
    // there's an ad playing.
    const seekRange = this.player.seekRange();
    const seekRangeSize = seekRange.end - seekRange.start;

    if (this.player.isLive() &&
        seekRangeSize < shaka.ui.Constants.MIN_SEEK_WINDOW_TO_SHOW_SEEKBAR) {
      return false;
    }

    return this.ad == null;
  }

  /** @private */
  updateAriaLabel_() {
    this.bar.setAttribute(shaka.ui.Constants.ARIA_LABEL,
        this.localization.resolve(shaka.ui.Locales.Ids.SEEK));
  }
};
