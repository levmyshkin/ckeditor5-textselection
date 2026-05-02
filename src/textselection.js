/**
 * @file TextSelection plugin for CKEditor 5.
 *
 * Preserves the editor text selection when toggling Source Editing mode,
 * replicating the behaviour of the CKEditor 4 "textselection" addon.
 *
 * How it works
 * ============
 * WYSIWYG → Source
 *   1. Selection is tracked proactively on every model selection change.
 *   2. On mode switch a position map is built by aligning the model's plain
 *      text character-by-character against the raw HTML string (skipping
 *      tags and any HTML characters that are not present in the model —
 *      i.e. inter-block formatting whitespace added by the serialiser).
 *   3. The mapped HTML character offsets are applied with setSelectionRange
 *      and the textarea is scrolled to show the selection.
 *
 * Source → WYSIWYG
 *   1. High-priority handler reads the textarea cursor while it is still in
 *      the DOM and converts the HTML position back to a model text offset
 *      (using the same position map technique against the pre-edit model).
 *   2. setTimeout(0) defers model restoration until after the source editing
 *      plugin has committed the textarea HTML to the model.
 *
 * All failures are caught silently – the editor never crashes.
 */

import { Plugin } from 'ckeditor5/src/core';

export default class TextSelection extends Plugin {
  static get pluginName() {
    return 'TextSelection';
  }

  init() {
    const editor = this.editor;

    if ( !editor.plugins.has( 'SourceEditing' ) ) {
      // console.log( '[TextSelection] SourceEditing not found – disabled.' );
      return;
    }

    const sourceEditing = editor.plugins.get( 'SourceEditing' );

    /** @type {{ start: number, end: number }|null} */
    this._savedModelOffset = null;

    // Track selection proactively to avoid focus-loss race on toolbar click.
    editor.listenTo(
      editor.model.document.selection,
      'change',
      () => {
        if ( !sourceEditing.isSourceEditingMode ) {
          const offset = this._modelSelectionToTextOffset();
          this._savedModelOffset = offset;
          // console.log( '[TextSelection] selection →', JSON.stringify( offset ) );
        }
      },
    );

    // HIGH priority: fires before source editing removes the textarea.
    editor.listenTo(
      sourceEditing,
      'change:isSourceEditingMode',
      ( evt, name, isActive ) => {
        // console.log( '[TextSelection] isSourceEditingMode:', isActive );
        if ( isActive ) {
          this._onEnterSourceMode();
        } else {
          this._onLeaveSourceMode();
        }
      },
      { priority: 'high' },
    );

    // console.log( '[TextSelection] plugin initialised.' );
  }

  // ---------------------------------------------------------------------------
  // Mode transition handlers
  // ---------------------------------------------------------------------------

  _onEnterSourceMode() {
    const current = this._modelSelectionToTextOffset();
    if ( current !== null ) {
      this._savedModelOffset = current;
    }

    if ( this._savedModelOffset === null ) return;

    const savedOffset = this._savedModelOffset;

    // Use a longer delay to allow CodeMirror (if present) to initialise.
    setTimeout( () => {
      const textarea = this._findSourceTextarea();
      if ( !textarea ) return;

      const html = textarea.value;
      const posMap = this._buildPositionMap( html );

      const startHtml = posMap[ savedOffset.start ] ?? html.length;
      const endHtml   = posMap[ savedOffset.end ]   ?? html.length;

      // If CodeMirror is active, set selection there instead of on the textarea.
      const cmInstance = this._getCodeMirrorInstance();
      if ( cmInstance ) {
        const startPos = cmInstance.posFromIndex( startHtml );
        const endPos   = cmInstance.posFromIndex( endHtml );
        cmInstance.focus();
        cmInstance.setSelection( startPos, endPos );
        cmInstance.scrollIntoView( startPos );
      } else {
        textarea.focus();
        textarea.setSelectionRange( startHtml, endHtml );
        this._scrollTextareaToOffset( textarea, startHtml );
      }
    }, 50 );
  }

  _onLeaveSourceMode() {
    const textarea = this._findSourceTextarea();

    let offsetToRestore = this._savedModelOffset;

    if ( textarea ) {
      // If CodeMirror is active, read cursor and content from it.
      const cmInstance = this._getCodeMirrorInstance();

      let html, selStart, selEnd;

      if ( cmInstance ) {
        html     = cmInstance.getValue();
        selStart = cmInstance.indexFromPos( cmInstance.getCursor( 'from' ) );
        selEnd   = cmInstance.indexFromPos( cmInstance.getCursor( 'to' ) );
      } else {
        html     = textarea.value;
        selStart = textarea.selectionStart;
        selEnd   = textarea.selectionEnd;
      }

      const posMap = this._buildPositionMap( html );
      offsetToRestore = {
        start: this._posMapReverse( posMap, selStart ),
        end:   this._posMapReverse( posMap, selEnd ),
      };
    }

    this._savedModelOffset = null;

    if ( offsetToRestore === null ) return;

    const frozenOffset = offsetToRestore;
    setTimeout( () => {
      this._restoreModelSelectionFromTextOffset( frozenOffset );
    }, 0 );
  }

  // ---------------------------------------------------------------------------
  // Position map  (model text ↔ HTML string positions)
  // ---------------------------------------------------------------------------

  /**
   * Builds an array where posMap[i] is the HTML string index of the i-th
   * model text character.
   *
   * Strategy: walk the HTML string left-to-right, skipping tags.  For each
   * non-tag character (decoding entities to a single char) check whether it
   * matches the next character expected from the model text.  If it matches,
   * record the HTML index.  If it does not match, skip the HTML character —
   * it is inter-block formatting whitespace added by the HTML serialiser that
   * has no counterpart in the model.
   *
   * @param {string} html  Raw textarea value.
   * @returns {Array<number>}  posMap[modelIdx] = htmlIdx (length = modelTextLen + 1).
   */
  _buildPositionMap( html ) {
    // Collect model text in document order.
    const model     = this.editor.model;
    const root      = model.document.getRoot();
    let   modelText = '';

    for ( const value of model.createRangeIn( root ).getWalker( { ignoreElementEnd: true } ) ) {
      if ( value.type === 'text' ) {
        modelText += value.item.data;
      }
    }

    // posMap[i] = HTML index of the i-th model char.
    // posMap[modelText.length] = HTML index just past the last matched char.
    const posMap = new Array( modelText.length + 1 ).fill( -1 );
    let h = 0; // HTML cursor
    let m = 0; // model text cursor

    while ( h < html.length && m < modelText.length ) {
      const ch = html[ h ];

      if ( ch === '<' ) {
        // Skip entire tag.
        const close = html.indexOf( '>', h );
        h = close === -1 ? html.length : close + 1;
        continue;
      }

      // Decode the current HTML character (handle entities).
      let htmlChar, advance;

      if ( ch === '&' ) {
        const semi = html.indexOf( ';', h + 1 );
        if ( semi !== -1 && semi - h <= 10 ) {
          htmlChar = this._decodeEntity( html.slice( h, semi + 1 ) );
          advance  = semi - h + 1;
        } else {
          htmlChar = ch;
          advance  = 1;
        }
      } else {
        htmlChar = ch;
        advance  = 1;
      }

      // Match against model text.  A mismatch means extra HTML content
      // (formatting whitespace) — advance only the HTML cursor, not the model.
      if ( htmlChar === modelText[ m ] ) {
        posMap[ m ] = h;
        m++;
      }

      h += advance;
    }

    // Sentinel: position just past the last matched character.
    posMap[ modelText.length ] = h;

    return posMap;
  }

  /**
   * Given an HTML string position, return the corresponding model text offset
   * by finding the largest model index whose mapped HTML position ≤ htmlOffset.
   *
   * @param {Array<number>} posMap
   * @param {number} htmlOffset
   * @returns {number}
   */
  _posMapReverse( posMap, htmlOffset ) {
    let best = 0;
    for ( let i = 0; i < posMap.length; i++ ) {
      if ( posMap[ i ] >= 0 && posMap[ i ] <= htmlOffset ) {
        best = i;
      }
    }
    return best;
  }

  /**
   * Decodes a single HTML entity string to a character.
   *
   * @param {string} entity  e.g. '&amp;', '&#x26;', '&#38;'
   * @returns {string}
   */
  _decodeEntity( entity ) {
    const named = {
      '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"',
      '&apos;': "'", '&nbsp;': '\u00a0',
    };
    if ( named[ entity ] ) return named[ entity ];
    if ( /^&#x/i.test( entity ) ) {
      return String.fromCodePoint( parseInt( entity.slice( 3, -1 ), 16 ) );
    }
    if ( /^&#/.test( entity ) ) {
      return String.fromCodePoint( parseInt( entity.slice( 2, -1 ), 10 ) );
    }
    return entity;
  }

  // ---------------------------------------------------------------------------
  // Model ↔ plain-text offset helpers
  // ---------------------------------------------------------------------------

  _modelSelectionToTextOffset() {
    const model     = this.editor.model;
    const selection = model.document.selection;
    const range     = selection.getFirstRange();
    if ( !range ) return null;
    const root = model.document.getRoot();
    return {
      start: this._countTextCharsToPosition( model, root, range.start ),
      end:   this._countTextCharsToPosition( model, root, range.end ),
    };
  }

  _countTextCharsToPosition( model, root, position ) {
    const range = model.createRange( model.createPositionAt( root, 0 ), position );
    let count = 0;
    for ( const item of range.getItems() ) {
      if ( item.is( '$textProxy' ) || item.is( '$text' ) ) {
        count += item.data.length;
      }
    }
    return count;
  }

  _restoreModelSelectionFromTextOffset( { start, end } ) {
    const model = this.editor.model;
    const root  = model.document.getRoot();
    try {
      const startPos = this._findModelPositionAtTextOffset( model, root, start );
      const endPos   = this._findModelPositionAtTextOffset( model, root, end );
      model.change( writer => {
        writer.setSelection( writer.createRange( startPos, endPos ) );
      } );
      this.editor.editing.view.scrollToTheSelection();
      // console.log( '[TextSelection] model selection restored ✓' );
    } catch ( e ) {
      console.warn( '[TextSelection] restore failed:', e );
    }
  }

  _findModelPositionAtTextOffset( model, root, targetOffset ) {
    const range = model.createRangeIn( root );
    let count   = 0;
    for ( const value of range.getWalker( { ignoreElementEnd: true } ) ) {
      if ( value.type !== 'text' ) continue;
      const len = value.item.data.length;
      if ( count + len >= targetOffset ) {
        return value.previousPosition.getShiftedBy( targetOffset - count );
      }
      count += len;
    }
    return model.createPositionAt( root, 'end' );
  }

  // ---------------------------------------------------------------------------
  // DOM helpers
  // ---------------------------------------------------------------------------

  _findSourceTextarea() {
    const el = this.editor.ui.view.element;
    return el ? el.querySelector( '.ck-source-editing-area textarea' ) : null;
  }

  /**
   * Returns the active CodeMirror instance (if the SourceEditingCodeMirror
   * plugin is loaded and currently has an editor), or null.
   */
  _getCodeMirrorInstance() {
    try {
      if ( !this.editor.plugins.has( 'SourceEditingCodeMirror' ) ) return null;
      const cmPlugin = this.editor.plugins.get( 'SourceEditingCodeMirror' );
      if ( cmPlugin._cmEditors && cmPlugin._cmEditors.length > 0 ) {
        return cmPlugin._cmEditors[ 0 ];
      }
    } catch ( e ) { /* ignore */ }
    return null;
  }

  /**
   * Scrolls the textarea so that the character at htmlOffset is vertically
   * centred, using a hidden mirror-div to measure the pixel position.
   */
  _scrollTextareaToOffset( textarea, htmlOffset ) {
    const style  = window.getComputedStyle( textarea );
    const mirror = document.createElement( 'div' );

    [
      'box-sizing', 'width',
      'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
      'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
      'font-size', 'font-family', 'font-weight', 'font-style',
      'line-height', 'letter-spacing', 'word-spacing',
      'white-space', 'word-wrap', 'overflow-wrap', 'tab-size',
    ].forEach( p => { mirror.style[ p ] = style[ p ]; } );

    Object.assign( mirror.style, {
      position:   'absolute',
      top:        '-9999px',
      left:       '-9999px',
      overflow:   'hidden',
      height:     'auto',
      whiteSpace: 'pre-wrap',
      visibility: 'hidden',
    } );

    mirror.textContent = textarea.value.slice( 0, htmlOffset );
    const caret = document.createElement( 'span' );
    caret.textContent = '\u200b';
    mirror.appendChild( caret );

    document.body.appendChild( mirror );
    const caretTop = caret.offsetTop;
    document.body.removeChild( mirror );

    textarea.scrollTop = Math.max( 0, caretTop - textarea.clientHeight / 2 );
    // console.log( '[TextSelection] scroll | caretTop:', caretTop, '→ scrollTop:', textarea.scrollTop );
  }
}
