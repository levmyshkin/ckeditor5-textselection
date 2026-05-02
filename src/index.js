/**
 * @file Entry point for the textSelection CKEditor 5 plugin.
 *
 * Exposes the TextSelection class so Drupal can reference it as
 * `textSelection.TextSelection` in extra_ckeditor_plugins.ckeditor5.yml.
 */

import TextSelection from './textselection';

export default {
  TextSelection,
};
