/**
 * PhotoSwipe lightbox
 *
 * - If user has unsupported browser it falls back to default browser action (just opens URL)
 * - Binds click event to links that should open PhotoSwipe
 * - parses DOM strcture for PhotoSwipe (retrieves large image URLs and sizes)
 * - Initializes PhotoSwipe
 *
 *
 * Loader options use the same object as PhotoSwipe, and supports such options:
 *
 * gallerySelector
 * childSelector - child selector relative to the parent (should be inside)
 *
 */

import {
  specialKeyUsed,
} from '../util/util.js';

import { lazyLoadSlide } from '../slide/lazy-load.js';
import { dynamicImportModule, dynamicImportPlugin } from './dynamic-import.js';
import { loadCSS } from './load-css.js';
import PhotoSwipeBase from '../core/base.js';

class PhotoSwipeLightbox extends PhotoSwipeBase {
  constructor(options) {
    super();
    this.options = options;
    this._additionalDynamicCSS = [];
    this._pluginClasses = {};
    this._uid = 0;
  }

  init() {
    this.onThumbnailsClick = this.onThumbnailsClick.bind(this);

    if (this.options && this.options.gallerySelector) {
      // Bind click events to each gallery
      const galleryElements = document.querySelectorAll(this.options.gallerySelector);
      galleryElements.forEach((galleryElement) => {
        galleryElement.addEventListener('click', this.onThumbnailsClick, false);
      });
    }
  }

  onThumbnailsClick(e) {
    // Exit and allow default browser action if:
    if (specialKeyUsed(e) // ... if clicked with a special key (ctrl/cmd...)
        || window.pswp // ... if PhotoSwipe is already open
        || window.navigator.onLine === false) { // ... if offline
      return;
    }

    // If both clientX and clientY are 0 or not defined,
    // the event is likely triggered by keyboard,
    // so we do not pass the initialPoint
    //
    // Note that some screen readers emulate the mouse position,
    // so it's not ideal way to detect them.
    //
    let initialPoint = { x: e.clientX, y: e.clientY };

    if (!initialPoint.x && !initialPoint.y) {
      initialPoint = null;
    }

    const clickedIndex = this.getClickedIndex(e);
    const dataSource = {
      gallery: e.currentTarget
    };

    if (clickedIndex >= 0) {
      e.preventDefault();
      this.loadAndOpen(clickedIndex, dataSource, initialPoint);
    }
  }

  /**
   * Get index of gallery item that was clicked.
   *
   * @param {Event} e click event
   */
  getClickedIndex(e) {
    if (this.options.getClickedIndexFn) {
      return this.options.getClickedIndexFn.call(this, e);
    }

    const clickedTarget = e.target;
    const clickedGallery = e.currentTarget;

    if (this.options.childSelector) {
      const clickedChild = clickedTarget.closest(this.options.childSelector);
      const childElements = clickedGallery.querySelectorAll(this.options.childSelector);

      if (clickedChild) {
        for (let i = 0; i < childElements.length; i++) {
          if (clickedChild === childElements[i]) {
            return i;
          }
        }
      }
    } else {
      // There is only one item (which is gallerySelector)
      return 0;
    }
  }

  /**
   * Load JS/CSS files and open PhotoSwipe afterwards.
   *
   * @param {Integer} index
   * @param {Array|Object|null} dataSource
   * @param {Point|null} initialPoint
   */
  loadAndOpen(index, dataSource, initialPoint) {
    // Check if the gallery is already open
    if (window.pswp) {
      return false;
    }

    // set initial index
    this.options.index = index;

    // define options for PhotoSwipe constructor
    this.options.initialPointerPos = initialPoint;

    this.shouldOpen = true;
    this.preload(index, dataSource);
    return true;
  }

  /**
   * Load JS/CSS files and the slide content by index
   *
   * @param {Integer} index
   */
  preload(index, dataSource) {
    const { options } = this;

    if (dataSource) {
      options.dataSource = dataSource;
    }

    // Add the main module
    const promiseArray = [dynamicImportModule(options.pswpModule)];

    // Add plugin modules
    Object.keys(this._pluginClasses).forEach((pluginKey) => {
      promiseArray.push(dynamicImportPlugin(
        pluginKey,
        this._pluginClasses[pluginKey]
      ));
    });

    // Add custom-defined promise, if any
    if (typeof options.openPromise === 'function') {
      // allow developers to perform some task before opening
      promiseArray.push(options.openPromise());
    }

    if (options.preloadFirstSlide !== false && index >= 0) {
      lazyLoadSlide(index, this);
    }

    // Load main CSS
    if (options.pswpCSS) {
      promiseArray.push(loadCSS(options.pswpCSS));
    }

    // Load additional CSS, if any
    this._additionalDynamicCSS.forEach((href) => {
      promiseArray.push(loadCSS(href));
    });

    // Wait till all promises resolve and open PhotoSwipe
    const uid = ++this._uid;
    Promise.all(promiseArray).then((iterableModules) => {
      iterableModules.forEach((item) => {
        if (item && item.pluginKey && item.moduleClass) {
          this._pluginClasses[item.pluginKey] = item.moduleClass;
        }
      });

      if (this.shouldOpen) {
        const mainModule = iterableModules[0];
        this._openPhotoswipe(mainModule, uid);
      }
    });
  }

  _openPhotoswipe(module, uid) {
    // Cancel opening if UID doesn't match the current one
    // (if user clicked on another gallery item before current was loaded).
    //
    // Or if shouldOpen flag is set to false
    // (developer may modify it via public API)
    if (uid !== this._uid && this.shouldOpen) {
      return;
    }

    this.shouldOpen = false;

    // PhotoSwipe is already open
    if (window.pswp) {
      return;
    }

    // Pass data to PhotoSwipe and open init
    const pswp = typeof module === "object" 
        ? new module.default(null, this.options) // eslint-disable-line
        : new module(null, this.options);

    pswp.pluginClasses = this._pluginClasses;

    this.pswp = pswp;
    window.pswp = pswp;

    // map listeners from Lightbox to PhotoSwipe Core
    Object.keys(this._listeners).forEach((name) => {
      this._listeners[name].forEach((fn) => {
        pswp.on(name, fn);
      });
    });

    pswp.on('destroy', () => {
      // clean up public variables
      this.pswp = null;
      window.pswp = null;
    });

    pswp.init();
  }

  /**
   * Register a plugin.
   *
   * @param {String} name
   * @param {Class|String} pluginClass Plugin class or path to module (string).
   */
  addPlugin(name, pluginClass) {
    this._pluginClasses[name] = pluginClass;
  }

  /**
   * Add CSS file that will be loaded when PhotoSwipe dialog is opened.
   *
   * @param {String} href CSS file URL.
   */
  addCSS(href) {
    this._additionalDynamicCSS.push(href);
  }

  destroy() {
    if (this.pswp) {
      this.pswp.close();
    }

    this.shouldOpen = false;
    this._listeners = null;

    const galleryElements = document.querySelectorAll(this.options.gallerySelector);
    galleryElements.forEach((galleryElement) => {
      galleryElement.removeEventListener('click', this.onThumbnailsClick, false);
    });
  }
}

export default PhotoSwipeLightbox;
