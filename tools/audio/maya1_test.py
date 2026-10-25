#!/usr/bin/env python3
"""Offline checks: recipe integrity, cache invalidation and paid-request resume."""
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import maya1


class Maya1Tests(unittest.TestCase):
    def setUp(self):
        self.voice = maya1.identity(Path(__file__).with_name('maya1-voice.json'))
        self.row = {'id':'welcome-1', 'text':"G'day legends!"}

    def test_exact_recipe_and_cache_invalidation(self):
        self.assertEqual(self.voice['canonical_voice_id'], 'aussie-maya1-v1')
        self.assertEqual(self.voice['recipe']['endpoint'], 'fal-ai/maya')
        self.assertEqual(self.voice['recipe']['temperature'], .3)
        original = maya1.cache_key(self.row, self.voice)
        self.assertNotEqual(original, maya1.cache_key(dict(self.row, text='Another line'), self.voice))
        self.assertNotEqual(original, maya1.cache_key(self.row, dict(self.voice, recipe_sha256='different')))
        with tempfile.TemporaryDirectory() as tmp:
            file = Path(tmp)/'voice.json'
            changed = json.loads(json.dumps(self.voice))
            changed['recipe']['prompt'] = 'wrong voice'
            file.write_text(json.dumps(changed))
            with self.assertRaises(ValueError):
                maya1.identity(file)

    def test_existing_pending_request_never_resubmits(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            folder = root/self.row['id']/maya1.cache_key(self.row,self.voice)
            folder.mkdir(parents=True)
            pending = {'request_id':'existing', 'status_url':'https://status.invalid', 'response_url':'https://response.invalid'}
            (folder/'request.json').write_text(json.dumps(pending))
            def request(url, key, body=None):
                self.assertIsNone(body, 'resumption must never submit a paid POST')
                if url == pending['status_url']:
                    return {'status':'COMPLETED'}
                self.assertEqual(url, pending['response_url'])
                return {'audio':{'url':'https://download.invalid/raw.wav'}}
            with patch.object(maya1,'request',side_effect=request), patch.object(maya1.urllib.request,'urlopen',return_value=io.BytesIO(b'example-wav')):
                raw = maya1.generate(self.row,self.voice,'test-only',root)
            self.assertEqual(raw.read_bytes(),b'example-wav')
            with patch.object(maya1,'request',side_effect=AssertionError('cache must skip provider')):
                self.assertEqual(maya1.generate(self.row,self.voice,'test-only',root),raw)

    def test_new_request_uses_canonical_text_and_prompt(self):
        with tempfile.TemporaryDirectory() as tmp:
            def request(url,key,body=None):
                if body is not None:
                    self.assertEqual(body['text'],"G'day legends!")
                    self.assertEqual(body['prompt'],self.voice['recipe']['prompt'])
                    self.assertNotIn('seed',body)
                    return {'request_id':'new','status_url':'status','response_url':'response'}
                return {'status':'COMPLETED'} if url == 'status' else {'audio':{'url':'https://download.invalid/raw.wav'}}
            with patch.object(maya1,'request',side_effect=request), patch.object(maya1.urllib.request,'urlopen',return_value=io.BytesIO(b'example-wav')):
                maya1.generate(self.row,self.voice,'test-only',Path(tmp))

    def test_cached_only_refuses_missing_take_without_provider_calls(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            with patch.object(maya1, 'request', side_effect=AssertionError('cached audit must never call provider')):
                with self.assertRaisesRegex(ValueError, 'missing takes: welcome-1'):
                    maya1.cached_paths([self.row], self.voice, root)
                raw = root / self.row['id'] / maya1.cache_key(self.row, self.voice) / 'raw.wav'
                raw.parent.mkdir(parents=True)
                raw.write_bytes(b'cached')
                self.assertEqual(maya1.cached_paths([self.row], self.voice, root), [raw])

    def test_orthographic_spelling_is_not_a_different_spoken_word(self):
        self.assertEqual(maya1.score_wer('The whole neighbourhood rocked up.', 'The whole neighborhood rocked up.'), 0)
        self.assertGreater(maya1.score_wer('The whole neighbourhood rocked up.', 'The whole neighbourhood walked up.'), 0)


if __name__ == '__main__':
    unittest.main()
