"""Structured server telemetry + low-cardinality metrics helpers.

This module keeps analytics payload shaping, privacy redaction, and Prometheus
rendering separate from the Socket.IO / Flask gameplay handlers.
"""

from __future__ import annotations

from collections import defaultdict
import hashlib
import json
import os
import re
import time
from urllib import request as urllib_request


DEFAULT_PROJECT = 'joystick-jammers'
DEFAULT_ROLE = 'server'
DEFAULT_SOURCE = 'Flask'
DEFAULT_SERVICE = 'game-server'

UNKNOWN_ROOM_ID = 'room-unknown'
UNKNOWN_MATCH_ID = 'match-unknown'
UNKNOWN_PLAYER_ID = 'player-unknown'

REDACTED_VALUE = '[redacted]'
COMPLEX_VALUE = '[complex]'
HASH_SALT = os.environ.get('TELEMETRY_HASH_SALT', 'jj-telemetry')

ALLOWED_EVENT_NAMES = frozenset({
    'server:room:created',
    'server:room:reclaimed',
    'server:room:returned_to_lobby',
    'server:room:closed',
    'server:player:joined',
    'server:player:join_failed',
    'server:player:reconnected',
    'server:player:left',
    'server:player:takeover_prompted',
    'server:host:disconnected',
    'server:game:started',
    'server:game:ended',
    'server:report:submitted',
    'server:validation:failed',
    'error:server:exception',
})

SENSITIVE_KEY_PATTERNS = [
    re.compile(pattern, re.IGNORECASE)
    for pattern in (
        r'display[_-]?name',
        r'player[_-]?name',
        r'nick[_-]?name',
        r'^player\d+$',
        r'room[_-]?code',
        r'join[_-]?code',
        r'(^|[_-])query$',
        r'(^|[_-])(url|href|referrer|location)$',
        r'(^|[_-])(api[_-]?key|auth[_-]?key|access[_-]?key|private[_-]?key)$',
        r'token|secret|password',
        r'socket[._-]?id',
        r'(^|[_-])(client[_-]?ip|ip[_-]?address|remote[_-]?addr)$',
        r'payload$',
        r'raw',
    )
]

SENSITIVE_VALUE_PATTERNS = [
    re.compile(pattern, re.IGNORECASE)
    for pattern in (
        r'\b\d{1,3}(?:\.\d{1,3}){3}\b',
        r'(?:^|[?&])(room|code|token|secret|password|api[_-]?key)=',
        r'^https?://\S+\?\S+=\S+',
        r'\bBearer\s+[A-Za-z0-9._-]+\b',
        r'^[A-Za-z0-9_-]{20,}$',
    )
]

MAX_PROPERTY_VALUE_LENGTH = 500
MAX_QUEUE_SIZE = 1024
HISTOGRAM_BUCKETS = (0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0)

METRIC_DEFINITIONS = {
    'jj_server_active_rooms': ('gauge', 'Active in-memory rooms.'),
    'jj_server_active_players': ('gauge', 'Connected controller seats across all rooms.'),
    'jj_server_disconnected_players': ('gauge', 'Disconnected controller seats eligible to reconnect.'),
    'jj_server_events_total': ('counter', 'Structured server telemetry events emitted.'),
    'jj_server_requests_total': ('counter', 'HTTP requests handled, labeled by handler and status class.'),
    'jj_server_socket_events_total': ('counter', 'Socket.IO handler executions, labeled by handler and result.'),
    'jj_server_validation_failures_total': ('counter', 'Validation failures, labeled by handler and failure bucket.'),
    'jj_server_exceptions_total': ('counter', 'Captured server exceptions, labeled by handler and context kind.'),
    'jj_server_handler_latency_seconds': ('histogram', 'Observed HTTP and Socket.IO handler latencies.'),
}


def normalize_telemetry_env(env):
    value = str(env or '').strip().lower()
    if value in ('prod', 'production'):
        return 'prod'
    if value == 'staging':
        return 'staging'
    return 'local'


def service_for_role(role):
    if role == 'server':
        return DEFAULT_SERVICE
    if role == 'host':
        return 'host-client'
    if role == 'controller':
        return 'controller-client'
    return 'unknown'


def _hash_value(value):
    if value in (None, ''):
        return None
    return hashlib.sha256(f'{HASH_SALT}:{value}'.encode('utf-8')).hexdigest()[:16]


def _status_class(status_code):
    try:
        prefix = int(status_code) // 100
    except (TypeError, ValueError):
        prefix = 0
    return f'{prefix}xx' if prefix else 'unknown'


def _label_tuple(labels):
    if not labels:
        return tuple()
    return tuple(sorted((str(key), str(value)) for key, value in labels.items()))


def _prom_escape(value):
    return (
        str(value)
        .replace('\\', '\\\\')
        .replace('\n', '\\n')
        .replace('"', '\\"')
    )


def _stringify_keys(mapping):
    if not isinstance(mapping, dict):
        return ''
    return ','.join(sorted(str(key) for key in mapping.keys())[:12])


def _stringify_values(values):
    if not values:
        return ''
    return ','.join(sorted(str(value) for value in values if value not in (None, ''))[:12])


def _sanitize_message(message, *, sensitive_values=None):
    sanitized = str(message or '')
    for value in sensitive_values or ():
        text = str(value or '')
        if text:
            sanitized = sanitized.replace(text, REDACTED_VALUE)
    if any(pattern.search(sanitized) for pattern in SENSITIVE_VALUE_PATTERNS):
        return REDACTED_VALUE
    return sanitized[:MAX_PROPERTY_VALUE_LENGTH]


def _is_sensitive_key(key):
    return any(pattern.search(str(key)) for pattern in SENSITIVE_KEY_PATTERNS)


def _is_sensitive_value(value):
    return isinstance(value, str) and any(pattern.search(value) for pattern in SENSITIVE_VALUE_PATTERNS)


def _sanitize_scalar(key, value, *, sensitive_values=None):
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value
    if isinstance(value, (list, tuple, set, dict)):
        return COMPLEX_VALUE

    text = str(value)
    for sensitive in sensitive_values or ():
        needle = str(sensitive or '')
        if needle:
            text = text.replace(needle, REDACTED_VALUE)

    if _is_sensitive_key(key) or _is_sensitive_value(text):
        return REDACTED_VALUE
    return text[:MAX_PROPERTY_VALUE_LENGTH]


class ServerTelemetry:
    def __init__(self, *, release='unknown', env='local', role=DEFAULT_ROLE, source=DEFAULT_SOURCE,
                 project=DEFAULT_PROJECT, service=None, debug=False, dispatch_enabled=None,
                 endpoint=None, posthog_endpoint=None, grafana_endpoint=None):
        self.release = str(release or 'unknown')
        self.env = normalize_telemetry_env(env)
        self.role = role or DEFAULT_ROLE
        self.source = source or DEFAULT_SOURCE
        self.project = project or DEFAULT_PROJECT
        self.service = service or service_for_role(self.role)
        self.debug = bool(debug)
        enabled_env = os.environ.get('TELEMETRY_ENABLED', '0') == '1'
        self.dispatch_enabled = enabled_env if dispatch_enabled is None else bool(dispatch_enabled)
        self.endpoint = endpoint or os.environ.get('TELEMETRY_ENDPOINT')
        self.posthog_endpoint = posthog_endpoint or os.environ.get('TELEMETRY_POSTHOG_ENDPOINT')
        self.grafana_endpoint = grafana_endpoint or os.environ.get('TELEMETRY_GRAFANA_ENDPOINT')
        self.queue = []
        self._counters = defaultdict(float)
        self._histograms = {}

    def clear(self):
        self.queue.clear()
        self._counters.clear()
        self._histograms.clear()

    def _counter_key(self, metric_name, labels=None):
        return metric_name, _label_tuple(labels)

    def increment(self, metric_name, *, labels=None, amount=1.0):
        self._counters[self._counter_key(metric_name, labels)] += float(amount)

    def observe(self, metric_name, value, *, labels=None):
        metric_key = self._counter_key(metric_name, labels)
        bucket_state = self._histograms.setdefault(metric_key, {
            'buckets': [0] * len(HISTOGRAM_BUCKETS),
            'count': 0,
            'sum': 0.0,
        })
        observed = max(float(value), 0.0)
        for index, bucket in enumerate(HISTOGRAM_BUCKETS):
            if observed <= bucket:
                bucket_state['buckets'][index] += 1
        bucket_state['count'] += 1
        bucket_state['sum'] += observed

    def _event_endpoint(self, event_name):
        if event_name.startswith('server:'):
            return self.grafana_endpoint or self.endpoint
        if event_name.startswith('error:'):
            return self.posthog_endpoint or self.endpoint
        return self.endpoint

    def _dispatch_event(self, event):
        endpoint = self._event_endpoint(event['eventName'])
        if not self.dispatch_enabled or not endpoint:
            return False
        body = json.dumps({'events': [event]}).encode('utf-8')
        req = urllib_request.Request(
            endpoint,
            data=body,
            headers={'Content-Type': 'application/json'},
            method='POST',
        )
        with urllib_request.urlopen(req, timeout=0.5):
            return True

    def emit(self, event_name, *, handler, room=None, room_analytics_id=None, match_id=None,
             player_analytics_id=None, source=None, mode=None, properties=None,
             sensitive_values=None):
        if event_name not in ALLOWED_EVENT_NAMES:
            raise ValueError(f'event name not allowlisted: {event_name}')

        sanitized_properties = {}
        for key, value in dict(properties or {}).items():
            sanitized_properties[str(key)] = _sanitize_scalar(
                key,
                value,
                sensitive_values=sensitive_values,
            )
        sanitized_properties.setdefault('handler', handler)

        event = {
            'eventName': event_name,
            'timestamp': int(time.time() * 1000),
            'release': self.release,
            'roomAnalyticsId': room_analytics_id or (room or {}).get('room_analytics_id') or UNKNOWN_ROOM_ID,
            'matchId': match_id or (room or {}).get('match_id') or UNKNOWN_MATCH_ID,
            'playerAnalyticsId': player_analytics_id or UNKNOWN_PLAYER_ID,
            'project': self.project,
            'service': self.service,
            'env': self.env,
            'role': self.role,
            'source': source or self.source,
            'properties': sanitized_properties,
        }
        if mode is None and room is not None:
            mode = room.get('mode')
        if mode is not None:
            event['mode'] = mode

        self.queue.append(event)
        if len(self.queue) > MAX_QUEUE_SIZE:
            del self.queue[:-MAX_QUEUE_SIZE]
        self.increment('jj_server_events_total', labels={'event_name': event_name})
        self._dispatch_event(event)
        return event

    def record_request(self, handler, status_code, duration_seconds):
        self.increment(
            'jj_server_requests_total',
            labels={'handler': handler or 'unknown', 'status_class': _status_class(status_code)},
        )
        self.observe(
            'jj_server_handler_latency_seconds',
            duration_seconds,
            labels={'handler': handler or 'unknown', 'kind': 'http'},
        )

    def record_socket_handler(self, handler, result, duration_seconds):
        self.increment(
            'jj_server_socket_events_total',
            labels={'handler': handler or 'unknown', 'result': result or 'ok'},
        )
        self.observe(
            'jj_server_handler_latency_seconds',
            duration_seconds,
            labels={'handler': handler or 'unknown', 'kind': 'socket'},
        )

    def record_validation_failure(self, *, handler, bucket, room=None, room_analytics_id=None,
                                  match_id=None, player_analytics_id=None, source='SocketIO',
                                  emit_event=True, sensitive_values=None):
        self.increment(
            'jj_server_validation_failures_total',
            labels={'handler': handler, 'bucket': bucket},
        )
        if not emit_event:
            return None
        return self.emit(
            'server:validation:failed',
            handler=handler,
            room=room,
            room_analytics_id=room_analytics_id,
            match_id=match_id,
            player_analytics_id=player_analytics_id,
            source=source,
            properties={'bucket': bucket},
            sensitive_values=sensitive_values,
        )

    def record_exception(self, exc, *, handler, kind, room=None, room_analytics_id=None,
                         match_id=None, player_analytics_id=None, source=None, context=None):
        ctx = dict(context or {})
        sensitive_values = tuple(ctx.pop('sensitive_values', ()) or ())
        message = _sanitize_message(str(exc), sensitive_values=sensitive_values)
        props = {
            'handler': handler,
            'kind': kind,
            'exceptionType': type(exc).__name__,
            'message': message,
            'code': getattr(exc, 'code', None) or type(exc).__name__,
            'method': ctx.get('method'),
            'path': ctx.get('path'),
            'namespace': ctx.get('namespace'),
            'queryKeys': _stringify_values(ctx.get('query_keys')),
            'payloadKeys': _stringify_values(ctx.get('payload_keys')),
            'contentType': ctx.get('content_type'),
            'remoteAddrHash': _hash_value(ctx.get('remote_addr')),
        }
        self.increment(
            'jj_server_exceptions_total',
            labels={'handler': handler, 'kind': kind},
        )
        return self.emit(
            'error:server:exception',
            handler=handler,
            room=room,
            room_analytics_id=room_analytics_id,
            match_id=match_id,
            player_analytics_id=player_analytics_id,
            source=source or self.source,
            properties=props,
            sensitive_values=sensitive_values,
        )

    def build_runtime_gauges(self, game_rooms):
        active_rooms = len(game_rooms or {})
        active_players = 0
        disconnected_players = 0
        for room in (game_rooms or {}).values():
            for seat in room.get('seats', {}).values():
                if seat.get('controller_sid'):
                    active_players += 1
                elif seat.get('state') == 'away':
                    disconnected_players += 1
        return {
            'jj_server_active_rooms': active_rooms,
            'jj_server_active_players': active_players,
            'jj_server_disconnected_players': disconnected_players,
        }

    def render_metrics(self, game_rooms):
        lines = []
        for metric_name, (metric_type, help_text) in METRIC_DEFINITIONS.items():
            lines.append(f'# HELP {metric_name} {help_text}')
            lines.append(f'# TYPE {metric_name} {metric_type}')

            if metric_type == 'gauge':
                value = self.build_runtime_gauges(game_rooms).get(metric_name, 0)
                lines.append(f'{metric_name} {float(value):g}')
                continue

            if metric_type == 'counter':
                for (name, labels), value in sorted(self._counters.items()):
                    if name != metric_name:
                        continue
                    if labels:
                        rendered = ','.join(f'{key}="{_prom_escape(val)}"' for key, val in labels)
                        lines.append(f'{metric_name}{{{rendered}}} {value:g}')
                    else:
                        lines.append(f'{metric_name} {value:g}')
                continue

            if metric_type == 'histogram':
                for (name, labels), state in sorted(self._histograms.items()):
                    if name != metric_name:
                        continue
                    base_labels = list(labels)
                    for bucket, count in zip(HISTOGRAM_BUCKETS, state['buckets']):
                        bucket_labels = base_labels + [('le', str(bucket))]
                        rendered = ','.join(f'{key}="{_prom_escape(val)}"' for key, val in bucket_labels)
                        lines.append(f'{metric_name}_bucket{{{rendered}}} {count:g}')
                    inf_labels = base_labels + [('le', '+Inf')]
                    rendered_inf = ','.join(f'{key}="{_prom_escape(val)}"' for key, val in inf_labels)
                    lines.append(f'{metric_name}_bucket{{{rendered_inf}}} {state["count"]:g}')
                    if labels:
                        rendered_base = ','.join(f'{key}="{_prom_escape(val)}"' for key, val in labels)
                        lines.append(f'{metric_name}_sum{{{rendered_base}}} {state["sum"]:g}')
                        lines.append(f'{metric_name}_count{{{rendered_base}}} {state["count"]:g}')
                    else:
                        lines.append(f'{metric_name}_sum {state["sum"]:g}')
                        lines.append(f'{metric_name}_count {state["count"]:g}')
        return '\n'.join(lines) + '\n'


__all__ = [
    'ALLOWED_EVENT_NAMES',
    'DEFAULT_PROJECT',
    'DEFAULT_ROLE',
    'DEFAULT_SERVICE',
    'DEFAULT_SOURCE',
    'ServerTelemetry',
    'UNKNOWN_MATCH_ID',
    'UNKNOWN_PLAYER_ID',
    'UNKNOWN_ROOM_ID',
    'normalize_telemetry_env',
    'service_for_role',
]
