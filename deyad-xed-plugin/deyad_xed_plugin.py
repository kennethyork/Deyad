# -*- coding: utf-8 -*-
#
#  deyad_xed_plugin.py - AI code completions powered by Ollama for Xed
#
#  Copyright (C) 2025 Kenneth York
#
#  This program is free software; you can redistribute it and/or modify
#  it under the terms of the GNU General Public License as published by
#  the Free Software Foundation; either version 2 of the License, or
#  (at your option) any later version.

import gi
import json
import threading
import urllib.request
import urllib.error

gi.require_version('Peas', '1.0')
gi.require_version('Gtk', '3.0')
gi.require_version('Gdk', '3.0')

from gi.repository import GObject, Gdk, Gtk, GLib, Pango, Xed

# ── Config ────────────────────────────────────────────────────────────
OLLAMA_ENDPOINT = "http://127.0.0.1:11434"
FIM_MODEL = "qwen2.5-coder:7b"
FALLBACK_MODEL = "qwen3:4b"
MAX_TOKENS = 128
TEMPERATURE = 0.2
DEBOUNCE_MS = 500
CONTEXT_LINES = 50           # lines of context above/below cursor
MIN_PREFIX_CHARS = 8         # don't trigger on very short prefixes
FIM_ENABLED = True
# ──────────────────────────────────────────────────────────────────────

GHOST_TAG = "deyad-ghost-text"


class DeyadXedPlugin(GObject.Object, Xed.ViewActivatable):
    __gtype_name__ = "DeyadXedPlugin"

    view = GObject.Property(type=Xed.View)

    def __init__(self):
        GObject.Object.__init__(self)
        self._handlers = []
        self._debounce_id = 0
        self._ghost_text = None      # the suggestion string
        self._ghost_start = None     # GtkTextMark at ghost start
        self._ghost_end = None       # GtkTextMark at ghost end
        self._inserting = False      # flag to suppress re-trigger
        self._request_seq = 0        # cancel stale requests
        self._enabled = True

    # ── Lifecycle ─────────────────────────────────────────────────────

    def do_activate(self):
        self._doc = self.view.get_buffer()

        # Create the ghost-text tag (dim gray, italic)
        tag_table = self._doc.get_tag_table()
        tag = tag_table.lookup(GHOST_TAG)
        if tag is None:
            tag = self._doc.create_tag(
                GHOST_TAG,
                foreground="#888888",
                style=Pango.Style.ITALIC,
            )

        self._handlers = [
            self._doc.connect('changed', self._on_buffer_changed),
            self.view.connect('key-press-event', self._on_key_press),
            self._doc.connect('notify::cursor-position', self._on_cursor_moved),
        ]

    def do_deactivate(self):
        self._dismiss_ghost()
        if self._debounce_id:
            GLib.source_remove(self._debounce_id)
            self._debounce_id = 0
        for handler in self._handlers:
            if handler:
                try:
                    self._doc.disconnect(handler)
                except TypeError:
                    self.view.disconnect(handler)
        self._handlers = []

    # ── Signal handlers ───────────────────────────────────────────────

    def _on_buffer_changed(self, doc):
        if self._inserting or not self._enabled:
            return
        # Any edit dismisses current ghost text
        self._dismiss_ghost()
        # Restart debounce timer
        if self._debounce_id:
            GLib.source_remove(self._debounce_id)
        self._debounce_id = GLib.timeout_add(DEBOUNCE_MS, self._trigger_completion)

    def _on_cursor_moved(self, doc, pspec):
        if self._inserting:
            return
        # Moving the cursor away dismisses ghost text
        if self._ghost_text:
            self._dismiss_ghost()

    def _on_key_press(self, view, event):
        if not self._ghost_text:
            return False  # no ghost → pass through

        keyval = event.keyval

        # Tab → accept ghost text
        if keyval == Gdk.KEY_Tab:
            self._accept_ghost()
            return True  # consume the event

        # Escape → dismiss
        if keyval == Gdk.KEY_Escape:
            self._dismiss_ghost()
            return True

        # Any printable key or backspace → dismiss (let event propagate)
        self._dismiss_ghost()
        return False

    # ── Completion trigger ────────────────────────────────────────────

    def _trigger_completion(self):
        self._debounce_id = 0  # one-shot timer

        if not self._enabled:
            return False

        doc = self._doc
        insert_iter = doc.get_iter_at_mark(doc.get_insert())

        # Get prefix (text before cursor) and suffix (text after cursor)
        prefix = self._get_context_before(insert_iter)
        suffix = self._get_context_after(insert_iter)

        if len(prefix.strip()) < MIN_PREFIX_CHARS:
            return False

        # Bump sequence to cancel any in-flight request
        self._request_seq += 1
        seq = self._request_seq

        # Fire request in background thread
        thread = threading.Thread(
            target=self._request_completion,
            args=(prefix, suffix, seq),
            daemon=True,
        )
        thread.start()

        return False  # don't repeat the timer

    def _get_context_before(self, iter_pos):
        doc = self._doc
        start_line = max(0, iter_pos.get_line() - CONTEXT_LINES)
        start = doc.get_iter_at_line(start_line)
        return doc.get_text(start, iter_pos, False)

    def _get_context_after(self, iter_pos):
        doc = self._doc
        end_line = min(doc.get_line_count(), iter_pos.get_line() + CONTEXT_LINES)
        end = doc.get_iter_at_line(end_line)
        end.forward_to_line_end()
        return doc.get_text(iter_pos, end, False)

    # ── Ollama API ────────────────────────────────────────────────────

    def _request_completion(self, prefix, suffix, seq):
        try:
            if FIM_ENABLED:
                body = self._build_fim_request(prefix, suffix)
            else:
                body = self._build_chat_request(prefix)

            data = json.dumps(body).encode("utf-8")
            req = urllib.request.Request(
                f"{OLLAMA_ENDPOINT}/api/generate",
                data=data,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                result = json.loads(resp.read().decode("utf-8"))

            text = result.get("response", "").strip()
            if not text or seq != self._request_seq:
                return  # stale or empty

            # Clean up the completion text
            text = self._clean_completion(text)
            if not text:
                return

            # Post to main thread
            GLib.idle_add(self._show_ghost, text, seq)

        except (urllib.error.URLError, OSError, json.JSONDecodeError, KeyError):
            pass  # silently ignore network/parse errors

    def _build_fim_request(self, prefix, suffix):
        return {
            "model": FIM_MODEL,
            "prompt": f"<|fim_prefix|>{prefix}<|fim_suffix|>{suffix}<|fim_middle|>",
            "stream": False,
            "raw": True,
            "options": {
                "temperature": TEMPERATURE,
                "num_predict": MAX_TOKENS,
                "stop": [
                    "\n\n\n", "<|endoftext|>",
                    "<|fim_prefix|>", "<|fim_suffix|>", "<|fim_middle|>",
                ],
            },
        }

    def _build_chat_request(self, prefix):
        return {
            "model": FALLBACK_MODEL,
            "prompt": prefix,
            "stream": False,
            "options": {
                "temperature": TEMPERATURE,
                "num_predict": MAX_TOKENS,
                "stop": ["\n\n\n"],
            },
        }

    def _clean_completion(self, text):
        # Remove common artifacts
        for token in ("<|endoftext|>", "<|fim_prefix|>", "<|fim_suffix|>",
                       "<|fim_middle|>", "</s>", "<|end|>", "<|im_end|>"):
            text = text.replace(token, "")
        # Trim trailing whitespace-only lines but keep leading newline if present
        lines = text.rstrip().split('\n')
        # Cap at ~6 lines to keep ghost text manageable
        if len(lines) > 6:
            lines = lines[:6]
        return '\n'.join(lines)

    # ── Ghost text display ────────────────────────────────────────────

    def _show_ghost(self, text, seq):
        if seq != self._request_seq:
            return False  # stale
        if self._ghost_text:
            self._dismiss_ghost()  # clear any existing ghost

        doc = self._doc
        insert_iter = doc.get_iter_at_mark(doc.get_insert())

        # Insert ghost text at cursor position
        self._inserting = True
        offset = insert_iter.get_offset()
        doc.insert(insert_iter, text)

        # Mark the range
        start_iter = doc.get_iter_at_offset(offset)
        end_iter = doc.get_iter_at_offset(offset + len(text))
        doc.apply_tag_by_name(GHOST_TAG, start_iter, end_iter)

        # Create marks to track the ghost range
        self._ghost_start = doc.create_mark(None, start_iter, True)
        self._ghost_end = doc.create_mark(None, end_iter, False)
        self._ghost_text = text

        # Move cursor back to before the ghost text
        doc.place_cursor(doc.get_iter_at_mark(self._ghost_start))
        self._inserting = False

        return False  # GLib.idle_add one-shot

    def _accept_ghost(self):
        if not self._ghost_text:
            return
        doc = self._doc
        self._inserting = True

        # Remove the tag — the text stays
        start = doc.get_iter_at_mark(self._ghost_start)
        end = doc.get_iter_at_mark(self._ghost_end)
        doc.remove_tag_by_name(GHOST_TAG, start, end)

        # Move cursor to end of accepted text
        doc.place_cursor(end)

        # Clean up marks
        doc.delete_mark(self._ghost_start)
        doc.delete_mark(self._ghost_end)
        self._ghost_start = None
        self._ghost_end = None
        self._ghost_text = None
        self._inserting = False

    def _dismiss_ghost(self):
        if not self._ghost_text:
            return
        doc = self._doc
        self._inserting = True

        # Delete the ghost text from the buffer
        start = doc.get_iter_at_mark(self._ghost_start)
        end = doc.get_iter_at_mark(self._ghost_end)
        doc.delete(start, end)

        # Clean up marks
        doc.delete_mark(self._ghost_start)
        doc.delete_mark(self._ghost_end)
        self._ghost_start = None
        self._ghost_end = None
        self._ghost_text = None
        self._inserting = False
